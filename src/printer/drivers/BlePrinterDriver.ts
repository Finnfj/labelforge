import { Emitter } from '../../lib/emitter'
import { DEFAULT_HEAD_WIDTH_DOTS } from '../../model/units'
import * as cmd from '../protocol/commands'
import { DEFAULT_CHUNK_SIZE, printDurationMs } from '../protocol/constants'
import { DEFAULT_PROFILE, matchProfile, type PrinterProfile } from '../profiles'
import { CreditWindow } from '../protocol/CreditWindow'
import {
  decodeBattery,
  decodeLabelHeight,
  decodeStatusFlags,
  decodeText,
  faultFromFlags,
} from '../protocol/responses'
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

/**
 * ASCII "OK" — what the printer sends on the status channel when a job finishes.
 * Observed roughly 300 ms after `alignPaperEnd` in a capture of the vendor app.
 */
const DONE_REPLY = 'OK'

/** Long enough for the gap seek to finish; a quiet printer is not an error. */
const DONE_TIMEOUT_MS = 5000

/**
 * Raised when the printer is a model this app knows it cannot drive.
 *
 * Its own type so the UI can present it as a fact about the hardware rather
 * than as a failure — nothing went wrong, the printer simply speaks a different
 * protocol.
 */
export class IncompatiblePrinterError extends Error {
  readonly modelLabel: string
  readonly reason: string

  constructor(modelLabel: string, reason: string) {
    super(`That looks like a ${modelLabel}. ${reason}`.trim())
    this.name = 'IncompatiblePrinterError'
    this.modelLabel = modelLabel
    this.reason = reason
  }
}

export interface BlePrinterOptions {
  /**
   * Which printer to assume before the advertised name is known.
   *
   * Overridden by detection on connect unless `lockProfile` is set, which is
   * what the Diagnostics override uses when detection guesses wrong.
   */
  profile?: PrinterProfile
  /** Skip detection and keep `profile` whatever the printer calls itself. */
  lockProfile?: boolean
  chunkSize?: number
  headWidthDots?: number
  /** Reply timeout. Shortened in tests so a silent printer is cheap to assert. */
  queryTimeoutMs?: number
  /** How long to wait for the end-of-job "OK" between copies. */
  doneTimeoutMs?: number
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
  #profile: PrinterProfile
  #lockProfile: boolean
  #profileAssumed = false
  #chunkSize: number
  #headWidthDots: number
  #queryTimeoutMs: number
  #doneTimeoutMs: number
  #unsubscribe: Array<() => void> = []
  /** Replies arrive as unsolicited notifications, so queries take the next one. */
  #pendingReply: ((bytes: Uint8Array) => void) | null = null
  /** Resolved by an end-of-job "OK" on the status channel. */
  #doneWaiter: (() => void) | null = null
  #lastStatusBytes: Uint8Array | null = null

