/** A minimal typed event emitter: `on` returns an unsubscribe function. */
export class Emitter<T> {
  private listeners = new Set<(value: T) => void>()

  on(listener: (value: T) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(value: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(value)
      } catch (error) {
        console.error('Listener failed', error)
      }
    }
  }
}
