"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowLeft, ArrowRight, Check, Eye, Flag, RotateCcw, X } from "lucide-react";
import { ProblemCard } from "@/components/problem-card";
import { Prose } from "@/components/latex";
import { EmptySet } from "@/components/practice/empty-set";
import { ProblemRail } from "@/components/practice/problem-rail";
import { formatDuration } from "@/lib/format";
import { postJson } from "@/lib/post-json";
import type { CheckResponse, PreparedProblem } from "@/lib/ai/schemas";
import type { Outcome } from "@/lib/progress";

type Outcomes = Record<string, Outcome>;

/** `/api/check` rejects anything larger, and a tab left open all afternoon
 *  would otherwise 400 the submission rather than grade it. */
const MAX_TIME_MS = 3_600_000;

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
   * What this sitting actually produced, for the summary. Everything here comes
   * from payloads already in hand — no extra request just to close the set.
   */
  const debrief = useMemo(() => {
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

    return {
      recovered,
      notes,
      missedTopics: [...missedTopics.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [problems, outcomes, results]);

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

  /* ── Summary ─────────────────────────────────────────────────── */

  if (showSummary) {
    const denominator = tally.answered;
    const pct = denominator > 0 ? Math.round((tally.correct / denominator) * 100) : 0;
    return (
      <div className="mx-auto max-w-2xl">
        <p className="eyebrow eyebrow-accent">Set complete</p>
        <h1
          ref={headingRef}
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

        {debrief.recovered > 0 && (
          <p className="mono-meta mt-3 flex items-center gap-2">
            <RotateCcw className="h-3 w-3 text-ok" aria-hidden />
            <span className="text-ok">
              {debrief.recovered} put right on a second attempt
            </span>
          </p>
        )}

        {debrief.missedTopics.length > 0 && (
          <section className="mt-10 border-t border-line pt-8">
            <p className="eyebrow">Where the misses were</p>
            <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
              {debrief.missedTopics.map(([topic, n]) => (
                <li key={topic} className="mono-meta">
                  {topic}
                  <span className="text-bad"> · {n}</span>
                </li>
              ))}
            </ul>

            {/* The diagnoses written while grading. They were only ever visible
                on the card you happened to be looking at; this is the first
                place they read as a pattern rather than as one-offs. */}
            {debrief.notes.length > 0 && (
              <ul className="mt-6 space-y-4">
                {debrief.notes.map((n, i) => (
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
                    onClick={() => go(i)}
                    className="group flex w-full items-center gap-4 rounded-[3px] border border-line px-4 py-3 text-left transition-colors hover:border-accent-line hover:bg-surface"
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
