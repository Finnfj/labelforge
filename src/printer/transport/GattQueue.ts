/**
 * Serialises every GATT operation in the app onto one chain.
 *
 * Chrome allows exactly one GATT operation in flight per device; overlapping
 * calls reject with "GATT operation already in progress", and because the
 * rejection lands on whichever call happened to be second, the symptom is a
 * random unrelated failure rather than an obvious one. Status polls colliding
 * with a print is the usual way this shows up.
 *
 * Everything goes through here — reads, writes, notification setup — not just
 * the writes in the hot path.
 */
export class GattQueue {
  #tail: Promise<unknown> = Promise.resolve()
  #closed: string | null = null

  get idle(): boolean {
    return this.#pending === 0
  }

  #pending = 0

  run<T>(
    label: string,
    operation: () => Promise<T>,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<T> {
    const { timeoutMs = 5000, signal } = options

    const result = this.#tail.then(async () => {
      if (this.#closed) throw new Error(`${label}: ${this.#closed}`)
      signal?.throwIfAborted()
      return withTimeout(operation(), timeoutMs, label)
    })

    this.#pending++
    // The chain must survive a failed operation, or one error would poison every
    // later call. Errors are still delivered to the caller through `result`.
    this.#tail = result.then(
      () => {
        this.#pending--
      },
      () => {
        this.#pending--
      },
    )
    return result
  }

  /** Reject anything still queued. Called on disconnect so nothing dangles. */
  close(reason: string): void {
    this.#closed = reason
  }

  reopen(): void {
    this.#closed = null
  }
}

export class GattTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} did not complete within ${ms} ms.`)
    this.name = 'GattTimeoutError'
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  if (!Number.isFinite(ms)) return promise
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new GattTimeoutError(label, ms)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
