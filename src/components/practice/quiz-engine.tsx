"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ArrowLeft, ArrowRight, Flag, Loader2, Timer } from "lucide-react";
import { ProblemCard } from "@/components/problem-card";
import { formatDuration } from "@/lib/format";
import type { PreparedProblem } from "@/lib/ai/schemas";

const MAX_TIME_MS = 3_600_000;

/**
 * A quiz over a set: the same problems, under exam conditions.
 *
 * Three things separate it from practice, and all three live server-side —
 * `MODE_RULES.quiz` withholds the verdict, the hint and the retry, so a
 * tampered client gets no more than an honest one. What this component adds is
 * the pacing: answers are fired and the student moves on rather than waiting
 * for grading, because a timed assessment that pauses 3 seconds per question
 * is measuring the model's latency as much as the student.
 */
export function QuizEngine({
  set,
  problems,
}: {
  set: { id: string; title: string };
  problems: PreparedProblem[];
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(0);
  const [answered, setAnswered] = useState<Record<string, boolean>>({});
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failures, setFailures] = useState(0);

  const startedAt = useRef(0);
  const questionStart = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const navigated = useRef(false);
  /** Submissions still in flight; awaited once at hand-in. */
  const pending = useRef<Promise<void>[]>([]);

  const problem = problems[current];
  const done = Object.keys(answered).length;

  useEffect(() => {
    startedAt.current = Date.now();
    questionStart.current = Date.now();
  }, []);

  // A visible clock, ticked from an interval rather than read during render.
  useEffect(() => {
    const tick = () => setElapsed(Date.now() - startedAt.current);
    const id = window.setInterval(tick, 1000);
    const first = window.setTimeout(tick, 0);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(first);
    };
  }, []);

  useEffect(() => {
    if (navigated.current) {
      headingRef.current?.focus();
      navigated.current = false;
    }
  }, [current]);

  const go = useCallback((index: number) => {
    navigated.current = true;
    setCurrent(index);
    questionStart.current = Date.now();
  }, []);

  /** Fire the answer and let the student move on; failures surface at hand-in. */
  const submit = useCallback(
    (problemId: string, answer: unknown) => {
      const timeMs = Math.min(Date.now() - questionStart.current, MAX_TIME_MS);
      setAnswered((prev) => ({ ...prev, [problemId]: true }));
      const task = fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          problemId,
          setId: set.id,
          mode: "quiz",
          action: "answer",
          answer,
          timeMs,
        }),
      })
        .then((res) => {
          if (!res.ok) setFailures((n) => n + 1);
        })
        .catch(() => setFailures((n) => n + 1));
      pending.current.push(task);
    },
    [set.id]
  );

  async function finish() {
    setSubmitting(true);
    // Everything in flight has to land before the results are read back.
    await Promise.allSettled(pending.current);
    // Practice mode is the results view: every problem now has an attempt, so
    // it replays each one with its verdict and worked solution.
    router.push(`/set/${set.id}/practice`);
  }

  const allAnswered = done === problems.length;

  if (!problem) return null;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between gap-6 border-b border-line pb-4">
        <span className="mono-meta inline-flex min-w-0 items-center gap-1.5 truncate">
          <Timer className="h-3 w-3 shrink-0" aria-hidden />
          <span className="tabular-nums">{elapsed === null ? "—" : formatDuration(elapsed)}</span>
          <span className="truncate text-faint">· {set.title}</span>
        </span>

        <nav aria-label="Questions" className="flex shrink-0 gap-1">
          {problems.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => go(i)}
              aria-current={i === current ? "step" : undefined}
              aria-label={`Question ${i + 1}, ${answered[p.id] ? "answered" : "unanswered"}`}
              className="group -my-2 px-px py-2"
            >
              <span
                className={clsx(
                  "block h-[3px] w-5 rounded-full transition-all duration-300 group-hover:h-[5px] sm:w-6",
                  answered[p.id] ? "bg-fg" : "bg-line",
                  i === current && "h-[5px]"
                )}
              />
            </button>
          ))}
        </nav>
      </div>

      <h1 ref={headingRef} tabIndex={-1} className="sr-only outline-none">
        Question {current + 1} of {problems.length} — {set.title}
      </h1>

      <div className="mt-6">
        <ProblemCard
          // Answering must not swap the card for a verdict: in a quiz there
          // isn't one yet. Re-keying per question is what resets the inputs.
          key={problem.id}
          problem={problem}
          index={current + 1}
          total={problems.length}
          quiet
          onCheck={async (action, answer) => {
            submit(problem.id, action === "answer" ? answer : undefined);
            // Advance rather than wait. The last question stays put so the
            // student can review before handing in.
            if (current + 1 < problems.length) go(current + 1);
            return { recorded: true };
          }}
          onDone={() => {}}
        />
      </div>

      <div className="mt-6 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => go(current - 1)}
          disabled={current === 0}
          className="btn btn-ghost"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Previous
        </button>

        <div className="flex items-center gap-3">
          <span className="mono-meta hidden sm:inline">
            {done} / {problems.length} answered
          </span>
          {current + 1 < problems.length ? (
            <button type="button" onClick={() => go(current + 1)} className="btn btn-outline">
              Skip
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            onClick={finish}
            disabled={submitting}
            className={clsx("btn", allAnswered ? "btn-accent" : "btn-outline")}
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Flag className="h-3.5 w-3.5" aria-hidden />
            )}
            {submitting ? "Marking…" : "Hand in"}
          </button>
        </div>
      </div>

      <p className="mono-meta mt-6 text-center">
        {allAnswered
          ? "Hand in to see how you did."
          : `${problems.length - done} unanswered — you can hand in anyway.`}
      </p>

      {failures > 0 && (
        <p role="alert" className="aside-rule mt-4 border-bad py-1 text-sm text-bad">
          {failures} answer{failures === 1 ? "" : "s"} didn&apos;t save. Check your connection
          before handing in.
        </p>
      )}
    </div>
  );
}
