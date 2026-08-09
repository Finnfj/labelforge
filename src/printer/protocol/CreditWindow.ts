import { DELAY_WITHOUT_CREDITS_MS, DELAY_WITH_CREDITS_MS } from './constants'

/**
 * Credit-based flow control over the `ff03` characteristic.
 *
 * The printer's BLE module bridges to an internal UART with a small buffer and
 * no back-pressure of its own, so writes sent faster than it drains are dropped
 * silently — the label prints with bands missing rather than failing outright.
 * The firmware instead grants credits: each notification says how many more
 * chunks it is ready to take.
 *
 * Two defences against hanging, because the exact semantics are inferred from
 * the vendor SDK rather than documented:
 *
 * - If no credit notification is ever seen, flow control is assumed absent and
 *   writes fall back to a fixed inter-chunk delay.
 * - If credits were flowing and then stop, waiting resumes after a timeout
 *   rather than blocking forever. A stalled print that recovers slowly beats one
 *   that never returns.
 */
export class CreditWindow {
  #credits = 0
  #everSeen = false
  #waiters: Array<() => void> = []

  /** True once the printer has actually granted credits at least once. */
  get hasFlowControl(): boolean {
    return this.#everSeen
  }

  get available(): number {
    return this.#credits
  }

  /** Inter-chunk delay appropriate to whether flow control is active. */
  get delayMs(): number {
    return this.#everSeen ? DELAY_WITH_CREDITS_MS : DELAY_WITHOUT_CREDITS_MS
  }

  /**
   * Handle a `ff03` notification.
   *
   * The vendor SDK treats a value of exactly 4 as "the window is 4", and any
   * other value as an increment. That asymmetry looks odd but is reproduced
   * deliberately: it is what the shipping firmware is known to work with.
   */
  onNotify(bytes: Uint8Array): void {
    if (bytes.length < 2) return
    this.#everSeen = true
    const value = bytes[1]
    if (value === 0x04) this.#credits = 4
    else this.#credits += value
    this.#release()
  }

  /** Wait until a chunk may be sent, then consume one credit. */
  async acquire(options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<void> {
    const { timeoutMs = 1000, signal } = options
    signal?.throwIfAborted()

    // Nothing has ever granted credits: this printer is not using flow control,
    // so pace by delay instead of waiting for a signal that will never come.
    if (!this.#everSeen) return

    if (this.#credits > 0) {
      this.#credits--
      return
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }
      const onAbort = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.#waiters = this.#waiters.filter((w) => w !== finish)
        reject(signal!.reason)
      }
      // Assume one credit rather than stalling indefinitely.
      const timer = setTimeout(() => {
        this.#waiters = this.#waiters.filter((w) => w !== finish)
        finish()
      }, timeoutMs)

      signal?.addEventListener('abort', onAbort, { once: true })
      this.#waiters.push(finish)
    })

    if (this.#credits > 0) this.#credits--
  }

  reset(): void {
    this.#credits = 0
    this.#everSeen = false
    this.#release()
    this.#waiters = []
  }

  #release(): void {
    while (this.#credits > 0 && this.#waiters.length > 0) {
      const waiter = this.#waiters.shift()!
      this.#credits--
      waiter()
    }
  }
}
