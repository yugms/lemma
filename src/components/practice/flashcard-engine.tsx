"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, RotateCcw, Shuffle, X } from "lucide-react";
import { ProblemCard } from "@/components/problem-card";
import type { CheckResponse, PreparedProblem } from "@/lib/ai/schemas";

const MAX_TIME_MS = 3_600_000;

/**
 * Rapid recall over a set's problems.
 *
 * Answers are graded by the server exactly as anywhere else — there is no
 * self-rating, because a score the client can assert is a score the client can
 * invent. What makes this a drill rather than a third attempt at the set is
 * that `mode: "flashcard"` is stored unscoped: reps feed topic accuracy and
 * activity, and never touch the set's own record. That is also what lets you
 * go round again, which the one-attempt-per-set index would otherwise forbid.
 */
export function FlashcardEngine({
  set,
  problems,
}: {
  set: { id: string; title: string };
  problems: PreparedProblem[];
}) {
  const [order, setOrder] = useState<PreparedProblem[]>(problems);
  const [current, setCurrent] = useState(0);
  const [result, setResult] = useState<CheckResponse | null>(null);
  const [tally, setTally] = useState({ right: 0, wrong: 0 });
  const [round, setRound] = useState(1);

  const startedAt = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const navigated = useRef(false);

  const card = order[current];
  const last = current === order.length - 1;

  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  useEffect(() => {
    if (navigated.current) {
      headingRef.current?.focus();
      navigated.current = false;
    }
  }, [current, round]);

  const next = useCallback(() => {
    navigated.current = true;
    setResult(null);
    startedAt.current = Date.now();
    setCurrent((i) => i + 1);
  }, []);

  /**
   * Reshuffle for the next pass. The seed is drawn in this handler rather than
   * during render — `react-hooks/purity` rejects `Math.random()` there, and a
   * deck that reshuffled on every re-render would be unusable anyway.
   */
  const again = useCallback(() => {
    navigated.current = true;
    const shuffled = [...problems];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setOrder(shuffled);
    setCurrent(0);
    setResult(null);
    setTally({ right: 0, wrong: 0 });
    setRound((r) => r + 1);
    startedAt.current = Date.now();
  }, [problems]);

  if (!card) {
    const total = tally.right + tally.wrong;
    return (
      <div className="mx-auto max-w-2xl">
        <p className="eyebrow eyebrow-accent">Deck finished</p>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="display mt-6 text-[clamp(3rem,9vw,4.5rem)] leading-none tabular-nums outline-none"
        >
          {tally.right}
          <span className="text-faint">/{total}</span>
        </h1>
        <p className="mt-4 text-prose text-muted">
          Round {round} — recalled {tally.right} of {total} without help.
        </p>
        <p className="mono-meta mt-3">
          Flashcard reps count toward your topic accuracy, never toward this set&apos;s score.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <button type="button" onClick={again} className="btn btn-accent">
            <Shuffle className="h-3.5 w-3.5" aria-hidden />
            Shuffle and go again
          </button>
          <Link
            href={`/set/${set.id}`}
            transitionTypes={["nav-back"]}
            className="btn btn-outline"
          >
            Back to the set
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between gap-6 border-b border-line pb-4">
        <Link
          href={`/set/${set.id}`}
          transitionTypes={["nav-back"]}
          className="mono-meta inline-flex min-w-0 items-center gap-1.5 truncate transition-colors hover:text-accent"
        >
          <ArrowLeft className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{set.title}</span>
        </Link>
        <span className="mono-meta flex shrink-0 items-center gap-3 tabular-nums">
          <span>
            {current + 1} / {order.length}
          </span>
          <span className="flex items-center gap-1 text-ok">
            <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
            {tally.right}
          </span>
          <span className="flex items-center gap-1 text-bad">
            <X className="h-3 w-3" strokeWidth={3} aria-hidden />
            {tally.wrong}
          </span>
        </span>
      </div>

      <h1 ref={headingRef} tabIndex={-1} className="sr-only outline-none">
        Card {current + 1} of {order.length} — {set.title}
      </h1>

      <div className="mt-6">
        <ProblemCard
          // Remount per card, and again on a reshuffle, so nothing carries over.
          key={`${card.id}-${round}`}
          problem={card}
          index={current + 1}
          total={order.length}
          onCheck={async (action, answer) => {
            const res = await fetch("/api/check", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                problemId: card.id,
                // Sent for the ownership check; the route stores null so the
                // rep stays out of this set's record.
                setId: set.id,
                mode: "flashcard",
                action,
                answer,
                timeMs: Math.min(Date.now() - startedAt.current, MAX_TIME_MS),
              }),
            });
            if (!res.ok) {
              throw new Error(
                (await res.json().catch(() => null))?.error ?? "Check failed"
              );
            }
            const data = (await res.json()) as CheckResponse;
            setResult(data);
            return data;
          }}
          onDone={(correct) =>
            setTally((t) => ({
              right: t.right + (correct === true ? 1 : 0),
              // A revealed card counts as not recalled, which is what it is.
              wrong: t.wrong + (correct === true ? 0 : 1),
            }))
          }
        />
      </div>

      {result && (
        <div className="mt-6 flex justify-end">
          <button type="button" onClick={next} className="btn btn-accent">
            {last ? "Finish deck" : "Next card"}
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
