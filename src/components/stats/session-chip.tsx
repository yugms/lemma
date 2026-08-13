"use client";

import Link from "next/link";
import { formatElapsed } from "@/lib/format";
import { useElapsed } from "./use-elapsed";

/**
 * A running study session, visible from every page.
 *
 * Renders the dot alone until `useElapsed` produces its first reading, so the
 * markup is identical on the server and on the first client render. Ticks at
 * the hook's default interval — a minute-resolution label doesn't need a
 * per-second timer running on every route.
 */
export function SessionChip({ startedAt }: { startedAt: string }) {
  const elapsed = useElapsed(startedAt);

  return (
    <Link
      href="/stats?scope=session"
      transitionTypes={["nav-lateral"]}
      title="Study session running"
      className="hidden items-center gap-1.5 rounded-sm px-2 py-1 text-[13px] text-muted transition-colors hover:text-fg sm:inline-flex"
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />
      <span className="sr-only">Study session running, </span>
      <span className="tabular-nums">
        {elapsed === null ? "Session" : formatElapsed(elapsed)}
      </span>
    </Link>
  );
}
