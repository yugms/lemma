/**
 * A queue that a `for await` loop drains while parallel workers push into it.
 *
 * `buildProblemSet` is an async generator, and a generator cannot `yield` from
 * inside a callback. Once authoring and verification run concurrently their
 * progress is produced in exactly that position, so without this the meter
 * could only move between phases — which is precisely the stretch where it used
 * to sit still for minutes.
 *
 * Single consumer. `drain()` ends once `close()` has been called and everything
 * already pushed has been handed over, so nothing queued is dropped on close.
 */
export function asyncQueue<T>() {
  const items: T[] = [];
  let wake: (() => void) | null = null;
  let closed = false;

  const nudge = () => {
    const resume = wake;
    wake = null;
    resume?.();
  };

  return {
    push(item: T): void {
      if (closed) return;
      items.push(item);
      nudge();
    },
    close(): void {
      closed = true;
      nudge();
    },
    async *drain(): AsyncGenerator<T> {
      for (;;) {
        while (items.length > 0) yield items.shift()!;
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}
