import { concatBytes } from '../../lib/bytes'
import { Emitter } from '../../lib/emitter'
import { DEFAULT_HEAD_WIDTH_DOTS } from '../../model/units'
import {
  ALL_NAME_PREFIXES,
  ALL_SERVICES,
  DEFAULT_PROFILE,
  matchProfile,
  type PrinterProfile,
} from '../profiles'
import { CreditWindow } from './CreditWindow'
import type { Dialect, NamedCommand, PlannedJob, Reply } from '../dialect'
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

/** Long enough for the gap seek to finish; a quiet printer is not an error. */
const DONE_TIMEOUT_MS = 5000

/**
 * Raised when the printer reports that it gave up on a job, with its reason.
 *
 * Distinct from silence, which is reported and carried past: the label may well be
 * fine. A printer that says it failed has said the label is not.
 */
export class PrintFailedError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'PrintFailedError'
  }
}

/**
 * Raised when the printer is a model this app knows it cannot drive, or will
 * drive only with the experimental opt-in on.
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
  /**
   * Drive printers whose profile is `experimental`. Off, they are refused like an
   * incompatible model, so nobody sends untested bytes by accident (ADR 0003).
   */
  allowExperimental?: boolean
  chunkSize?: number
  headWidthDots?: number
  /** Reply timeout. Shortened in tests so a silent printer is cheap to assert. */
  queryTimeoutMs?: number
  /**
   * The shortest wait for an end-of-job "OK". A job's own wait is longer when
   * the print plan says so. Shortened in tests so a silent printer is cheap.
   */
  doneTimeoutMs?: number
  /**
   * What the bytes are, whatever the printer turns out to be. Left out, the
   * dialect is the profile's: the assumed one's until the printer is recognised.
   */
  dialect?: Dialect
}

/**
 * Drives a Bluetooth label printer over a {@link Transport}.
 *
 * Every byte it sends and every reply it reads is the dialect's: the print plan,
 * the same one the virtual printer records; the link's service, chunks and
 * pacing; and the conversation's handshake, queries and replies (ADR 0004). This
 * class adds the mechanics: writing, waiting for credits or for the printer,
 * aborting, progress, and disconnection.
 */
export class BlePrinterDriver implements PrinterDriver {
  readonly kind = 'ble' as const

  #transport: Transport
  #state: PrinterState = 'disconnected'
  #capabilities: PrinterCapabilities | null = null
  #emitter = new Emitter<PrinterEvents>()
  /** Null for a link paced by acknowledged writes, which has no credits to wait for. */
  #credits: CreditWindow | null = null
  #profile: PrinterProfile
  #lockProfile: boolean
  #allowExperimental: boolean
  /** Whether the dialect was handed in, rather than taken from the profile. */
  #dialectFixed: boolean
  #profileAssumed = false
  #chunkSize: number
  #headWidthDots: number
  #queryTimeoutMs: number
  #doneTimeoutMs: number
  #dialect: Dialect
  #unsubscribe: Array<() => void> = []
  /** Replies arrive as unsolicited notifications, so queries take the next one. */
  #pendingReply: ((bytes: Uint8Array) => void) | null = null
  /** Resolved by an end-of-job reply on the status channel. */
  #doneWaiter: ((reply: JobReply) => void) | null = null
  /**
   * An end-of-job reply that arrived before anything was waiting for it.
   *
   * It answers the stream, and there is no rule saying it cannot land in the gap
   * between the last write and the driver settling down to wait — the inter-chunk
   * delay alone is a window it could fall into. Latching it means the wait returns
   * at once instead of running to a timeout that is now tens of seconds long, and
   * concluding from that the printer never finished.
   */
  #donePending: JobReply | null = null
  #lastStatusBytes: Uint8Array | null = null

