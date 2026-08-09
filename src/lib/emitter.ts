/** Minimal typed event emitter. Handlers that throw are isolated from each other. */
export class Emitter<Events extends Record<string, unknown>> {
  #handlers = new Map<keyof Events, Set<(payload: never) => void>>()

  on<E extends keyof Events>(event: E, handler: (payload: Events[E]) => void): () => void {
    let set = this.#handlers.get(event)
    if (!set) {
      set = new Set()
      this.#handlers.set(event, set)
    }
    set.add(handler as (payload: never) => void)
    return () => {
      set.delete(handler as (payload: never) => void)
    }
  }

  emit<E extends keyof Events>(event: E, payload: Events[E]): void {
    const set = this.#handlers.get(event)
    if (!set) return
    for (const handler of [...set]) {
      try {
        ;(handler as (p: Events[E]) => void)(payload)
      } catch (error) {
        // A broken listener must not abort a print job.
        console.error(`listener for "${String(event)}" threw`, error)
      }
    }
  }

  clear(): void {
    this.#handlers.clear()
  }
}
