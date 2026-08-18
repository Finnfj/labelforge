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
    if (this.creditsPerWrite > 0) {
      this.emit('credits', Uint8Array.of(0x01, this.creditsPerWrite))
    }
    const response = this.autoRespond?.(bytes)
    if (response) this.emit('status', response)
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
  }
}