  constructor(transport: Transport, options: BlePrinterOptions = {}) {
    this.#transport = transport
    this.#profile = options.profile ?? DEFAULT_PROFILE
    this.#lockProfile = options.lockProfile ?? false
    this.#chunkSize = options.chunkSize ?? this.#profile.chunkSize ?? DEFAULT_CHUNK_SIZE
    this.#headWidthDots =
      options.headWidthDots ?? this.#profile.headWidthDots ?? DEFAULT_HEAD_WIDTH_DOTS
    this.#queryTimeoutMs = options.queryTimeoutMs ?? QUERY_TIMEOUT_MS
    this.#doneTimeoutMs = options.doneTimeoutMs ?? DONE_TIMEOUT_MS

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

      // Identify the printer before writing a single byte. An L11-family model
      // cannot parse anything this app sends, so the useful thing to do is say
      // which model it is and stop — not to send it a job it will ignore.
      this.#adoptProfile()

      this.#unsubscribe.push(
        await this.#transport.subscribe('credits', (bytes) => this.#credits.onNotify(bytes)),
      )
      this.#unsubscribe.push(
        await this.#transport.subscribe('status', (bytes) => {
          this.#lastStatusBytes = bytes
          if (decodeText(bytes) === DONE_REPLY) {
            const done = this.#doneWaiter
            this.#doneWaiter = null
            done?.()
          }
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
   * Decide which printer we are talking to, from its advertised name.
   *
   * Runs after the GATT connection is open but before any write. Detection is
   * possible this late only because every documented model in the family shares
   * the same service and characteristics — see the note in `profiles.ts`.
   */
  #adoptProfile(): void {
    if (!this.#lockProfile) {
      const matched = matchProfile(this.#transport.device?.name)
      this.#profileAssumed = matched === null
      const profile = matched ?? DEFAULT_PROFILE
      this.#profile = profile
      this.#chunkSize = profile.chunkSize ?? this.#chunkSize
      this.#headWidthDots = profile.headWidthDots ?? this.#headWidthDots
    }

    // Checked even when the profile was forced. Locking exists so someone whose
    // printer is *misidentified* can get past detection; it is not a way to
    // drive a printer we know ignores everything we send, because there is no
    // experiment there to run.
    if (this.#profile.support === 'incompatible') {
      // Disconnect first, so a refusal does not leave a live GATT link behind.
      void this.#transport.disconnect().catch(() => {})
      throw new IncompatiblePrinterError(this.#profile.label, this.#profile.note ?? '')
    }
  }

  /** The profile in force, for the UI to report. */
  get profile(): PrinterProfile {
    return this.#profile
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

    // A real P50S answers firmware and serial but stays silent on model. The
    // advertised BLE name carries it anyway. Observed forms use either separator
    // — `P50S-F871-BLE` and `P50_2950_BLE` — so split on both; splitting on the
    // underscore alone left the whole string as the "model".
    const advertised = this.#transport.device?.name
    const modelFromName = advertised ? advertised.split(/[-_]/)[0] : null

    return {
      model: model ?? modelFromName ?? 'Unknown',
      firmware: firmware ?? 'Unknown',
      serial: serial ?? 'Unknown',
      mac: mac ?? 'Unknown',
      headWidthDots: this.#headWidthDots,
      chunkSize: this.#chunkSize,
      probedAt: Date.now(),
      profileId: this.#profile.id,
      support: this.#profile.support,
      profileAssumed: this.#profileAssumed,
    }
  }

  async getStatus(): Promise<PrinterStatus> {
    const battery = await this.#query(cmd.getPrinterBattery(), decodeBattery)
    // `10 FF 40`, from the vendor SDK's archived original. The tidied facade's
    // `1F 20 00` does not exist in the vendor code and never answers.
    const flags = await this.#query(cmd.getStatusFlags(), decodeStatusFlags)
    const labelHeight = await this.#query(cmd.getLabelHeight(), decodeLabelHeight)

    return {
      online: this.#state !== 'disconnected',
      batteryPercent: battery,
      paperType: null,
      density: null,
      labelHeightDots: labelHeight,
      fault: faultFromFlags(flags),
    }
  }

  /**
   * Locate the label gap, then read back the measured label height.
   *
   * The sequence is the vendor SDK's own: issue the locate command several times,
   * waiting for an acknowledgement each time, and only then ask for the height —
   * its comment is explicit that asking earlier returns an inaccurate value.
   */
  async calibrateLabelGap(
    options: { passes?: number; onPass?: (pass: number, reply: Uint8Array | null) => void } = {},
  ): Promise<{ labelHeightDots: number | null; passes: Array<Uint8Array | null> }> {
    if (this.#state === 'disconnected') throw new Error('Not connected to a printer.')
    const passes: Array<Uint8Array | null> = []
    const total = options.passes ?? 3

    for (let pass = 1; pass <= total; pass++) {
      const reply = await this.#request(cmd.locateLabel())
      passes.push(reply)
      options.onPass?.(pass, reply)
    }

    return {
      labelHeightDots: await this.#query(cmd.getLabelHeight(), decodeLabelHeight),
      passes,
    }
  }

  async print(job: PrintJob, opts: { signal?: AbortSignal } = {}): Promise<void> {
    if (this.#state === 'disconnected') throw new Error('Not connected to a printer.')
    this.#setState('printing')

    try {
      const image = encodeImage(job.bitmap)
      const framing = cmd.printJobFraming(job.settings)
      // Commands and raster are one stream, chunked without regard for where a
      // command begins — the vendor app does exactly this, and it is the only way
      // every byte gets sent under flow control. See cmd.printJobStream.
      const stream = cmd.printJobStream(framing, image)
      const total = stream.length * job.settings.copies
      let sent = 0

      const progress = (phase: PrintProgressPhase, copy: number) =>
        this.#emitter.emit('progress', {
          phase,
          sent,
          total,
          copy,
          copies: job.settings.copies,
        })

      // Too big for the printer to read before it starts printing, so its own gap
      // seek will go unread. A second, tiny job carries one that will not.
      // Too big for the printer to read before it starts printing, so its own gap
      // seek goes unread. A second, tiny job carries one that does not.
      const seekJob =
        job.settings.followUpSeek !== false && cmd.needsFollowUpSeek(image.length)
          ? cmd.followUpSeekJob(framing, job.bitmap.widthDots)
          : null

      // How long the printer will still be working after the last byte lands.
      // The fixed 5 s this used to wait was shorter than an 80 mm label takes, so
      // the follow-up went out mid-print — queued behind the very raster it
      // exists to get past.
      const printMs = printDurationMs(job.bitmap.heightDots)

      progress('prepare', 0)

      for (let copy = 1; copy <= job.settings.copies; copy++) {
        opts.signal?.throwIfAborted()
        progress('handshake', copy)

        // Configuration is re-sent per copy, inside the job, exactly as the vendor
        // app does it. The sequence itself lives in cmd.printJobFraming, shared
        // with the virtual printer so the two cannot drift.
        await this.#sendJob(stream, framing.epilogue, opts.signal, (written) => {
          sent += written
          progress('transfer', copy)
        })

        if (seekJob) {
          // Strictly after the label is out. Sent any earlier this is one more
          // thing queued behind the raster the printer is still consuming, which
          // is the whole problem being worked around — and it is what the first
          // hardware trial did, because the wait was a flat 5 s against a label
          // that needed 8.5.
          progress('feed', copy)
          await this.#waitForDone(opts.signal, printMs)
          await this.#sendJob(seekJob, framing.epilogue, opts.signal)
        }

        // The printer answers "OK" on the status channel a fraction of a second
        // after the job ends. Waiting for it keeps a multi-copy run from stacking
        // jobs on top of each other; a printer that stays quiet is not an error,
        // so a timeout just carries on.
        if (copy < job.settings.copies) await this.#waitForDone(opts.signal)
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
   * Write one whole job: the stream in credited chunks, then the epilogue.
   *
   * Both the label and the follow-up seek go through here, so there is exactly
   * one place where bytes reach the transport during a print and exactly one
   * definition of what "under flow control" means.
   */
  async #sendJob(
    stream: Uint8Array,
    epilogue: readonly cmd.FramedCommand[],
    signal?: AbortSignal,
    onWritten?: (bytes: number) => void,
  ): Promise<void> {
    for (let offset = 0; offset < stream.length; offset += this.#chunkSize) {
      signal?.throwIfAborted()
      const chunk = stream.subarray(offset, Math.min(offset + this.#chunkSize, stream.length))

      // Wait for room before writing, not after: the buffer we would overrun is
      // on the far side of the link.
      await this.#credits.acquire({ signal })
      await this.#transport.write(chunk)
      onWritten?.(chunk.length)
      await delay(this.#credits.delayMs, signal)
    }

    // Not part of the job stream — the capture shows it as its own transfer,
    // after the rest has gone. Credited like everything else all the same.
    for (const { bytes } of epilogue) {
      await this.#credits.acquire({ signal })
      await this.#transport.write(bytes)
    }
  }

  async sendCommand(bytes: Uint8Array, note?: string): Promise<void> {
    if (this.#state === 'disconnected') throw new Error('Not connected to a printer.')
    if (note) this.#emitter.emit('log', { level: 'info', message: note })
    await this.#transport.write(bytes)
  }

  async query(bytes: Uint8Array, note?: string): Promise<Uint8Array | null> {
    if (this.#state === 'disconnected') throw new Error('Not connected to a printer.')
    if (note) this.#emitter.emit('log', { level: 'info', message: note })
    return this.#request(bytes)
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

  /**
   * Wait for the end-of-job acknowledgement.
   *
   * Resolves `false` on timeout rather than throwing: not every unit need send it,
   * and refusing to print a second copy because an undocumented notification did
   * not arrive would be worse than pressing on.
   */
  async #waitForDone(signal?: AbortSignal, timeoutMs?: number): Promise<boolean> {
    signal?.throwIfAborted()
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(
        () => {
          if (this.#doneWaiter === finish) this.#doneWaiter = null
          resolve(false)
        },
        Math.max(this.#doneTimeoutMs, timeoutMs ?? 0),
      )
      const finish = () => {
        clearTimeout(timer)
        resolve(true)
      }
      this.#doneWaiter = finish
    })
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
