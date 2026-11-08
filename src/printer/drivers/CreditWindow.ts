import type { CreditPacing } from '../dialect'

/**
 * Flow control by credits: no chunk goes without one in hand (ADR 0002).
 *
 * What a grant looks like, and how long to pause between chunks, is the
 * dialect's (`CreditPacing`); this class does the waiting.
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
  #pacing: CreditPacing

  constructor(pacing: CreditPacing) {
    this.#pacing = pacing
  }

  /** True once the printer has actually granted credits at least once. */
  get hasFlowControl(): boolean {
    return this.#everSeen
  }

  get available(): number {
    return this.#credits
  }

  /** Inter-chunk delay appropriate to whether flow control is active. */
  get delayMs(): number {
    return this.#everSeen ? this.#pacing.delayWithCreditsMs : this.#pacing.delayWithoutCreditsMs
  }

  /** Handle a notification on the credits channel. */
  onNotify(bytes: Uint8Array): void {
    const grant = this.#pacing.readGrant(bytes)
    if (!grant) return
    this.#everSeen = true
    if ('set' in grant) this.#credits = grant.set
    else this.#credits += grant.add
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
