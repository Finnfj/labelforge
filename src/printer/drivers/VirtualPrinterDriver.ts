import { Emitter } from '../../lib/emitter'
import { DEFAULT_HEAD_WIDTH_DOTS } from '../../model/units'
import { encodeImage } from '../protocol/encodeImage'
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
      const perCopy = image.length
      const total = perCopy * job.settings.copies

      this.#emitter.emit('progress', {
        phase: 'prepare',
        sent: 0,
        total,
        copy: 0,
        copies: job.settings.copies,
      })

      send(cmd.setPaperType(job.settings.paperType), 'setPaperType')
      send(cmd.setDensity(job.settings.density), 'setDensity')
      send(cmd.setSpeed(job.settings.speed), 'setSpeed')

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
        send(cmd.startPrintJob(), 'startPrintJob')
        send(cmd.alignPaperStart(), 'alignPaperStart')

        // Chunk the raster exactly as the BLE driver will, so the byte stream
        // recorded here is directly comparable to the real one.
        const chunkSize = this.#capabilities?.chunkSize ?? DEFAULT_CHUNK_SIZE
        for (let offset = 0; offset < image.length; offset += chunkSize) {
          opts?.signal?.throwIfAborted()
          const chunk = image.subarray(offset, Math.min(offset + chunkSize, image.length))
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

        this.#emitter.emit('progress', {
          phase: 'feed',
          sent,
          total,
          copy,
          copies: job.settings.copies,
        })
        send(cmd.stopPrintJob(), 'stopPrintJob')
        send(cmd.alignPaperEnd(), 'alignPaperEnd')
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
