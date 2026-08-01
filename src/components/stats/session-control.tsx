"use client";

import { useState, useTransition } from "react";
import { Loader2, Play, Square } from "lucide-react";
import { endStudySession, startStudySession } from "@/app/stats/actions";
import { formatElapsed } from "@/lib/format";
import type { StudySession } from "@/lib/study-session";
import { useElapsed } from "./use-elapsed";

/**
 * Start / end the study session that `?scope=session` measures.
 *
 * The session is a row, not a cookie, so it outlives sign-out and follows the
 * student to another device — which is the only reason the control is worth
 * having over "last 24 hours".
 *
 * Date labels arrive pre-formatted: computing them here would read the server
 * clock during SSR and the browser clock on hydration, which is a mismatch the
 * moment the two disagree about what day it is.
 */
export function SessionControl({
  session,
  startedLabel,
  endedLabel,
  answered,
  accuracy,
}: {
  session: StudySession | null;
  startedLabel: string;
  endedLabel: string;
  /** Null when the page isn't scoped to the session — the counts on screen are
   *  then about some other window, and saying "0 answered" would be a lie. */
  answered: number | null;
  accuracy: number | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const active = session && !session.endedAt ? session : null;
  const elapsed = useElapsed(active?.startedAt ?? null);

  const run = (action: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
    });
  };

  return (
    <div className="panel flex flex-wrap items-center justify-between gap-x-6 gap-y-4 px-5 py-4">
      <div className="min-w-0">
        {active ? (
          <>
            <p className="flex items-center gap-2 text-sm">
              {/* The word carries the state; the dot is decoration. */}
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" />
              <span className="font-medium">Session running</span>
              {elapsed !== null && (
                <span className="text-muted">· {formatElapsed(elapsed)}</span>
              )}
            </p>
            <p className="mono-meta mt-1.5">
              {answered !== null ? (
                <>
                  {answered} answered
                  {accuracy !== null && ` · ${accuracy}% correct`} since {startedLabel}
                </>
              ) : (
                <>Started {startedLabel} · switch to This session for its numbers</>
              )}
            </p>
          </>
        ) : session ? (
          <>
            <p className="text-sm font-medium">No session running</p>
            <p className="mono-meta mt-1.5">Last one ended {endedLabel}</p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium">No session yet</p>
            <p className="mono-meta mt-1.5">
              Start one to measure a stretch of practice on its own
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm text-bad">
            {error}
          </p>
        )}
      </div>

      {active ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(endStudySession)}
          className="btn btn-outline btn-sm shrink-0"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Square className="h-3 w-3" aria-hidden />
          )}
          End session
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(startStudySession)}
          className="btn btn-solid btn-sm shrink-0"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Play className="h-3 w-3" aria-hidden />
          )}
          Start session
        </button>
      )}
    </div>
  );
}
