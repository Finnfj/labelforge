import { Emitter } from '../../lib/emitter'
import { buildPrintJob } from './commands'
import {
  ADVERTISED_NAME_PREFIX,
  CHUNK_SIZE,
  DYMO_DOTS_PER_MM,
  PRINTABLE_HEIGHT_DOTS,
  PrintResult,
  RESULT_PREFIX,
  STATUS_DIRECTIVE,
} from './constants'
import type {
  PrintJob,
  PrinterCapabilities,
  PrinterDriver,
  PrinterEvents,
  PrinterState,
  PrinterStatus,
} from '../types'
import type { ConnectOptions, Transport } from '../transport/Transport'

/** How long to wait for the reply to the probe on connect. Non-fatal if none comes. */
const PROBE_TIMEOUT_MS = 3000

/**
 * Fixed allowance on top of the print itself before giving up on a job's result.
 * Captured jobs answered 6.2 s and 9.2 s after their last write, for labels of
 * roughly 20 and 37 mm.
 */
const RESULT_BASE_TIMEOUT_MS = 15000

/** ysfchn/dymo-bluetooth's README: "up to 7 millimeters per second". */
const PRINT_MM_PER_SECOND = 7

export interface DymoPrinterOptions {
  /** Shortened in tests so a silent printer is cheap to assert. */
  probeTimeoutMs?: number
  /** Overrides the timeout otherwise computed from the label's length. */
  resultTimeoutMs?: number
}

/**
 * Drives a DYMO LetraTag LT-200B over a {@link Transport}.
 *
 * **No part of this has been confirmed against real hardware by this project** —
 * every byte sequence comes from docs/DYMO_PROTOCOL.md, itself built from HCI
 * captures of the vendor app cross-checked against github.com/ysfchn/dymo-bluetooth
 * (see docs/THIRD_PARTY.md). `PrinterCapabilities.support` is reported as
 * `'unverified'` for exactly that reason — see `ConnectionPanel.tsx`'s existing
 * warning for that value.
 */
export class DymoBlePrinterDriver implements PrinterDriver {
  readonly kind = 'ble' as const

  #transport: Transport
  #state: PrinterState = 'disconnected'
  #capabilities: PrinterCapabilities | null = null
  #emitter = new Emitter<PrinterEvents>()
  #unsubscribe: Array<() => void> = []
  /** Gets each `ESC R` status byte; returns true once it has the one it wanted. */
  #statusListener: ((status: number) => boolean) | null = null
  /** Ends the current wait early (with no status), e.g. on disconnect. */
  #cancelWait: (() => void) | null = null
  #probeTimeoutMs: number
  #resultTimeoutMs: number | undefined

