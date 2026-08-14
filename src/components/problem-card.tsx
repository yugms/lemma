"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Prose } from "@/components/latex";
import { AnswerInput } from "@/components/problem-inputs/answer-input";
import { Verdict } from "@/components/problem-verdict";
import type { CheckResponse, PreparedProblem } from "@/lib/ai/schemas";
import { STYLE_LABELS } from "@/lib/format";

export type { CheckResponse };

/**
 * One problem, from asked to answered.
 *
 * The card is a shell over two halves that share only the attempt: the inputs
 * (`AnswerInput`, which is what a new format changes) and the graded region
 * (`Verdict`, which is what a change to the teaching changes). This file owns
 * the attempt lifecycle between them — busy, error, retry, and who is allowed
 * to see the answer key.
 */
export function ProblemCard({
  problem,
  index,
  total,
  initialResult = null,
  locked = false,
  quiet = false,
  onCheck,
  onDone,
}: {
  problem: PreparedProblem;
  index: number;
  total: number;
  /** Pre-graded outcome, when returning to a problem already finished. */
  initialResult?: CheckResponse | null;
  /**
   * This problem already has an outcome on record but the payload hasn't
   * arrived yet. Answering it again would be a submission the student can only
   * lose by, so the controls stay inert until the history lands.
   */
  locked?: boolean;
  /**
   * Quiz conditions: no hint, no giving up, and no verdict. The card confirms
   * the answer was taken and says nothing about it — the server withholds the
   * same things, so this is presentation, not enforcement.
   */
  quiet?: boolean;
  onCheck: (
    action: "answer" | "reveal" | "retry",
    answer?: unknown
  ) => Promise<CheckResponse>;
  onDone: (correct: boolean | null) => void;
}) {
  const [showHint, setShowHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckResponse | null>(initialResult);
  const [error, setError] = useState<string | null>(null);
  /** The student took the offered second attempt and the inputs are live again. */
  const [retrying, setRetrying] = useState(false);

  const verdictRef = useRef<HTMLDivElement>(null);
  const gradedHere = useRef(false);
  const statementId = useId();

  const answered = result !== null;
  const retryOffered = result?.can_retry === true && !retrying;
  const inert = (answered && !retrying) || locked;

  /**
   * Whether the inputs may show a verdict on themselves.
   *
   * `quiet` has to be part of this. Under quiz conditions the response carries
   * no answer key, so every option looked "not the correct one" and the
   * student's own pick was styled as the wrong answer — on every question,
   * right or wrong, directly above "you'll see how you did when you hand in".
   */
  const marked = answered && !retrying && !quiet;

  // Grading swaps out the controls the student was just using, so send focus
  // to the outcome instead of letting it fall to the document body.
  useEffect(() => {
    if (answered && gradedHere.current) {
      verdictRef.current?.focus();
      gradedHere.current = false;
    }
  }, [answered]);

  async function submit(action: "answer" | "reveal" | "retry", answer?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await onCheck(action, answer);
      gradedHere.current = true;
      setResult(res);
      setRetrying(false);
      // Only the first attempt moves the score, so a retry must not report an
      // outcome — the nav dot and the set tally are derived from attempt one.
      if (action !== "retry") onDone(action === "reveal" ? null : (res.correct ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  /** Take the offered second attempt: unlock the inputs and open the hint. */
  function beginRetry() {
    setRetrying(true);
    setShowHint(true);
    setError(null);
  }

  return (
    <article className="panel-raised above-grain p-6 sm:p-9">
      {/* Meta strip */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="mono-meta text-fg">
          <span className="text-[15px] tracking-normal">{String(index).padStart(2, "0")}</span>
          <span className="text-faint"> / {String(total).padStart(2, "0")}</span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {problem.topic_title && <span className="badge">{problem.topic_title}</span>}
          <span className="badge">{STYLE_LABELS[problem.style] ?? problem.style}</span>
          <span className="badge">Level {problem.difficulty}</span>
        </span>
      </div>

      <Prose
        id={statementId}
        html={problem.statement_html}
        className="mt-7 text-prose text-fg [&_.katex]:text-[1.02em]"
      />

      <AnswerInput
        problem={problem}
        statementId={statementId}
        submitted={initialResult?.submitted}
        marked={marked}
        answerKey={marked ? result?.answer : undefined}
        answered={answered}
        inert={inert}
        busy={busy}
        quiet={quiet}
        retrying={retrying}
        showHint={showHint}
        onShowHint={() => setShowHint(true)}
        onSubmit={submit}
      />

      {quiet && answered && (
        <p role="status" className="mono-meta mt-8 flex items-center gap-2">
          <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
          Answer recorded — you&apos;ll see how you did when you hand in
        </p>
      )}

      {locked && !answered && (
        <p role="status" className="mono-meta mt-8 flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          You already finished this one — fetching what you answered
        </p>
      )}

      {error && (
        <p role="alert" className="aside-rule mt-5 border-bad py-1 text-sm text-bad">
          {error}
        </p>
      )}

      {answered && result && !retrying && !quiet && (
        <Verdict
          ref={verdictRef}
          problem={problem}
          result={result}
          retryOffered={retryOffered}
          busy={busy}
          onRetry={beginRetry}
        />
      )}
    </article>
  );
}
