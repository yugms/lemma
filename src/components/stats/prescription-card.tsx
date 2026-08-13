"use client";

import { Loader2, Sparkles } from "lucide-react";
import { BuildStatus, useBuildRun } from "@/components/build-run";
import type { PrescriptionView } from "@/lib/coach-plan";
import type { StatsScope } from "@/lib/analytics";

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
  const { progress, error, busy, run } = useBuildRun();

  const build = () =>
    run(
      { mode: "targeted", plan: plan.id, scope },
      plan.count,
      "Reading your practice history…"
    );

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
        <BuildStatus progress={progress} error={error} />

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