  constructor(transport: Transport, options: DymoPrinterOptions = {}) {
    this.#transport = transport
    this.#probeTimeoutMs = options.probeTimeoutMs ?? PROBE_TIMEOUT_MS
    this.#resultTimeoutMs = options.resultTimeoutMs
    transport.on('wire', (event) =>
      this.#emitter.emit('wire', {
        dir: event.direction,
        bytes: event.bytes,
        at: event.at,
        note: event.note,
      }),
    )
    transport.on('disconnected', ({ reason }) => {
      this.#capabilities = null
      this.#setState('disconnected')
      this.#cancelWait?.()
      this.#emitter.emit('error', { message: reason })
    })
  }

  get state(): PrinterState {
    return this.#state
  }

  get capabilities(): PrinterCapabilities | null {
    return this.#capabilities
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
        await this.#transport.subscribe('status', (bytes) => this.#onStatusNotify(bytes)),
      )

      // Every capture of the vendor app sends this standalone, undocumented write
      // before the job that follows it — see docs/DYMO_PROTOCOL.md, "Open
      // questions". Its reply is waited for here so it is spent before any job
      // starts, and cannot be mistaken for that job's result.
      const probeReply = this.#waitForStatus(() => true, this.#probeTimeoutMs)
      await this.#transport.write(Uint8Array.of(STATUS_DIRECTIVE[0], STATUS_DIRECTIVE[1], 0x00))
      await probeReply

      this.#capabilities = {
        model: this.#modelFromAdvertisedName(),
        firmware: 'Unknown',
        serial: 'Unknown',
        mac: this.#macFromAdvertisedName() ?? 'Unknown',
        headWidthDots: PRINTABLE_HEIGHT_DOTS,
        chunkSize: CHUNK_SIZE,
        probedAt: Date.now(),
        profileId: 'dymo',
        // Not hardware-confirmed by this project — see the class doc comment.
        support: 'unverified',
        profileAssumed: false,
      }
      this.#setState('connected')
      return this.#capabilities
    } catch (error) {
      this.#setState('error')
      throw error
    }
  }

  #modelFromAdvertisedName(): string {
    const name = this.#transport.device?.name
    return name?.startsWith(ADVERTISED_NAME_PREFIX) ? 'DYMO LetraTag LT-200B' : (name ?? 'Unknown')
  }

  /** The advertised name is `Letratag<MAC-without-colons>` — recover the MAC from it. */
  #macFromAdvertisedName(): string | null {
    const name = this.#transport.device?.name
    if (!name?.startsWith(ADVERTISED_NAME_PREFIX)) return null
    const hex = name.slice(ADVERTISED_NAME_PREFIX.length)
    if (!/^[0-9a-fA-F]{12}$/.test(hex)) return null
    return (hex.match(/.{2}/g) ?? []).join(':').toUpperCase()
  }

  /**
   * No documented standalone status query exists for this device — the only
   * confirmed source of status is the result notification at the end of a print
   * job (see {@link print}). Reported as always-online rather than guessing at a
   * query this project has no evidence the printer answers.
   */
  async getStatus(): Promise<PrinterStatus> {
    return {
      online: this.#state !== 'disconnected',
      batteryPercent: null,
      paperType: null,
      density: null,
      labelHeightDots: null,
      fault: 'none',
    }
  }

  async print(job: PrintJob, opts: { signal?: AbortSignal } = {}): Promise<void> {
    if (this.#state === 'disconnected') throw new Error('Not connected to a printer.')
    this.#setState('printing')

    try {
      const chunks = buildPrintJob(job.bitmap)
      const total = chunks.reduce((n, c) => n + c.length, 0) * job.settings.copies
      let sent = 0

      const progress = (phase: PrinterEvents['progress']['phase'], copy: number) =>
        this.#emitter.emit('progress', { phase, sent, total, copy, copies: job.settings.copies })

      progress('prepare', 0)

      const lengthMm = job.bitmap.heightDots / DYMO_DOTS_PER_MM
      const timeoutMs =
        this.#resultTimeoutMs ??
        RESULT_BASE_TIMEOUT_MS + 2 * (lengthMm / PRINT_MM_PER_SECOND) * 1000

      for (let copy = 1; copy <= job.settings.copies; copy++) {
        opts.signal?.throwIfAborted()
        progress('handshake', copy)

        // Listening before the first write, so a failure reported mid-transfer is
        // not missed. Every capture shows exactly one `ESC R` after a job, once it
        // has printed. Until the job is fully sent, `Success`/`SuccessAlt` can only
        // be a stray (e.g. a late probe reply) and is ignored; a failure is not.
        // After it, `SuccessAlt` (1) is still ignored — ysfchn/dymo-bluetooth
        // reports a provisional "printing" message, which is the likeliest
        // meaning of 1 — and anything else is the result.
        let sentAll = false
        const result = this.#waitForStatus(
          (status) =>
            status === PrintResult.SuccessAlt ? false : sentAll || status !== PrintResult.Success,
          timeoutMs,
        )

        const stopWaiting = () => this.#cancelWait?.()
        opts.signal?.addEventListener('abort', stopWaiting, { once: true })
        let status: number | null
        try {
          for (const chunk of chunks) {
            opts.signal?.throwIfAborted()
            await this.#transport.write(chunk)
            sent += chunk.length
            progress('transfer', copy)
          }
          sentAll = true

          progress('feed', copy)
          status = await result
        } finally {
          stopWaiting()
          opts.signal?.removeEventListener('abort', stopWaiting)
        }
        opts.signal?.throwIfAborted()
        // Through the getter: TypeScript narrowed `#state` at the top of print() and
        // cannot see the transport's disconnect handler changing it since.
        if (this.state === 'disconnected') throw new Error('The printer disconnected.')
        if (status === null) {
          // The label may well be fine — the first one that ended here was — so
          // say so rather than failing it.
          this.#emitter.emit('log', {
            level: 'warn',
            message:
              'The printer never confirmed it finished this label. Check the label; if it ' +
              'printed, nothing is wrong.',
          })
          continue
        }
        if (status === PrintResult.FailedLowBattery) {
          this.#emitter.emit('log', {
            level: 'warn',
            message: 'The printer reported a battery too low to print. Replace the batteries.',
          })
          throw new Error('Print failed: battery too low.')
        }
        if (status === PrintResult.SuccessLowBattery) {
          this.#emitter.emit('log', {
            level: 'warn',
            message:
              'The printer reports this label printed, but with a low battery — it may not ' +
              'manage another with the same ones.',
          })
        } else if (status !== PrintResult.Success && status !== PrintResult.SuccessAlt) {
          throw new Error(`Print failed (printer reported status ${status}).`)
        }
      }

      sent = total
      progress('done', job.settings.copies)
      this.#setState('connected')
    } catch (error) {
      this.#setState('connected')
      throw error
    }
  }

  /**
   * Resolves with the first `ESC R` status `accept` takes, or null after
   * `timeoutMs` or on {@link #cancelWait}. One wait at a time.
   *
   * There is no "discard the first notification" rule here, though there once was:
   * it came from ysfchn/dymo-bluetooth and from misreading our captures as two
   * notifications per job. They show three per *connection* — one when notifications
   * are enabled, one answering the probe, one after the job — so the rule threw away
   * the only result and waited out the timeout on every print.
   */
  #waitForStatus(accept: (status: number) => boolean, timeoutMs: number): Promise<number | null> {
    this.#cancelWait?.()
    return new Promise<number | null>((resolve) => {
      const finish = (status: number | null) => {
        clearTimeout(timer)
        if (this.#statusListener === listener) this.#statusListener = null
        if (this.#cancelWait === cancel) this.#cancelWait = null
        resolve(status)
      }
      const listener = (status: number) => {
        if (!accept(status)) return false
        finish(status)
        return true
      }
      const cancel = () => finish(null)
      const timer = setTimeout(cancel, timeoutMs)
      this.#statusListener = listener
      this.#cancelWait = cancel
    })
  }

  #onStatusNotify(bytes: Uint8Array): void {
    if (bytes.length < 3 || bytes[0] !== RESULT_PREFIX[0] || bytes[1] !== RESULT_PREFIX[1]) return
    this.#statusListener?.(bytes[2])
  }

  async sendCommand(bytes: Uint8Array, note?: string): Promise<void> {
    if (this.#state === 'disconnected') throw new Error('Not connected to a printer.')
    if (note) this.#emitter.emit('log', { level: 'info', message: note })
    await this.#transport.write(bytes)
  }

  async query(): Promise<Uint8Array | null> {
    // No request/response command is confirmed for this device outside a print
    // job's own result notifications — see `getStatus`.
    return null
  }

  async disconnect(): Promise<void> {
    for (const off of this.#unsubscribe) off()
    this.#unsubscribe = []
    this.#cancelWait?.()
    this.#capabilities = null
    await this.#transport.disconnect()
    this.#setState('disconnected')
  }

  #setState(state: PrinterState): void {
    this.#state = state
    this.#emitter.emit('state', state)
  }
}
