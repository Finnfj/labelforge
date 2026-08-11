import { Emitter } from '../../lib/emitter'
import { DEFAULT_HEAD_WIDTH_DOTS } from '../../model/units'
import * as cmd from '../protocol/commands'
import { DEFAULT_CHUNK_SIZE } from '../protocol/constants'
import { CreditWindow } from '../protocol/CreditWindow'
import { decodeBattery, decodeFault, decodeText } from '../protocol/responses'
import { encodeImage } from '../protocol/encodeImage'
import type {
  PrintJob,
  PrinterCapabilities,
  PrinterDriver,
  PrinterEvents,
  PrinterState,
  PrinterStatus,
} from '../types'
import type { ConnectOptions, Transport } from '../transport/Transport'

/** How long to wait for a reply before giving up on a query. */
const QUERY_TIMEOUT_MS = 1200

export interface BlePrinterOptions {
  chunkSize?: number
  headWidthDots?: number
  /** Reply timeout. Shortened in tests so a silent printer is cheap to assert. */
  queryTimeoutMs?: number
}

/**
 * Drives a P50 over a {@link Transport}.
 *
 * The command sequence and the raster encoding are shared with the virtual
 * printer, so what this class adds is only the parts that need a real link:
 * chunking, flow control, replies and disconnection.
 */
export class BlePrinterDriver implements PrinterDriver {
  readonly kind = 'ble' as const

  #transport: Transport
  #state: PrinterState = 'disconnected'
  #capabilities: PrinterCapabilities | null = null
  #emitter = new Emitter<PrinterEvents>()
  #credits = new CreditWindow()
  #chunkSize: number
  #headWidthDots: number
  #queryTimeoutMs: number
  #unsubscribe: Array<() => void> = []
  /** Replies arrive as unsolicited notifications, so queries take the next one. */
  #pendingReply: ((bytes: Uint8Array) => void) | null = null
  #lastStatusBytes: Uint8Array | null = null

