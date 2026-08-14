/**
 * Loading placeholders. Each mirrors the shape of the page it stands in for,
 * so the real content lands in the same place and nothing shifts.
 *
 * "Mirrors" is the trap: a placeholder that copies the real component's class
 * list character for character stops matching it the first time the real one
 * changes, and nothing fails when it does. So the shapes that have a real
 * component compose it, and the one geometry that can't be composed —
 * the builder's row grid, which belongs to a `"use client"` module a loading
 * file must not pull in — is a shared constant instead.
 */
import { StatGrid } from "@/components/stat-grid";

/** The builder's label-left, controls-right row. */
export const SPEC_ROW =
  "grid gap-4 border-b border-line py-8 sm:grid-cols-[8.5rem_1fr] sm:gap-10";

function Bar({ className }: { className: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function PageHeaderSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div className="pb-10">
      <Bar className="h-2.5 w-24" />
      <Bar className={`mt-6 h-11 ${wide ? "w-96 max-w-full" : "w-64 max-w-full"}`} />
      <Bar className="mt-5 h-4 w-80 max-w-full" />
    </div>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul className="border-t border-line">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center justify-between gap-6 border-b border-line py-6">
          <div className="min-w-0 flex-1">
            <Bar className="h-4 w-56 max-w-full" />
            <Bar className="mt-2.5 h-2.5 w-40" />
          </div>
          <Bar className="h-3.5 w-3.5 shrink-0" />
        </li>
      ))}
    </ul>
  );
}

export function ProblemCardSkeleton() {
  return (
    <div className="panel-raised p-6 sm:p-9">
      <div className="flex items-center justify-between">
        <Bar className="h-3 w-16" />
        <Bar className="h-5 w-40" />
      </div>
      <Bar className="mt-7 h-5 w-full" />
      <Bar className="mt-2.5 h-5 w-4/5" />
      <div className="mt-8 grid gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Bar key={i} className="h-13 w-full" />
        ))}
      </div>
      <Bar className="mt-8 h-10 w-36" />
    </div>
  );
}

/** Announces the wait for readers who can't see the placeholders. */
export function LoadingAnnouncement({ children }: { children: string }) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {children}
    </span>
  );
}

/** The headline tiles, in the real grid so the two can't drift apart. */
export function StatGridSkeleton({ tiles = 4, columns = 4 }: { tiles?: number; columns?: 3 | 4 }) {
  return (
    // Hidden rather than labelled: `LoadingAnnouncement` is what a screen
    // reader should hear, not four empty tiles.
    <div aria-hidden>
      <StatGrid label="" columns={columns}>
        {Array.from({ length: tiles }, (_, i) => (
          <div key={i} className="bg-surface px-5 py-6">
            <Bar className="h-2.5 w-16" />
            <Bar className="mt-4 h-7 w-20" />
          </div>
        ))}
      </StatGrid>
    </div>
  );
}
