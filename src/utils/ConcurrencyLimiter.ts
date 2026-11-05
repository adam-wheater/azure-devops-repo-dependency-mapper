export class ConcurrencyLimiter {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private maxConcurrent: number) {
    if (!Number.isFinite(maxConcurrent) || maxConcurrent < 1) {
      throw new Error(`maxConcurrent must be a positive integer, got ${maxConcurrent}`);
    }
    this.maxConcurrent = Math.floor(maxConcurrent);
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      this.drain();
    }
  }

  private drain(): void {
    // Release up to (maxConcurrent - running) queued tasks per call.
    // Each next() resolves a promise whose running++ executes in a microtask,
    // so we eagerly release as many slots as are currently available to avoid
    // starvation when multiple tasks complete in rapid succession.
    const available = this.maxConcurrent - this.running;
    for (let i = 0; i < available && this.queue.length > 0; i++) {
      const next = this.queue.shift();
      if (next) next();
    }
  }

  async map<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
    return Promise.all(items.map((item) => this.run(() => fn(item))));
  }
}
