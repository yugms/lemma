"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowLeft, ArrowRight, Flag } from "lucide-react";
import { ProblemCard } from "@/components/problem-card";
import { EmptySet } from "@/components/practice/empty-set";
import { ProblemRail } from "@/components/practice/problem-rail";
import { SetSummary, type Outcomes } from "@/components/practice/set-summary";
import { MAX_TIME_MS } from "@/lib/attempt-state";
import { postJson } from "@/lib/post-json";
import type { CheckResponse, PreparedProblem } from "@/lib/ai/schemas";
import type { Outcome } from "@/lib/progress";

/**
 * Outcome colours own this component. "Current" is deliberately ink rather
 * than the brand oxblood — in dark mode the accent and the incorrect tone are
 * both warm pinks, and at 3px they are not tellable apart. Position is
 * carried by height and `aria-current` instead.
 */
const TONE = {
  correct: { className: "bg-ok", label: "correct" },
  wrong: { className: "bg-bad", label: "incorrect" },
  revealed: { className: "bg-line-strong", label: "revealed" },
  current: { className: "bg-fg", label: "current" },
  untouched: { className: "bg-line", label: "not attempted" },
} as const;

function toneFor(outcome: Outcome | undefined, isCurrent: boolean) {
  if (outcome === true) return TONE.correct;
  if (outcome === false) return TONE.wrong;
  if (outcome === null) return TONE.revealed;
  return isCurrent ? TONE.current : TONE.untouched;
}

