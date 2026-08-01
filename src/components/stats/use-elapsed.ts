"use client";

import { useEffect, useState } from "react";

/**
 * Milliseconds since `startedAt`, or null until the first tick.
 *
 * Two React Compiler rules shape this. `react-hooks/purity` forbids reading the
 * clock during render, and `react-hooks/set-state-in-effect` forbids an effect
 * setting state synchronously — so the effect only ever schedules, and the very
 * first value arrives on a macrotask. The null first render is a bonus: the
 * server HTML and the initial client render agree, so there's no hydration
 * mismatch to paper over.
 */
export function useElapsed(startedAt: string | null, intervalMs = 30_000): number | null {
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (!startedAt) return;
    const start = Date.parse(startedAt);
    const tick = () => setElapsed(Date.now() - start);
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [startedAt, intervalMs]);

  // A stale reading would otherwise survive the session ending.
  return startedAt ? elapsed : null;
}
