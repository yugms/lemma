import { describe, expect, it } from "vitest";
import { createCallPool } from "@/lib/ai/provider";
import { asyncQueue } from "@/lib/async-queue";

/** A promise plus the handle that settles it, so a test can control timing. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createCallPool", () => {
  it("never runs more than the limit at once", async () => {
    const pool = createCallPool(3);
    let active = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 20 }, () =>
        pool(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        })
      )
    );

    expect(peak).toBe(3);
    expect(active).toBe(0);
  });

  it("releases the slot when the task throws", async () => {
    const pool = createCallPool(1);
    await expect(
      pool(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    // A leaked slot would deadlock this rather than fail it.
    await expect(pool(async () => "after")).resolves.toBe("after");
  });

  it("holds a queued task until a slot frees, then runs it", async () => {
    const pool = createCallPool(1);
    const gate = deferred();
    const order: string[] = [];

    const first = pool(async () => {
      order.push("first:start");
      await gate.promise;
      order.push("first:end");
    });
    const second = pool(async () => {
      order.push("second:start");
    });

    // Let both tasks reach the pool before releasing the first.
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual(["first:start"]);

    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("passes the task's return value through", async () => {
    const pool = createCallPool(2);
    await expect(pool(async () => 42)).resolves.toBe(42);
  });
});

describe("asyncQueue", () => {
  it("yields items pushed before draining starts", async () => {
    const q = asyncQueue<number>();
    q.push(1);
    q.push(2);
    q.close();

    const seen: number[] = [];
    for await (const item of q.drain()) seen.push(item);
    expect(seen).toEqual([1, 2]);
  });

  it("wakes a waiting consumer when an item arrives late", async () => {
    const q = asyncQueue<string>();
    const seen: string[] = [];

    const consumer = (async () => {
      for await (const item of q.drain()) seen.push(item);
    })();

    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual([]);

    q.push("a");
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual(["a"]);

    q.push("b");
    q.close();
    await consumer;
    expect(seen).toEqual(["a", "b"]);
  });

  // The build closes the queue from a `finally` the instant the round settles,
  // which routinely lands in the same tick as the last progress event.
  it("drains what was already queued before closing", async () => {
    const q = asyncQueue<number>();
    const consumer = (async () => {
      const seen: number[] = [];
      for await (const item of q.drain()) seen.push(item);
      return seen;
    })();

    await new Promise((r) => setTimeout(r, 5));
    q.push(1);
    q.push(2);
    q.close();

    await expect(consumer).resolves.toEqual([1, 2]);
  });

  it("ends the consumer when closed with nothing queued", async () => {
    const q = asyncQueue<number>();
    const consumer = (async () => {
      const seen: number[] = [];
      for await (const item of q.drain()) seen.push(item);
      return seen;
    })();

    await new Promise((r) => setTimeout(r, 5));
    q.close();
    await expect(consumer).resolves.toEqual([]);
  });
});
