"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { streamBuild } from "@/lib/build-stream";

export type BuildProgress = { done: number; total: number; message: string };

/**
 * Run one set build, and hold where it has got to.
 *
 * Three call sites generate sets — the builder form, the material review, and a
 * coach prescription card — and each held its own copy of `ensureUser` →
 * `streamBuild` → a four-branch event switch. They had already drifted over
 * `router.refresh()`, which two of them made and one did not.
 *
 * That refresh is unconditional here. `ensureUser()` may have just minted an
 * anonymous session, and auth is resolved on the server and handed to the
 * header as a prop, so without it the header goes on offering "Sign in" to
 * someone who now has a session and a set. Where the caller was already signed
 * in it costs one no-op render, which is cheaper than three call sites each
 * deciding whether they might have created a user.
 */
export function useBuildRun() {
  const router = useRouter();
  const [progress, setProgress] = useState<BuildProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (body: unknown, total: number, startMessage = "Starting…") => {
      setError(null);
      setProgress({ done: 0, total, message: startMessage });
      try {
        // Loaded on submit, not on mount — the Supabase SDK is the heaviest
        // dependency on these pages and nothing needs it until you generate.
        const { ensureUser } = await import("@/lib/auth");
        await ensureUser();
        router.refresh();
        for await (const event of streamBuild(body)) {
          if (event.type === "status") {
            setProgress((p) => ({ ...(p ?? { done: 0, total }), message: event.message }));
          } else if (event.type === "progress") {
            setProgress((p) => ({ message: p?.message ?? "", done: event.done, total: event.total }));
          } else if (event.type === "complete") {
            // Progress is deliberately left set, so the controls stay locked
            // through the navigation.
            router.push(`/set/${event.setId}`);
            return;
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
        setProgress(null);
      }
    },
    [router]
  );

  return { progress, error, busy: progress !== null, run };
}

/**
 * What a build looks like while it runs, and what it says when it fails.
 *
 * The meter is the whole reason the route streams at all: a targeted build
 * skips both the pool and the templates, so without live progress it reads as
 * a frozen 0/8 for minutes.
 */
export function BuildStatus({
  progress,
  error,
}: {
  progress: BuildProgress | null;
  error: string | null;
}) {
  return (
    <>
      {progress && (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-4">
            <span aria-live="polite" className="text-sm text-muted">
              {progress.message}
            </span>
            <span className="mono-meta">
              {progress.done}/{progress.total}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
            aria-label="Generation progress"
            className="meter meter-live"
          >
            <div
              className="meter-fill"
              // Floored so the bar is never invisible while work is real.
              style={{ width: `${Math.max(3, (progress.done / progress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {error && <p role="alert" className="aside-rule-bad">{error}</p>}
    </>
  );
}
