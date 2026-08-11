"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowRight, Check, Loader2, Trash2 } from "lucide-react";
import { deleteSet } from "@/app/sets/actions";

export type SetRowData = {
  id: string;
  title: string;
  createdAt: string;
  /**
   * Formatted upstream. "Today" depends on both the clock and the timezone, so
   * deriving it here would give one answer during SSR and another on hydration.
   */
  createdLabel: string;
  total: number;
  difficulty: number;
  attempted: number;
  correct: number;
};

export function SetRow({ set }: { set: SetRowData }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pct = set.total > 0 ? (set.attempted / set.total) * 100 : 0;
  const complete = set.total > 0 && set.attempted >= set.total;
  const started = set.attempted > 0;

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await deleteSet(set.id);
      if (res.error) {
        setError(res.error);
        setConfirming(false);
      }
    });
  }

  return (
    <li
      className={clsx(
        "group relative border-b border-line transition-opacity",
        pending && "opacity-40"
      )}
    >
      <div className="flex items-center gap-4 py-5 pl-1 pr-1 transition-colors group-hover:bg-surface">
        <Link
          href={`/set/${set.id}`}
          transitionTypes={["nav-forward"]}
          className="min-w-0 flex-1 rounded-[3px] px-2 py-1 focus-visible:outline-offset-4"
        >
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="truncate text-[15px] font-medium underline-offset-4 group-hover:underline">
              {set.title}
            </span>
            {complete && (
              <span className="badge badge-ok gap-1">
                <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
                Done
              </span>
            )}
            {started && !complete && (
              <span className="badge badge-accent">
                {set.attempted}/{set.total}
              </span>
            )}
          </div>
          <p className="mono-meta mt-2">
            {set.total} problems
            {/* Review sets span whatever was missed, so they carry no level. */}
            {set.difficulty > 0 && ` · level ${set.difficulty}`} · {set.createdLabel}
          </p>
          {started && (
            <div className="meter mt-3 max-w-64">
              <div
                className={clsx("meter-fill", complete && "bg-ok")}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </Link>

        <div className="flex shrink-0 items-center gap-1">
          {confirming ? (
            <span className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={remove}
                disabled={pending}
                className="btn btn-sm border-bad text-bad hover:bg-bad-wash"
              >
                {pending ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : null}
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="btn btn-sm btn-ghost"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              aria-label={`Delete ${set.title}`}
              // Hidden until hover on pointer devices, but always reachable by
              // keyboard — opacity, not display. Tailwind scopes `group-hover`
              // to `@media (hover: hover)`, which is correct and was also the
              // problem: on a phone the hover never arrives, so this was not a
              // hard control to find, it was one that could not be reached at
              // all. Shown outright where there is no hover to wait for.
              className="tap-44 rounded-[3px] p-2 text-faint opacity-0 transition-all hover:text-bad focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
          <ArrowRight
            aria-hidden
            className="h-3.5 w-3.5 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="pb-4 pl-3 text-sm text-bad">
          {error}
        </p>
      )}
    </li>
  );
}
