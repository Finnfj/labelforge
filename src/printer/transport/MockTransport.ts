import { Emitter } from '../../lib/emitter'
import type {
  NotifyChannel,
  Transport,
  TransportDevice,
  TransportEvents,
  TransportState,
} from './Transport'

/**
 * An in-memory transport for tests.
 *
 * It records everything written and lets a test push notifications back, so the
 * driver's command sequence, chunking and flow-control handling can be asserted
 * without a radio. `autoRespond` covers the common case where the driver asks a
 * question and would otherwise wait out its timeout.
 */
export class MockTransport implements Transport {
  readonly kind = 'mock' as const

  writes: Uint8Array[] = []
  #state: TransportState = 'disconnected'
  #handlers = new Map<NotifyChannel, Set<(bytes: Uint8Array) => void>>()
  #emitter = new Emitter<TransportEvents>()

  /** Called after each write; return bytes to deliver on the status channel. */
  autoRespond?: (bytes: Uint8Array) => Uint8Array | undefined

  /** Grant this many credits after each write, mimicking firmware flow control. */
  creditsPerWrite = 0

  /**
   * Model the firmware's credit window rather than just feeding credits back.
   *
   * Set to a window size and the mock keeps its own count: it opens with an
   * `01 04` grant, spends one per write, and hands one back a tick later — the
   * delay being the point, since it is what makes a burst of writes outrun the
   * window the way a real printer's UART buffer does.
   *
   * Any write arriving with the window already empty lands in
   * {@link blindWrites}. On the radio such a write is `writeValueWithoutResponse`
   * into a full buffer, which is to say it may simply never happen.
   */
  creditWindow: number | null = null

  /** Writes made with no credit in hand. Should always be empty during a print. */
  blindWrites: Uint8Array[] = []

  #outstanding = 0

  /** Advertised name, which is what the driver identifies the model from. */
  deviceName: string

  constructor(options: { autoRespond?: MockTransport['autoRespond']; deviceName?: string } = {}) {
    this.autoRespond = options.autoRespond
    this.deviceName = options.deviceName ?? 'P50_TEST_BLE'
  }

  get state(): TransportState {
    return this.#state
  }

  get device(): TransportDevice | null {
    return this.#state === 'ready' ? { id: 'mock', name: this.deviceName } : null
  }

  on = <E extends keyof TransportEvents>(
    event: E,
    handler: (payload: TransportEvents[E]) => void,
  ): (() => void) => this.#emitter.on(event, handler)

  async connect(): Promise<void> {
    this.#state = 'ready'
    this.#emitter.emit('state', 'ready')
  }

  async disconnect(): Promise<void> {
    this.#state = 'disconnected'
    this.#emitter.emit('state', 'disconnected')
  }

  async subscribe(
    channel: NotifyChannel,
    handler: (bytes: Uint8Array) => void,
  ): Promise<() => void> {
    let set = this.#handlers.get(channel)
    if (!set) {
      set = new Set()
      this.#handlers.set(channel, set)
    }
    set.add(handler)
    return () => {
      set.delete(handler)
    }
  }

  async write(bytes: Uint8Array): Promise<void> {
    this.writes.push(bytes)
    this.#emitter.emit('wire', { direction: 'out', bytes, at: 0 })
    if (this.creditWindow != null) {
      if (this.#outstanding <= 0) this.blindWrites.push(bytes)
      else this.#outstanding--
      setTimeout(() => {
        this.#outstanding++
        this.emit('credits', Uint8Array.of(0x01, 0x01))
      }, 0)
    }
    if (this.creditsPerWrite > 0) {
      this.emit('credits', Uint8Array.of(0x01, this.creditsPerWrite))
    }
    const response = this.autoRespond?.(bytes)
    // Delivered on a later tick, as a printer would. Replying inside the write
    // means the answer lands before the caller has started waiting for it, which
    // no radio does and which quietly hid an end-of-job wait that never resolved.
    if (response) setTimeout(() => this.emit('status', response), 0)
  }

  /** Open the credit window, as the printer does shortly after connecting. */
  openCreditWindow(size = this.creditWindow ?? 4): void {
    this.creditWindow = size
    this.#outstanding = size
    this.emit('credits', Uint8Array.of(0x01, size))
  }

  /** Simulate the link dropping, as opposed to a deliberate disconnect. */
  simulateLinkLoss(reason = 'The printer disconnected.'): void {
    this.#state = 'disconnected'
    this.#emitter.emit('state', 'disconnected')
    this.#emitter.emit('disconnected', { reason })
  }

  /** Deliver a notification as if it came from the printer. */
  emit(channel: NotifyChannel, bytes: Uint8Array): void {
    this.#emitter.emit('wire', { direction: 'in', bytes, at: 0, note: channel })
    for (const handler of this.#handlers.get(channel) ?? []) handler(bytes)
  }

  /** Concatenation of every byte written, for comparing against an expected stream. */
  get written(): Uint8Array {
    const total = this.writes.reduce((n, w) => n + w.length, 0)
    const out = new Uint8Array(total)
    let at = 0
    for (const chunk of this.writes) {
      out.set(chunk, at)
      at += chunk.length
    }
    return out
  }

  reset(): void {
    this.writes = []
    this.blindWrites = []
  }
}
