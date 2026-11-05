import { ConcurrencyLimiter } from "../../src/utils/ConcurrencyLimiter";

describe("ConcurrencyLimiter", () => {
  test("executes all tasks via run and completes", async () => {
    const limiter = new ConcurrencyLimiter(2);
    const results: number[] = [];

    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        limiter.run(async () => {
          await new Promise((r) => setTimeout(r, 10));
          results.push(n);
        })
      )
    );

    expect(results.sort()).toEqual([1, 2, 3, 4]);
  });

  test("map processes all items and returns results", async () => {
    const limiter = new ConcurrencyLimiter(3);
    const results = await limiter.map([1, 2, 3, 4, 5], async (n) => n * 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  test("exception in one task does not block others", async () => {
    const limiter = new ConcurrencyLimiter(2);
    const results: number[] = [];

    const tasks = [1, 2, 3].map((n) =>
      limiter
        .run(async () => {
          if (n === 2) throw new Error("fail");
          results.push(n);
          return n;
        })
        .catch(() => -1)
    );

    const values = await Promise.all(tasks);
    expect(values).toEqual([1, -1, 3]);
    expect(results).toEqual([1, 3]);
  });

  test("handles concurrency of 1 (sequential)", async () => {
    const limiter = new ConcurrencyLimiter(1);
    const order: number[] = [];

    await limiter.map([1, 2, 3], async (n) => {
      order.push(n);
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(order).toEqual([1, 2, 3]);
  });

  test("handles empty item list", async () => {
    const limiter = new ConcurrencyLimiter(5);
    const results = await limiter.map([], async (n: number) => n);
    expect(results).toEqual([]);
  });

  test("throws on invalid maxConcurrent values", () => {
    expect(() => new ConcurrencyLimiter(0)).toThrow();
    expect(() => new ConcurrencyLimiter(-1)).toThrow();
    expect(() => new ConcurrencyLimiter(NaN)).toThrow();
    expect(() => new ConcurrencyLimiter(Infinity)).toThrow();
  });

  test("respects concurrency limit", async () => {
    const limiter = new ConcurrencyLimiter(2);
    let maxConcurrent = 0;
    let current = 0;

    await limiter.map([1, 2, 3, 4, 5], async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((r) => setTimeout(r, 20));
      current--;
    });

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  test("drain releases multiple slots when tasks complete simultaneously", async () => {
    const limiter = new ConcurrencyLimiter(3);
    const order: number[] = [];

    // All 6 tasks should complete without starvation
    await limiter.map([1, 2, 3, 4, 5, 6], async (n) => {
      await new Promise((r) => setTimeout(r, 5));
      order.push(n);
    });

    expect(order).toHaveLength(6);
    expect(order.sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("map preserves result order even with varying task durations", async () => {
    const limiter = new ConcurrencyLimiter(2);
    const results = await limiter.map([30, 10, 20], async (delay) => {
      await new Promise((r) => setTimeout(r, delay));
      return delay;
    });

    // Results should be in input order, not completion order
    expect(results).toEqual([30, 10, 20]);
  });
});