  constructor(transport: Transport, options: BlePrinterOptions = {}) {
    this.#transport = transport
    this.#chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
    this.#headWidthDots = options.headWidthDots ?? DEFAULT_HEAD_WIDTH_DOTS
    this.#queryTimeoutMs = options.queryTimeoutMs ?? QUERY_TIMEOUT_MS

    transport.on('wire', (event) => this.#emitter.emit('wire', {
      dir: event.direction,
      bytes: event.bytes,
      at: event.at,
      note: event.note,
    }))
    transport.on('disconnected', ({ reason }) => {
      this.#capabilities = null
      this.#credits.reset()
      this.#setState('disconnected')
      this.#emitter.emit('error', { message: reason })
    })
  }

  get state(): PrinterState {
    return this.#state
  }

  get capabilities(): PrinterCapabilities | null {
    return this.#capabilities
  }

  get transport(): Transport {
    return this.#transport
  }

  on = <E extends keyof PrinterEvents>(
    event: E,
    handler: (payload: PrinterEvents[E]) => void,
  ): (() => void) => this.#emitter.on(event, handler)

  async connect(options?: ConnectOptions): Promise<PrinterCapabilities> {
    this.#setState('connecting')
    try {
      await this.#transport.connect(options)

      this.#unsubscribe.push(
        await this.#transport.subscribe('credits', (bytes) => this.#credits.onNotify(bytes)),
      )
      this.#unsubscribe.push(
        await this.#transport.subscribe('status', (bytes) => {
          this.#lastStatusBytes = bytes
          const pending = this.#pendingReply
          this.#pendingReply = null
          pending?.(bytes)
        }),
      )

      // The vendor SDK sends this immediately after connecting. Its effect is
      // undocumented, so it is sent on the same assumption: match what the
      // shipping app does.
      await this.#transport.write(cmd.setBluetoothType())

      this.#capabilities = await this.probe()
      this.#setState('connected')
      return this.#capabilities
    } catch (error) {
      this.#setState('error')
      throw error
    }
  }

  /**
   * Read identity off the printer.
   *
   * Every field is optional: the reply formats are inferred rather than
   * documented, so a printer that answers differently should still connect and
   * print. Head width is not asked for at all — nothing reports it, and it has
   * to be measured with the diagnostics ruler strip.
   */
  async probe(): Promise<PrinterCapabilities> {
    const model = await this.#query(cmd.getPrinterModel(), decodeText)
    const firmware = await this.#query(cmd.getPrinterVersion(), decodeText)
    const serial = await this.#query(cmd.getPrinterSerial(), decodeText)
    const mac = await this.#query(cmd.getPrinterMac(), decodeText)

    return {
      model: model ?? 'Unknown',
      firmware: firmware ?? 'Unknown',
      serial: serial ?? 'Unknown',
      mac: mac ?? 'Unknown',
      headWidthDots: this.#headWidthDots,
      chunkSize: this.#chunkSize,
      probedAt: Date.now(),
    }
  }

  async getStatus(): Promise<PrinterStatus> {
    const battery = await this.#query(cmd.getPrinterBattery(), decodeBattery)
    const statusBytes = await this.#request(cmd.printerStatus())

    return {
      online: this.#state !== 'disconnected',
      batteryPercent: battery,
      paperType: null,
      density: null,
      labelHeightDots: null,
      fault: statusBytes ? decodeFault(statusBytes) : 'unknown',
    }
  }

  async print(job: PrintJob, opts: { signal?: AbortSignal } = {}): Promise<void> {
    if (this.#state === 'disconnected') throw new Error('Not connected to a printer.')
    this.#setState('printing')

    try {
      const image = encodeImage(job.bitmap)
      const total = image.length * job.settings.copies
      let sent = 0

      const progress = (phase: PrintProgressPhase, copy: number) =>
        this.#emitter.emit('progress', {
          phase,
          sent,
          total,
          copy,
          copies: job.settings.copies,
        })

      progress('prepare', 0)
      await this.#transport.write(cmd.setPaperType(job.settings.paperType))
      await this.#transport.write(cmd.setDensity(job.settings.density))
      await this.#transport.write(cmd.setSpeed(job.settings.speed))

      for (let copy = 1; copy <= job.settings.copies; copy++) {
        opts.signal?.throwIfAborted()
        progress('handshake', copy)
        await this.#transport.write(cmd.startPrintJob())
        await this.#transport.write(cmd.alignPaperStart())

        for (let offset = 0; offset < image.length; offset += this.#chunkSize) {
          opts.signal?.throwIfAborted()
          const chunk = image.subarray(offset, Math.min(offset + this.#chunkSize, image.length))

          // Wait for room before writing, not after: the buffer we would
          // overrun is on the far side of the link.
          await this.#credits.acquire({ signal: opts.signal })
          await this.#transport.write(chunk)
          sent += chunk.length
          progress('transfer', copy)
          await delay(this.#credits.delayMs, opts.signal)
        }

        progress('feed', copy)
        await this.#transport.write(cmd.stopPrintJob())
        await this.#transport.write(cmd.alignPaperEnd())
      }

      sent = total
      progress('done', job.settings.copies)
      this.#setState('connected')
    } catch (error) {
      this.#setState('connected')
      throw error
    }
  }

  async sendCommand(bytes: Uint8Array, note?: string): Promise<void> {
    if (this.#state === 'disconnected') throw new Error('Not connected to a printer.')
    if (note) this.#emitter.emit('log', { level: 'info', message: note })
    await this.#transport.write(bytes)
  }

  async disconnect(): Promise<void> {
    for (const off of this.#unsubscribe) off()
    this.#unsubscribe = []
    this.#credits.reset()
    this.#capabilities = null
    await this.#transport.disconnect()
    this.#setState('disconnected')
  }

  /** Most recent status notification, whether solicited or not. */
  get lastStatusBytes(): Uint8Array | null {
    return this.#lastStatusBytes
  }

  /** Write a command and wait for the next status notification, if any. */
  async #request(command: Uint8Array): Promise<Uint8Array | null> {
    const reply = new Promise<Uint8Array | null>((resolve) => {
      const timer = setTimeout(() => {
        if (this.#pendingReply === handler) this.#pendingReply = null
        resolve(null)
      }, this.#queryTimeoutMs)
      const handler = (bytes: Uint8Array) => {
        clearTimeout(timer)
        resolve(bytes)
      }
      this.#pendingReply = handler
    })

    await this.#transport.write(command)
    return reply
  }

  async #query<T>(command: Uint8Array, decode: (bytes: Uint8Array) => T | null): Promise<T | null> {
    const bytes = await this.#request(command)
    return bytes ? decode(bytes) : null
  }

  #setState(state: PrinterState): void {
    this.#state = state
    this.#emitter.emit('state', state)
  }
}

type PrintProgressPhase = PrinterEvents['progress']['phase']

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}