  constructor(transport: Transport, options: BlePrinterOptions = {}) {
    this.#transport = transport
    this.#profile = options.profile ?? DEFAULT_PROFILE
    this.#lockProfile = options.lockProfile ?? false
    this.#allowExperimental = options.allowExperimental ?? false
    this.#dialectFixed = options.dialect !== undefined
    this.#dialect = options.dialect ?? profileDialect(this.#profile)
    this.#chunkSize = options.chunkSize ?? this.#profile.chunkSize ?? this.#dialect.link.chunkSize
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
      this.#credits?.reset()
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

  get dialect(): Dialect {
    return this.#dialect
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
      await this.#transport.connect({
        ...options,
        devices: { namePrefixes: ALL_NAME_PREFIXES, services: ALL_SERVICES },
      })

      // Identify the printer before writing a single byte, or even opening its
      // service, which depends on the dialect it speaks. An L11-family model cannot
      // parse anything this app sends, so the useful thing to do is say which model
      // it is and stop — not to send it a job it will ignore.
      this.#adoptProfile()

      const { link } = this.#dialect
      await this.#transport.open(link.gatt)
      const credits = link.pacing.kind === 'credits' ? new CreditWindow(link.pacing) : null
      this.#credits = credits
      if (credits) {
        this.#unsubscribe.push(
          await this.#transport.subscribe('credits', (bytes) => credits.onNotify(bytes)),
        )
      }
      this.#unsubscribe.push(
        await this.#transport.subscribe('status', (bytes) => {
          this.#lastStatusBytes = bytes
          const reply = this.#dialect.conversation.readReply(bytes)
          if (reply.kind !== 'other') {
            const done = this.#doneWaiter
            this.#doneWaiter = null
            if (done) done(reply)
            else this.#donePending = reply
          }
          const pending = this.#pendingReply
          this.#pendingReply = null
          pending?.(bytes)
        }),
      )

      for (const { bytes } of this.#dialect.conversation.handshake) {
        await this.#transport.write(bytes)
      }

      this.#capabilities = await this.probe()
      this.#setState('connected')
      return this.#capabilities
    } catch (error) {
      this.#setState('error')
      throw error
    }
  }

  /**
   * Decide which printer we are talking to, from its advertised name, and so
   * which dialect it speaks.
   *
   * Runs once the GATT server is connected but before its service is opened:
   * which service to open is the dialect's to say. The chooser asked for every
   * known service up front, which is what makes detecting this late possible.
   */
  #adoptProfile(): void {
    if (!this.#lockProfile) {
      const matched = matchProfile(this.#transport.device?.name)
      this.#profileAssumed = matched === null
      const profile = matched ?? DEFAULT_PROFILE
      this.#profile = profile
      if (!this.#dialectFixed && profile.dialect) {
        this.#dialect = profile.dialect
        this.#chunkSize = profile.chunkSize ?? profile.dialect.link.chunkSize
      } else {
        this.#chunkSize = profile.chunkSize ?? this.#chunkSize
      }
      this.#headWidthDots = profile.headWidthDots ?? this.#headWidthDots
    }

    // Checked even when the profile was forced. Locking exists so someone whose
    // printer is *misidentified* can get past detection; it is not a way to
    // drive a printer we know ignores everything we send, because there is no
    // experiment there to run.
    const { support, label, note } = this.#profile
    if (support === 'incompatible') this.#refuse(label, note ?? '')
    if (support === 'experimental' && !this.#allowExperimental) {
      this.#refuse(
        label,
        'Support for it is experimental: it has not been printed with on our own hardware. ' +
          'Turn on its experimental support under Diagnostics to try it.',
      )
    }
  }

  #refuse(label: string, reason: string): never {
    // Disconnect first, so a refusal does not leave a live GATT link behind.
    void this.#transport.disconnect().catch(() => {})
    throw new IncompatiblePrinterError(label, reason)
  }

  /** The profile in force, for the UI to report. */
  get profile(): PrinterProfile {
    return this.#profile
  }

  /**
   * Read identity off the printer, as its dialect asks for it.
   *
   * Every field is optional: a printer that answers differently should still
   * connect and print.
   */
  async probe(): Promise<PrinterCapabilities> {
    const { model, firmware, serial, mac } = await this.#dialect.conversation.identify(
      (command) => this.#request(command),
      this.#transport.device?.name ?? null,
    )

    return {
      model: model ?? 'Unknown',
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
    const status = await this.#dialect.conversation.status((command) => this.#request(command))
    return { online: this.#state !== 'disconnected', ...status }
  }

  /** Locate the label gap, then read back the measured label height, as the dialect does it. */
  async calibrateLabelGap(
    options: { passes?: number; onPass?: (pass: number, reply: Uint8Array | null) => void } = {},
  ): Promise<{ labelHeightDots: number | null; passes: Array<Uint8Array | null> }> {
    if (this.#state === 'disconnected') throw new Error('Not connected to a printer.')
    const { conversation } = this.#dialect
    if (!conversation.calibrateLabelGap) {
      throw new Error('This printer has no label gap to calibrate.')
    }
    return conversation.calibrateLabelGap((command) => this.#request(command), options)
  }

  async print(job: PrintJob, opts: { signal?: AbortSignal } = {}): Promise<void> {
    if (this.#state === 'disconnected') throw new Error('Not connected to a printer.')
    this.#setState('printing')
    // Anything latched before this print belongs to the last one.
    this.#donePending = null

    try {
      // What goes on the wire is the dialect's to decide, and how its link chunks
      // it. This driver writes the chunks, paced as the link says, and waits where
      // the plan asks it to. Chunked up front, so progress counts what is written.
      const { link } = this.#dialect
      const plan = this.#dialect.planPrint(job.bitmap, job.settings)
      const chunked = plan.copies.map((copy) =>
        copy.jobs.map((plannedJob) => link.chunk(joinParts(plannedJob), this.#chunkSize)),
      )
      const total = chunked.flat(2).reduce((n, chunk) => n + chunk.length, 0)
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

      for (const [index, plannedCopy] of plan.copies.entries()) {
        const copy = index + 1
        opts.signal?.throwIfAborted()
        progress('handshake', copy)

        for (const [jobIndex, plannedJob] of plannedCopy.jobs.entries()) {
          opts.signal?.throwIfAborted()
          await this.#sendJob(
            chunked[index][jobIndex],
            plannedJob.epilogue,
            opts.signal,
            (written) => {
              sent += written
              progress('transfer', copy)
            },
          )
          if (plannedJob.waitMs === null) continue
          progress('feed', copy)
          if (this.#takeReply(await this.#waitForDone(opts.signal, plannedJob.waitMs))) continue
          this.#warnSilent('stopped')
          break
        }

        // What makes `done` mean done: the printer is still printing — a full-height
        // label for ten seconds after its last byte — and a label it never finished
        // becomes visible only by not being acknowledged. A copy cut short waits too,
        // so the printer has stopped moving paper before anything else is sent.
        if (plannedCopy.finishWaitMs !== null) {
          progress('feed', copy)
          const reply = await this.#waitForDone(opts.signal, plannedCopy.finishWaitMs)
          if (!this.#takeReply(reply)) this.#warnSilent('unfinished')
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
   * Act on an end-of-job reply: false for silence, true once the job is done.
   *
   * A failure ends the print, since the printer has said the label is not fine.
   * A warning that came with a finished job is passed on.
   */
  #takeReply(reply: JobReply | null): boolean {
    if (!reply) return false
    if (reply.kind === 'failed') throw new PrintFailedError(reply.reason)
    if (reply.warning) this.#emitter.emit('log', { level: 'warn', message: reply.warning })
    return true
  }

  /** Say what a printer's silence means, in words that hold for any dialect. */
  #warnSilent(meaning: 'stopped' | 'unfinished'): void {
    this.#emitter.emit('log', {
      level: 'warn',
      message:
        meaning === 'stopped'
          ? // Carrying on regardless would send the next job into a printer still
            // moving paper, which is what lost the label last time.
            'The printer did not acknowledge part of this label, so the rest of it was not ' +
            'sent. The label is incomplete — check the battery, and try it without ' +
            'splitting.'
          : // Reported rather than thrown, because the label may well be fine and
            // refusing would be worse than saying so.
            'The printer never confirmed it finished this label. It may have stopped part-way ' +
            'through — check the label, and check the battery, since a flat one prints slowly ' +
            'and can give up mid-raster.',
    })
  }

  /**
   * Write one whole job: its chunks, paced as the link says, then the epilogue.
   *
   * Every job of a print goes through here, so there is exactly one place where
   * bytes reach the transport during a print and exactly one definition of what
   * "under flow control" means. On a link paced by credits, no chunk goes without
   * one (ADR 0002). On one paced by acknowledged writes, each write resolves only
   * once the printer has acknowledged it, and that is the whole of the pacing.
   */
  async #sendJob(
    chunks: readonly Uint8Array[],
    epilogue: readonly NamedCommand[],
    signal?: AbortSignal,
    onWritten?: (bytes: number) => void,
  ): Promise<void> {
    const credits = this.#credits
    for (const chunk of chunks) {
      signal?.throwIfAborted()
      // Wait for room before writing, not after: the buffer we would overrun is
      // on the far side of the link.
      await credits?.acquire({ signal })
      await this.#transport.write(chunk)
      onWritten?.(chunk.length)
      if (credits) await delay(credits.delayMs, signal)
    }

    // Not part of the job stream — the capture shows it as its own transfer,
    // after the rest has gone. Paced like everything else all the same.
    for (const { bytes } of epilogue) {
      await credits?.acquire({ signal })
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
    this.#credits?.reset()
    this.#capabilities = null
    await this.#transport.disconnect()
    this.#setState('disconnected')
  }

  /** Most recent status notification, whether solicited or not. */
  get lastStatusBytes(): Uint8Array | null {
    return this.#lastStatusBytes
  }

  /**
   * Wait for the end-of-job reply.
   *
   * Resolves null on timeout rather than throwing: not every unit need send it,
   * and refusing to print a second copy because an undocumented notification did
   * not arrive would be worse than pressing on.
   */
  async #waitForDone(signal?: AbortSignal, timeoutMs?: number): Promise<JobReply | null> {
    signal?.throwIfAborted()
    const latched = this.#donePending
    if (latched) {
      this.#donePending = null
      return latched
    }
    return new Promise<JobReply | null>((resolve) => {
      const timer = setTimeout(
        () => {
          if (this.#doneWaiter === finish) this.#doneWaiter = null
          resolve(null)
        },
        Math.max(this.#doneTimeoutMs, timeoutMs ?? 0),
      )
      const finish = (reply: JobReply) => {
        clearTimeout(timer)
        resolve(reply)
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

  #setState(state: PrinterState): void {
    this.#state = state
    this.#emitter.emit('state', state)
  }
}

type PrintProgressPhase = PrinterEvents['progress']['phase']

/** A reply that ends a job, one way or the other. */
type JobReply = Exclude<Reply, { kind: 'other' }>

/**
 * The dialect a profile's printers speak. An incompatible profile names none, and
 * is refused before a byte is sent, so its stand-in is never spoken.
 */
function profileDialect(profile: PrinterProfile): Dialect {
  return profile.dialect ?? DEFAULT_PROFILE.dialect!
}

/**
 * A job's parts as the one byte stream the printer parses.
 *
 * The printer reads a byte stream; write boundaries mean nothing to it, and
 * everything written outside the paced chunk loop is written blind. So the whole
 * job is chunked as one stream, commands and raster together, and every byte is
 * paced (ADR 0002). It is also what the vendor app does.
 */
function joinParts(job: PlannedJob): Uint8Array {
  return concatBytes(job.parts.map((part) => part.bytes))
}

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
