"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { streamBuild } from "@/lib/build-stream";
import type { PrescriptionView } from "@/lib/coach-plan";
import type { StatsScope } from "@/lib/analytics";

type Progress = { done: number; total: number; message: string };

/**
 * One coach-designed set, built on click.
 *
 * Only the plan id and the scope go to the server — the topics, level, formats
 * and authoring directives are rebuilt there from this student's own history.
 * The card can't be tampered into generating something else, and the directives
 * that reach the model were never in the browser to begin with.
 */
export function PrescriptionCard({
  plan,
  scope,
}: {
  plan: PrescriptionView;
  scope: StatsScope;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null;

  async function build() {
    setError(null);
    setProgress({ done: 0, total: plan.count, message: "Reading your practice history…" });
    try {
      // Same lazy import as the builder — the Supabase SDK stays off this route
      // until someone actually generates.
      const { ensureUser } = await import("@/lib/auth");
      await ensureUser();
      for await (const event of streamBuild({ mode: "targeted", plan: plan.id, scope })) {
        if (event.type === "status") {
          setProgress((p) => ({ ...(p ?? { done: 0, total: plan.count }), message: event.message }));
        } else if (event.type === "progress") {
          setProgress((p) => ({ message: p?.message ?? "", done: event.done, total: event.total }));
        } else if (event.type === "complete") {
          // Left set on purpose so the button stays locked through navigation.
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
  }

  return (
    <li className="panel flex h-full flex-col justify-between gap-6 p-5">
      <div className="min-w-0">
        <p className="display-md text-[1.05rem] leading-snug">{plan.title}</p>
        <p className="mt-2 text-sm leading-relaxed text-muted">{plan.rationale}</p>
        <ul className="mt-4 space-y-1.5">
          {plan.bullets.map((b) => (
            <li key={b} className="mono-meta flex gap-2 leading-relaxed">
              <span aria-hidden className="text-ghost">
                —
              </span>
              <span className="min-w-0">{b}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-3">
        {progress && (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <span aria-live="polite" className="text-[13px] text-muted">
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
                style={{ width: `${Math.max(3, (progress.done / progress.total) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="aside-rule border-bad py-1 text-[13px] leading-relaxed text-bad">
            {error}
          </p>
        )}

        <button type="button" disabled={busy} onClick={build} className="btn btn-accent w-full">
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
          )}
          {busy ? "Building…" : "Build this set"}
        </button>
      </div>
    </li>
  );
}
