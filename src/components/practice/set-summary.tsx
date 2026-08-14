"use client";

import Link from "next/link";
import clsx from "clsx";
import { ArrowRight, Check, Eye, RotateCcw, X } from "lucide-react";
import { Prose } from "@/components/latex";
import { formatDuration } from "@/lib/format";
import type { CheckResponse, PreparedProblem } from "@/lib/ai/schemas";
import type { Outcome } from "@/lib/progress";

export type Outcomes = Record<string, Outcome>;

export type Tally = {
  correct: number;
  wrong: number;
  revealed: number;
  answered: number;
};

/**
 * The set-complete debrief.
 *
 * A different page rendered from the same route as the practice engine — its
 * own `<h1>`, its own exits, and nothing on it is an input. It reads the
 * engine's state rather than owning any: everything here comes from payloads
 * already in hand, so closing a set costs no extra request.
 */
export function SetSummary({
  set,
  problems,
  outcomes,
  results,
  tally,
  sittingMs,
  hasAccount,
  onGo,
  ref,
}: {
  set: { id: string; title: string };
  problems: PreparedProblem[];
  outcomes: Outcomes;
  /** Graded payloads, for the diagnoses written at submission time. */
  results: Record<string, CheckResponse>;
  tally: Tally;
  /**
   * How long this sitting took. Null when the student arrived straight at an
   * already-finished set, where the number would be about some earlier day.
   */
  sittingMs: number | null;
  /** Review and stats are account-gated; don't offer a guest a wall. */
  hasAccount: boolean;
  onGo: (index: number) => void;
  /** The engine moves focus here when the summary replaces the card. */
  ref: React.Ref<HTMLHeadingElement>;
}) {
  const denominator = tally.answered;
  const pct = denominator > 0 ? Math.round((tally.correct / denominator) * 100) : 0;

  /** What this sitting actually produced: the misses, grouped, with the
   *  grader's read on them. */
  const missedTopics = new Map<string, number>();
  const notes: { topic: string; html: string }[] = [];
  let recovered = 0;
  for (const p of problems) {
    const o = outcomes[p.id];
    const res = results[p.id];
    if (res?.retry?.correct) recovered++;
    if (o === true || o === undefined) continue;

    const topic = p.topic_title ?? "This set";
    missedTopics.set(topic, (missedTopics.get(topic) ?? 0) + 1);
    // The grader's read on this specific miss — written at submission time
    // and, until now, only ever visible on the card you had to be looking at.
    if (res?.feedback && notes.length < 4) {
      notes.push({ topic, html: res.feedback.what_went_wrong_html });
    }
  }
  const missed = [...missedTopics.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="mx-auto max-w-2xl">
      <p className="eyebrow eyebrow-accent">Set complete</p>
      <h1
        ref={ref}
        tabIndex={-1}
        className="display mt-6 text-[clamp(3.5rem,10vw,5.5rem)] leading-none tracking-[-0.03em] tabular-nums outline-none"
      >
        {tally.correct}
        <span className="text-faint">/{denominator}</span>
      </h1>
      <p className="mt-4 text-prose text-muted">
        {denominator > 0 ? `${pct}% correct` : "No answers graded"}
        {tally.revealed > 0 && ` · ${tally.revealed} revealed`}
        {sittingMs !== null && ` · ${formatDuration(sittingMs)}`}
      </p>

      {recovered > 0 && (
        <p className="mono-meta mt-3 flex items-center gap-2">
          <RotateCcw className="h-3 w-3 text-ok" aria-hidden />
          <span className="text-ok">{recovered} put right on a second attempt</span>
        </p>
      )}

      {missed.length > 0 && (
        <section className="mt-10 border-t border-line pt-8">
          <p className="eyebrow">Where the misses were</p>
          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
            {missed.map(([topic, n]) => (
              <li key={topic} className="mono-meta">
                {topic}
                <span className="text-bad"> · {n}</span>
              </li>
            ))}
          </ul>

          {/* The diagnoses written while grading. They were only ever visible
              on the card you happened to be looking at; this is the first
              place they read as a pattern rather than as one-offs. */}
          {notes.length > 0 && (
            <ul className="mt-6 space-y-4">
              {notes.map((n, i) => (
                <li key={i} className="aside-rule py-0.5">
                  <p className="eyebrow">{n.topic}</p>
                  <Prose
                    html={n.html}
                    className="mt-1.5 text-[13px] leading-relaxed text-muted"
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="mt-10 border-t border-line pt-8">
        <p className="eyebrow">Problem by problem</p>
        <ul className="mt-5 grid gap-2">
          {problems.map((p, i) => {
            const o = outcomes[p.id];
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onGo(i)}
                  className="group flex w-full items-center gap-4 rounded-sm border border-line px-4 py-3 text-left transition-colors hover:border-accent-line hover:bg-surface"
                >
                  <span className="mono-meta w-6 shrink-0">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={clsx(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                      o === true && "bg-ok-wash text-ok",
                      o === false && "bg-bad-wash text-bad",
                      o === null && "bg-sunk text-faint",
                      o === undefined && "border border-dashed border-line-strong"
                    )}
                  >
                    {o === true && <Check className="h-3 w-3" strokeWidth={3} aria-hidden />}
                    {o === false && <X className="h-3 w-3" strokeWidth={3} aria-hidden />}
                    {o === null && <Eye className="h-3 w-3" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted transition-colors group-hover:text-fg">
                    {p.topic_title ?? `Problem ${i + 1}`}
                  </span>
                  <span className="sr-only">
                    {o === true
                      ? "Correct"
                      : o === false
                        ? "Incorrect"
                        : o === null
                          ? "Revealed"
                          : "Not attempted"}
                  </span>
                  <ArrowRight
                    aria-hidden
                    className="h-3.5 w-3.5 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Two real exits rather than a dead end: the misses are the reason to
          go to /review, and /stats is where they turn into a pattern. */}
      <div className="mt-10 flex flex-wrap gap-3">
        {hasAccount && tally.wrong + tally.revealed > 0 ? (
          <Link href="/review" transitionTypes={["nav-forward"]} className="btn btn-accent">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Practise what you missed
          </Link>
        ) : (
          <Link href="/build" transitionTypes={["nav-lateral"]} className="btn btn-accent">
            Build another set
          </Link>
        )}
        {hasAccount && (
          <Link href="/stats" transitionTypes={["nav-forward"]} className="btn btn-outline">
            Full stats
          </Link>
        )}
        <Link href={`/set/${set.id}`} transitionTypes={["nav-back"]} className="btn btn-ghost">
          Set overview
        </Link>
      </div>
    </div>
  );
}
