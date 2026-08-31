import { Emitter } from '../../lib/emitter'
import { DEFAULT_HEAD_WIDTH_DOTS } from '../../model/units'
import { encodeImage } from '../protocol/encodeImage'
import { planBands } from '../protocol/splitJob'
import { DEFAULT_PROFILE } from '../profiles'
import { DEFAULT_CHUNK_SIZE } from '../protocol/constants'
import * as cmd from '../protocol/commands'
import type {
  PrintJob,
  PrinterCapabilities,
  PrinterDriver,
  PrinterEvents,
  PrinterState,
  PrinterStatus,
} from '../types'

export interface VirtualPrintout {
  job: PrintJob
  /** Exactly the bytes a real printer would have received, in order. */
  wire: Uint8Array[]
  at: number
}

/**
 * A printer that exists only in memory.
 *
 * It runs the *real* command sequence and the *real* encoder, then keeps the
 * resulting bitmap and byte stream instead of sending them anywhere. That makes
 * the whole app — editor, rasteriser, print settings, progress UI — developable
 * and verifiable with no hardware attached, and it doubles as the reference for
 * what the BLE driver must emit.
 *
 * Transfer is paced to roughly the real thing (BLE moves a few KB/s) so progress
 * and cancellation get exercised rather than completing instantly.
 */
export class VirtualPrinterDriver implements PrinterDriver {
  readonly kind = 'virtual' as const

  #state: PrinterState = 'disconnected'
  #capabilities: PrinterCapabilities | null = null
  #emitter = new Emitter<PrinterEvents>()
  #printouts: VirtualPrintout[] = []

  /** Bytes per simulated second. Set to Infinity in tests to remove the delay. */
  readonly throughputBytesPerSecond: number

  constructor(throughputBytesPerSecond = 4000) {
    this.throughputBytesPerSecond = throughputBytesPerSecond
  }

  get state(): PrinterState {
    return this.#state
  }

  get capabilities(): PrinterCapabilities | null {
    return this.#capabilities
  }

  /** Everything "printed" so far, oldest first. */
  get printouts(): readonly VirtualPrintout[] {
    return this.#printouts
  }

  clearPrintouts(): void {
    this.#printouts = []
  }

  on = <E extends keyof PrinterEvents>(
    event: E,
    handler: (payload: PrinterEvents[E]) => void,
  ): (() => void) => this.#emitter.on(event, handler)