export function PracticeEngine({
  set,
  problems,
  initialOutcomes,
  hasAccount = false,
}: {
  set: { id: string; title: string };
  problems: PreparedProblem[];
  initialOutcomes: Outcomes;
  /** Review and stats are account-gated; don't offer a guest a wall. */
  hasAccount?: boolean;
}) {
  const [outcomes, setOutcomes] = useState<Outcomes>(initialOutcomes);
  // Graded payloads, keyed by problem id — written when a problem is graded
  // here, or re-fetched via "recall" when the student walks back to one they
  // finished in an earlier session.
  const [results, setResults] = useState<Record<string, CheckResponse>>({});
  // How the recall went, per problem. Kept apart from `results` because the
  // card's key hangs off it: keying on `results` would remount the card the
  // instant grading wrote to it, wiping the answer the student just gave.
  const [recallState, setRecallState] = useState<Record<string, "done" | "failed">>({});
  const inFlight = useRef<Set<string>>(new Set());

  const firstUnanswered = useMemo(() => {
    const i = problems.findIndex((p) => initialOutcomes[p.id] === undefined);
    return i === -1 ? 0 : i;
  }, [problems, initialOutcomes]);

  const allDone = problems.every((p) => initialOutcomes[p.id] !== undefined);
  const [current, setCurrent] = useState(firstUnanswered);
  const [showSummary, setShowSummary] = useState(allDone);

  // Set on mount and on every move; `timeMs` is only reported once a problem
  // is actually submitted, by which point this always holds a real timestamp.
  const startedAt = useRef(0);
  const sittingStart = useRef(0);
  // Stamped when the student finishes, not read during render — the clock is
  // off limits there. Null when they arrived straight at an already-done set,
  // where "how long this took" would be a number about some earlier day.
  const [sittingMs, setSittingMs] = useState<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const navigated = useRef(false);

  const problem = problems[current];
  const outcome = outcomes[problem?.id ?? ""];
  const isAttempted = outcome !== undefined;
  const cached = results[problem?.id ?? ""];
  // An outcome is on record but the payload hasn't arrived: the card must not
  // offer a second submission it would only lose. A failed recall unlocks it —
  // the route replays the recorded outcome rather than writing a new one.
  const awaitingHistory =
    isAttempted && !cached && recallState[problem?.id ?? ""] !== "failed";

  const tally = useMemo(() => {
    let correct = 0;
    let wrong = 0;
    let revealed = 0;
    for (const p of problems) {
      const o = outcomes[p.id];
      if (o === true) correct++;
      else if (o === false) wrong++;
      else if (o === null) revealed++;
    }
    return { correct, wrong, revealed, answered: correct + wrong };
  }, [problems, outcomes]);

  /**
   * Pull back a previously earned outcome so review shows real history.
   * In-flight ids live in a ref rather than state — this only guards against
   * duplicate requests, and nothing renders from it.
   */
  const recall = useCallback(
    async (problemId: string) => {
      if (inFlight.current.has(problemId)) return;
      inFlight.current.add(problemId);
      try {
        const data = await postJson<CheckResponse>(
          "/api/check",
          { problemId, setId: set.id, mode: "practice", action: "recall" },
          "Recall failed"
        );
        setResults((prev) => ({ ...prev, [problemId]: data }));
        setRecallState((prev) => ({ ...prev, [problemId]: "done" }));
      } catch {
        // A failed recall just means the card opens without the earlier
        // answer — the outcome is still recorded, so nothing is lost.
        setRecallState((prev) => ({ ...prev, [problemId]: "failed" }));
      } finally {
        inFlight.current.delete(problemId);
      }
    },
    [set.id]
  );

  // Moving between problems replaces the whole card, so put focus on the new
  // heading rather than dropping it to the body.
  useEffect(() => {
    if (navigated.current) {
      headingRef.current?.focus();
      navigated.current = false;
    }
  }, [current, showSummary]);

  useEffect(() => {
    startedAt.current = Date.now();
    sittingStart.current = Date.now();
  }, []);

  /**
   * Every move goes through here, which is also where a finished problem's
   * history is fetched. Resuming always lands on an unattempted problem, so
   * there is no mount-time case to handle. Problems graded during this visit
   * already carry their submission in `results`, so only an earlier session's
   * work costs a round-trip — and a recall that failed isn't retried on every
   * pass through the set.
   */
  const go = useCallback(
    (index: number) => {
      navigated.current = true;
      setCurrent(index);
      setShowSummary(false);
      startedAt.current = Date.now();
      const target = problems[index];
      if (
        target &&
        outcomes[target.id] !== undefined &&
        !results[target.id] &&
        recallState[target.id] === undefined
      ) {
        recall(target.id);
      }
    },
    [problems, outcomes, results, recallState, recall]
  );

  // Arrow keys page through the set, except while the reader is inside a
  // control that owns them (text fields, the choice radiogroup).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      // `slider` is the graph sketch handles, which move on the arrow keys.
      // The handle stops propagation itself, so this is redundant today; it is
      // stated anyway because this list is where "which controls own the
      // arrows" is written down, and a control that forgets to stop the event
      // should degrade to doing nothing rather than to turning the page.
      const role = el?.getAttribute("role");
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          role === "radio" ||
          role === "slider" ||
          el.isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowLeft" && current > 0) go(current - 1);
      if (e.key === "ArrowRight" && current < problems.length - 1) go(current + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, problems.length, go]);

  // Only reachable for a set with no problems, which a build that delivered
  // nothing can produce. Rendering null left a page with an empty `<main>` and
  // no heading at all — a blank screen with no explanation and no way out.
  if (!problem) return <EmptySet setId={set.id} />;

  if (showSummary) {
    return (
      <SetSummary
        ref={headingRef}
        set={set}
        problems={problems}
        outcomes={outcomes}
        results={results}
        tally={tally}
        sittingMs={sittingMs}
        hasAccount={hasAccount}
        onGo={go}
      />
    );
  }

  /* ── Active problem ──────────────────────────────────────────── */

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

        <ProblemRail
          noun="Problem"
          stops={problems.map((p, i) => {
            const tone = toneFor(outcomes[p.id], i === current);
            return { key: p.id, tone: tone.className, state: tone.label };
          })}
          current={current}
          onGo={go}
        />
      </div>

      <h1 ref={headingRef} tabIndex={-1} className="sr-only outline-none">
        Problem {current + 1} of {problems.length} — {set.title}
      </h1>

      <div className="mt-6">
        <ProblemCard
          // Remounting is how the card resets between problems; the suffix
          // makes a recalled result remount it once the history arrives. It
          // must not track grading — that would remount the card the student
          // is looking at and throw away the answer they just submitted.
          key={`${problem.id}${recallState[problem.id] === "done" ? "-recalled" : ""}`}
          problem={problem}
          index={current + 1}
          total={problems.length}
          initialResult={cached ?? null}
          locked={awaitingHistory}
          onCheck={async (action, answer) => {
            const data = await postJson<CheckResponse>(
              "/api/check",
              {
                problemId: problem.id,
                setId: set.id,
                mode: "practice",
                action,
                answer,
                timeMs: Math.min(Date.now() - startedAt.current, MAX_TIME_MS),
              },
              "Check failed"
            );
            // Hold on to what they submitted, so coming back to this problem
            // replays their own answer without another round-trip.
            setResults((prev) => ({
              ...prev,
              [problem.id]: action === "answer" ? { ...data, submitted: answer } : data,
            }));
            return data;
          }}
          onDone={(correct) =>
            setOutcomes((prev) => ({ ...prev, [problem.id]: correct }))
          }
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
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
          {/* Was `hidden sm:inline` back when the dot rail always showed every
              problem at once. It scrolls now, so this is the only place the
              count is stated in full on a phone. */}
          <span className="mono-meta">
            {tally.correct + tally.wrong + tally.revealed} / {problems.length} done
          </span>
          {current + 1 < problems.length ? (
            <button
              type="button"
              onClick={() => go(current + 1)}
              className={clsx("btn", isAttempted ? "btn-accent" : "btn-outline")}
            >
              Next
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                navigated.current = true;
                setSittingMs(Date.now() - sittingStart.current);
                setShowSummary(true);
              }}
              className="btn btn-accent"
            >
              <Flag className="h-3.5 w-3.5" aria-hidden />
              Finish
            </button>
          )}
        </div>
      </div>

      <p className="mono-meta mt-6 hidden text-center sm:block">
        ← → to move between problems
      </p>
    </div>
  );
}
