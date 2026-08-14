"use client";

import clsx from "clsx";
import { Check, Eye, RotateCcw, X } from "lucide-react";
import { Math, Prose } from "@/components/latex";
import { CorrectOrder } from "@/components/problem-inputs/ordering";
import type { CheckResponse, PreparedProblem } from "@/lib/ai/schemas";

/**
 * What the student is told once the answer is in: the mark, the key, the
 * feedback, the offer of a second attempt, and the worked solution.
 *
 * Split from the inputs because nothing here is format dispatch — it renders
 * whatever the grader sent back, and it is what changes when the *teaching*
 * after an answer changes rather than when a new format lands.
 */
export function Verdict({
  problem,
  result,
  retryOffered,
  busy,
  onRetry,
  ref,
}: {
  problem: PreparedProblem;
  result: CheckResponse;
  retryOffered: boolean;
  busy: boolean;
  onRetry: () => void;
  /** The shell moves focus here when grading swaps out the controls. */
  ref: React.Ref<HTMLDivElement>;
}) {
  // Only ever read inside `{!result.revealed && …}` — a revealed answer gets its
  // own region further down and never consults this.
  const tone = result.correct ? "ok" : "bad";
  const choices = problem.choices ?? [];
  const key = result.answer;
  // Every incorrect option, not just the one picked: the rationales explain why
  // each was tempting, and reading the traps you avoided is where most of the
  // learning in this block is.
  const wrongIds = new Set(
    key?.correct_choice_ids
      ? choices.map((c) => c.id).filter((id) => !key.correct_choice_ids!.includes(id))
      : key?.correct_choice_id
        ? choices.map((c) => c.id).filter((id) => id !== key.correct_choice_id)
        : []
  );
  const choiceNotes = (result.choice_notes ?? []).filter((n) => wrongIds.has(n.choice_id));

  return (
    <div className="mt-9 space-y-7">
      <div
        ref={ref}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className="scroll-mt-24 outline-none"
      >
        {!result.revealed && (
          <div
            className={clsx(
              "stamp flex items-center gap-3 border-t pt-6",
              tone === "ok" ? "border-ok" : "border-bad"
            )}
          >
            <span
              className={clsx(
                "flex h-8 w-8 items-center justify-center rounded-full",
                tone === "ok" ? "bg-ok-wash text-ok" : "bg-bad-wash text-bad"
              )}
            >
              {tone === "ok" ? (
                <Check className="h-4.5 w-4.5" strokeWidth={2.5} aria-hidden />
              ) : (
                <X className="h-4.5 w-4.5" strokeWidth={2.5} aria-hidden />
              )}
            </span>
            <p
              className={clsx(
                "display-md text-[1.75rem] leading-none",
                tone === "ok" ? "text-ok" : "text-bad"
              )}
            >
              {result.correct ? "Correct" : "Not quite"}
            </p>
          </div>
        )}
        {result.revealed && (
          <div className="flex items-center gap-2.5 border-t border-line pt-6">
            <Eye className="h-4 w-4 text-faint" aria-hidden />
            <p className="eyebrow">Solution revealed</p>
          </div>
        )}
      </div>

      {/* The second attempt's own outcome. The verdict above is the first
          attempt's and stays that way — it is what scored the set. */}
      {result.retry && (
        <div
          className={clsx(
            "flex items-center gap-2.5 border-t pt-6",
            result.retry.correct ? "border-ok" : "border-line"
          )}
        >
          {result.retry.correct ? (
            <Check className="h-4 w-4 shrink-0 text-ok" strokeWidth={2.5} aria-hidden />
          ) : (
            <X className="h-4 w-4 shrink-0 text-bad" strokeWidth={2.5} aria-hidden />
          )}
          <p className="text-sm">
            <span className={result.retry.correct ? "text-ok" : "text-bad"}>
              {result.retry.correct ? "Got it on the second try" : "Second try missed too"}
            </span>
            <span className="text-muted">
              {result.retry.correct
                ? " — the set still counts the first answer, but this is the one that means you know it."
                : " — work through the steps below."}
            </span>
          </p>
        </div>
      )}

      {!result.correct && key && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="eyebrow">Answer</span>
          {key.value_html !== undefined && <Math html={key.value_html} />}
          {key.blanks?.map((b) => (
            <span key={b.index} className="flex items-baseline gap-1.5">
              <span className="mono-meta">{b.index}</span>
              <Math html={b.html} />
            </span>
          ))}
          {key.correct_choice_ids && (
            <span className="font-mono text-sm">{key.correct_choice_ids.join(", ")}</span>
          )}
        </div>
      )}

      {/* Ordering shows the sequence in full — a list of letters would make
          the student re-map them back onto the steps themselves. */}
      {!result.correct && key?.correct_order && (
        <div>
          <span className="eyebrow">The right order</span>
          <CorrectOrder steps={problem.items ?? []} order={key.correct_order} />
        </div>
      )}

      {result.feedback && (
        <div className="aside-rule enter-rise py-0.5">
          <p className="eyebrow">What likely went wrong</p>
          <Prose
            html={result.feedback.what_went_wrong_html}
            className="mt-2 text-sm leading-relaxed text-muted"
          />
          <p className="mt-2.5 text-sm leading-relaxed text-muted">
            <span className="text-fg">Try this: </span>
            <Prose html={result.feedback.next_hint_html} as="span" className="inline" />
          </p>
        </div>
      )}

      {/* The second attempt, offered before the answer key is handed over —
          revealing it first would make this a copying exercise. */}
      {retryOffered && (
        <div className="border-t border-line pt-6">
          <button type="button" onClick={onRetry} disabled={busy} className="btn btn-outline">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Try again
          </button>
          <p className="mono-meta mt-3">
            One more attempt, with the hint. Your first answer is what counts for the set —
            this is for you.
          </p>
        </div>
      )}

      {/* Why each wrong option was tempting — authored with the problem and
          until now only ever read by the feedback model. */}
      {choiceNotes.length > 0 && (
        <div className="border-t border-line pt-6">
          <p className="eyebrow">Why the other options look right</p>
          <ul className="mt-4 space-y-3">
            {choiceNotes.map((n) => (
              <li key={n.choice_id} className="grid grid-cols-[1.75rem_1fr] gap-x-2">
                <span className="mono-meta leading-6">{n.choice_id}</span>
                <Prose html={n.html} className="text-sm leading-relaxed text-muted" />
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.explanation && (
        <details
          className="group border-t border-line pt-6"
          open={result.revealed || !result.correct}
        >
          <summary className="inline-flex items-center gap-2 transition-colors hover:text-accent">
            <svg
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden
              className="h-3 w-3 text-faint transition-transform duration-200 group-open:rotate-90"
            >
              <path d="M4.5 2.5 8 6l-3.5 3.5" />
            </svg>
            <span className="eyebrow">Step-by-step solution</span>
          </summary>
          <ol className="mt-6 space-y-5">
            {result.explanation.steps.map((s, i) => (
              <li key={i} className="grid grid-cols-[1.75rem_1fr] gap-x-2">
                <span className="mono-meta leading-6">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  {s.math_html && (
                    <div className="mb-1.5">
                      <Math html={s.math_html} />
                    </div>
                  )}
                  <Prose html={s.note_html} className="text-sm leading-relaxed text-muted" />
                </div>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