  async connect(): Promise<PrinterCapabilities> {
    this.#setState('connecting')
    this.#capabilities = {
      model: 'P50 (virtual)',
      firmware: '0.0.0-virtual',
      serial: 'VIRTUAL',
      mac: '00:00:00:00:00:00',
      headWidthDots: DEFAULT_HEAD_WIDTH_DOTS,
      chunkSize: DEFAULT_CHUNK_SIZE,
      probedAt: Date.now(),
      // It pretends to be a P50 because it runs the P50 command sequence and the
      // P50 encoder. Confirmed is the honest word: what it emits is checked
      // against the same goldens as the real driver.
      profileId: DEFAULT_PROFILE.id,
      support: DEFAULT_PROFILE.support,
      profileAssumed: false,
    }
    this.#setState('connected')
    return this.#capabilities
  }

  async getStatus(): Promise<PrinterStatus> {
    return {
      online: this.#state !== 'disconnected',
      batteryPercent: 100,
      paperType: 0x20,
      density: 8,
      labelHeightDots: null,
      fault: 'none',
    }
  }

  async print(job: PrintJob, opts?: { signal?: AbortSignal }): Promise<void> {
    if (this.#state === 'disconnected') throw new Error('Virtual printer is not connected')
    this.#setState('printing')
    const wire: Uint8Array[] = []

    const send = (bytes: Uint8Array, note?: string) => {
      wire.push(bytes)
      this.#emitter.emit('wire', { dir: 'out', bytes, at: Date.now(), note })
    }

    try {
      const image = encodeImage(job.bitmap)
      const framing = cmd.printJobFraming(job.settings)
      // One band unless the label needs splitting, so the ordinary path is the same
      // code with a single-element array. Same planner and same seam decision as the
      // real driver — a test concatenates both and compares.
      const closeSeam = job.settings.closeSplitSeam === true
      const bands =
        job.settings.splitForSeek === false ? [job.bitmap] : planBands(job.bitmap, { closeSeam })
      const encoded = bands.length === 1 ? [image] : bands.map(encodeImage)
      const total = encoded.reduce((n, e) => n + e.length, 0) * job.settings.copies

      this.#emitter.emit('progress', {
        phase: 'prepare',
        sent: 0,
        total,
        copy: 0,
        copies: job.settings.copies,
      })

      let sent = 0
      for (let copy = 1; copy <= job.settings.copies; copy++) {
        opts?.signal?.throwIfAborted()

        this.#emitter.emit('progress', {
          phase: 'handshake',
          sent,
          total,
          copy,
          copies: job.settings.copies,
        })
        for (let band = 0; band < encoded.length; band++) {
          const last = band === encoded.length - 1
          // Only the first band retracts, only the last seeks, and the tear-off
          // advance happens once at the very end. The real driver builds the same
          // framing for the same reasons; a test concatenates both and compares.
          const bandFraming = cmd.printJobFraming({
            ...job.settings,
            alignStart: band === 0 || closeSeam,
            seekGap: last,
          })
          for (const { bytes, note } of bandFraming.preamble) send(bytes, note)

          // Chunk the raster at the size the BLE driver uses. Not the same
          // *boundaries*, though, and deliberately: the real driver chunks the
          // whole job stream, so its commands arrive glued to raster chunks. That
          // is unreadable in a log and means nothing to a printer that is not
          // there, so this one keeps each command on its own line.
          const chunkSize = this.#capabilities?.chunkSize ?? DEFAULT_CHUNK_SIZE
          const raster = encoded[band]
          for (let offset = 0; offset < raster.length; offset += chunkSize) {
            opts?.signal?.throwIfAborted()
            const chunk = raster.subarray(offset, Math.min(offset + chunkSize, raster.length))
            send(chunk)
            sent += chunk.length
            await this.#pace(chunk.length)
            this.#emitter.emit('progress', {
              phase: 'transfer',
              sent,
              total,
              copy,
              copies: job.settings.copies,
            })
          }

          for (const { bytes, note } of bandFraming.trailer) send(bytes, note)
          if (last) {
            for (const { bytes, note } of framing.epilogue) send(bytes, note)
          }
        }

        this.#emitter.emit('progress', {
          phase: 'feed',
          sent,
          total,
          copy,
          copies: job.settings.copies,
        })
      }

      this.#printouts.push({ job, wire, at: Date.now() })
      this.#emitter.emit('progress', {
        phase: 'done',
        sent: total,
        total,
        copy: job.settings.copies,
        copies: job.settings.copies,
      })
      this.#setState('connected')
    } catch (error) {
      this.#setState('connected')
      throw error
    }
  }

  async sendCommand(bytes: Uint8Array, note?: string): Promise<void> {
    if (this.#state === 'disconnected') throw new Error('Virtual printer is not connected')
    this.#emitter.emit('wire', { dir: 'out', bytes, at: Date.now(), note })
  }

  async query(bytes: Uint8Array, note?: string): Promise<Uint8Array | null> {
    await this.sendCommand(bytes, note)
    // A virtual printer has nothing to report; the point of this path is the
    // real one.
    return null
  }

  async disconnect(): Promise<void> {
    this.#capabilities = null
    this.#setState('disconnected')
  }

  #setState(state: PrinterState): void {
    this.#state = state
    this.#emitter.emit('state', state)
  }

  async #pace(bytes: number): Promise<void> {
    if (!Number.isFinite(this.throughputBytesPerSecond)) return
    const ms = (bytes / this.throughputBytesPerSecond) * 1000
    if (ms < 1) return
    await new Promise((resolve) => setTimeout(resolve, ms))
  }
}
