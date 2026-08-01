"use client";

import { useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";
import { Check, CornerDownLeft, Eye, Lightbulb, Loader2, RotateCcw, X } from "lucide-react";
import { Math, Prose } from "@/components/latex";
import { MultiSelectInput } from "@/components/problem-inputs/multi-select";
import { CorrectOrder, OrderingInput } from "@/components/problem-inputs/ordering";
import { assertNeverFormat, type CheckResponse, type PreparedProblem } from "@/lib/ai/schemas";
import { STYLE_LABELS } from "@/lib/format";

export type { CheckResponse };

type Seed = {
  choice: string | null;
  open: string;
  blanks: Record<string, string>;
  selected: string[];
  order: string[];
};

const asStringList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** Rebuild the input state from a stored submission, for review mode. */
function seedFrom(problem: PreparedProblem, submitted: unknown): Seed {
  const empty: Seed = {
    choice: null,
    open: "",
    blanks: {},
    selected: [],
    // Ordering always starts from the scrambled order the problem was stored in,
    // so the server-rendered list and the hydrated one agree.
    order: (problem.items ?? []).map((i) => i.id),
  };
  switch (problem.format) {
    case "mcq":
      return { ...empty, choice: typeof submitted === "string" ? submitted : null };
    case "open":
      return { ...empty, open: typeof submitted === "string" ? submitted : "" };
    case "fill_blank":
      return {
        ...empty,
        blanks:
          submitted && typeof submitted === "object"
            ? (submitted as Record<string, string>)
            : {},
      };
    case "multi_select":
      return { ...empty, selected: asStringList(submitted) };
    case "ordering": {
      const stored = asStringList(submitted);
      // Only trust a stored order that is still a permutation of this problem's
      // steps — a pooled problem could have been re-authored underneath it.
      const valid =
        stored.length === empty.order.length &&
        [...stored].sort().join() === [...empty.order].sort().join();
      return { ...empty, order: valid ? stored : empty.order };
    }
    default:
      return assertNeverFormat(problem.format);
  }
}

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
  const seed = seedFrom(problem, initialResult?.submitted);
  const [choice, setChoice] = useState<string | null>(seed.choice);
  const [openAnswer, setOpenAnswer] = useState(seed.open);
  const [blankAnswers, setBlankAnswers] = useState<Record<string, string>>(seed.blanks);
  const [selected, setSelected] = useState<string[]>(seed.selected);
  const [order, setOrder] = useState<string[]>(seed.order);
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

  const submittable = (() => {
    switch (problem.format) {
      case "mcq":
        return choice !== null;
      case "open":
        return openAnswer.trim().length > 0;
      case "fill_blank":
        return (
          Object.keys(blankAnswers).length >= (problem.blanks_count ?? 1) &&
          Object.values(blankAnswers).every((v) => v.trim().length > 0)
        );
      case "multi_select":
        return selected.length > 0;
      case "ordering":
        return order.length > 0;
      default:
        return assertNeverFormat(problem.format);
    }
  })();

  // Grading swaps out the controls the student was just using, so send focus
  // to the outcome instead of letting it fall to the document body.
  useEffect(() => {
    if (answered && gradedHere.current) {
      verdictRef.current?.focus();
      gradedHere.current = false;
    }
  }, [answered]);

  function payloadFor(): unknown {
    switch (problem.format) {
      case "mcq":
        return choice;
      case "open":
        return openAnswer;
      case "fill_blank":
        return blankAnswers;
      case "multi_select":
        return selected;
      case "ordering":
        return order;
      default:
        return assertNeverFormat(problem.format);
    }
  }

  async function submit(action: "answer" | "reveal" | "retry") {
    setBusy(true);
    setError(null);
    try {
      const res = await onCheck(action, action === "reveal" ? undefined : payloadFor());
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

  function trySubmitFromKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && submittable && !inert && !busy) {
      e.preventDefault();
      submit(retrying ? "retry" : "answer");
    }
  }

  const choices = problem.choices ?? [];

  /** Arrow keys move selection within the group, as a radio group should. */
  function onChoiceKeyDown(e: React.KeyboardEvent, i: number) {
    const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const delta = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
    const next = (i + delta + choices.length) % choices.length;
    setChoice(choices[next].id);
    const group = e.currentTarget.parentElement;
    (group?.children[next] as HTMLElement | undefined)?.focus();
  }

  const verdictTone = result?.revealed ? "revealed" : result?.correct ? "ok" : "bad";
  /**
   * Show correctness marks only when the attempt is settled. While a retry is
   * live the inputs are the student's again, and while one is merely offered
   * the answer key hasn't been sent — `result.answer` is deliberately absent.
   */
  const marked = answered && !retrying;
  const key = marked ? result?.answer : undefined;
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
  const choiceNotes = (result?.choice_notes ?? []).filter((n) => wrongIds.has(n.choice_id));

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

      {/* ── Answer input ──────────────────────────────────────────── */}

      {problem.format === "mcq" && (
        <div
          role="radiogroup"
          aria-labelledby={statementId}
          className="mt-8 grid gap-2"
        >
          {choices.map((c, i) => {
            const isPicked = choice === c.id;
            const isCorrectChoice = key?.correct_choice_id === c.id;
            const isWrongPick = marked && isPicked && !isCorrectChoice;
            // Only the active option is tabbable; arrows move within the group.
            const tabbable = choice ? isPicked : i === 0;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={isPicked}
                tabIndex={inert ? -1 : tabbable ? 0 : -1}
                disabled={inert || busy}
                onClick={() => setChoice(c.id)}
                onKeyDown={(e) => !inert && onChoiceKeyDown(e, i)}
                className={clsx(
                  "group flex w-full items-center gap-4 rounded-[3px] border px-4 py-3.5 text-left transition-all duration-200",
                  isCorrectChoice && "border-ok bg-ok-wash",
                  isWrongPick && "border-bad bg-bad-wash",
                  !marked && isPicked && "border-accent bg-accent-wash",
                  !marked && !isPicked && "border-line hover:border-accent-line hover:bg-surface",
                  marked && !isCorrectChoice && !isWrongPick && "border-line opacity-45"
                )}
              >
                <span
                  className={clsx(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-[2px] border font-mono text-[11px] transition-colors",
                    isCorrectChoice && "border-ok bg-ok text-paper",
                    isWrongPick && "border-bad bg-bad text-paper",
                    !marked && isPicked && "border-accent bg-accent-solid text-accent-on",
                    !isPicked && !isCorrectChoice && "border-line-strong text-muted"
                  )}
                >
                  {c.id}
                </span>
                <Math html={c.html} className="min-w-0 flex-1" />
                {/* Correctness is never carried by colour alone. */}
                {isCorrectChoice && (
                  <Check className="h-4 w-4 shrink-0 text-ok" strokeWidth={2.5} aria-label="Correct answer" />
                )}
                {isWrongPick && (
                  <X className="h-4 w-4 shrink-0 text-bad" strokeWidth={2.5} aria-label="Your answer" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {problem.format === "open" && (
        <div className="mt-8">
          <div className="relative">
            <input
              value={openAnswer}
              disabled={inert || busy}
              onChange={(e) => setOpenAnswer(e.target.value)}
              onKeyDown={trySubmitFromKey}
              placeholder="x = 3"
              aria-label="Your answer"
              className="field pr-11 font-mono"
            />
            {submittable && !answered && (
              <CornerDownLeft
                aria-hidden
                className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
              />
            )}
          </div>
          <p className="mt-2.5 text-xs text-faint">
            Type math plainly — fractions as 3/4, roots as sqrt(2), powers as x^2.
          </p>
        </div>
      )}

      {problem.format === "fill_blank" && (
        <div className="mt-8 flex flex-wrap gap-4">
          {Array.from({ length: problem.blanks_count ?? 1 }, (_, i) => i + 1).map((n) => (
            <label key={n} className="flex items-center gap-2.5">
              <span className="mono-meta">{n}</span>
              <input
                value={blankAnswers[String(n)] ?? ""}
                disabled={inert || busy}
                onChange={(e) =>
                  setBlankAnswers((prev) => ({ ...prev, [String(n)]: e.target.value }))
                }
                onKeyDown={trySubmitFromKey}
                aria-label={`Blank ${n}`}
                className="field w-36 py-2 font-mono text-sm"
              />
            </label>
          ))}
        </div>
      )}

      {problem.format === "multi_select" && (
        <MultiSelectInput
          options={choices}
          selected={selected}
          disabled={inert || busy}
          graded={key?.correct_choice_ids}
          onToggle={(id) =>
            setSelected((prev) =>
              prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
            )
          }
        />
      )}

      {problem.format === "ordering" && (
        <OrderingInput
          steps={problem.items ?? []}
          order={order}
          disabled={inert || busy}
          graded={key?.correct_order}
          onReorder={setOrder}
        />
      )}

      {/* ── Hint ──────────────────────────────────────────────────── */}

      {!inert && !quiet && problem.hint_html && (
        <div className="mt-7">
          {showHint ? (
            <div className="aside-rule aside-rule-accent enter-rise py-0.5">
              <p className="eyebrow eyebrow-accent flex items-center gap-1.5">
                <Lightbulb className="h-3 w-3" aria-hidden />
                Hint
              </p>
              <Prose
                html={problem.hint_html}
                as="span"
                className="mt-2 block text-sm leading-relaxed text-muted"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowHint(true)}
              className="eyebrow inline-flex items-center gap-1.5 transition-colors hover:text-accent"
            >
              <Lightbulb className="h-3 w-3" aria-hidden />
              Show hint
            </button>
          )}
        </div>
      )}

      {/* ── Actions ───────────────────────────────────────────────── */}

      {!inert && (
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!submittable || busy}
            onClick={() => submit(retrying ? "retry" : "answer")}
            className="btn btn-accent"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            {busy
              ? quiet
                ? "Saving…"
                : "Checking…"
              : quiet
                ? "Answer and continue"
                : retrying
                  ? "Check second attempt"
                  : "Check answer"}
          </button>
          {/* Giving up is a practice affordance; under quiz conditions there is
              nothing to give up to. */}
          {!quiet && (
            <button
              type="button"
              disabled={busy}
              onClick={() => submit("reveal")}
              className="btn btn-ghost"
            >
              <Eye className="h-3.5 w-3.5" aria-hidden />
              Show solution
            </button>
          )}
        </div>
      )}

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

      {/* ── Result ────────────────────────────────────────────────── */}

      {answered && result && !retrying && !quiet && (
        <div className="mt-9 space-y-7">
          <div
            ref={verdictRef}
            tabIndex={-1}
            role="status"
            aria-live="polite"
            className="scroll-mt-24 outline-none"
          >
            {!result.revealed && (
              <div
                className={clsx(
                  "stamp flex items-center gap-3 border-t pt-6",
                  verdictTone === "ok" ? "border-ok" : "border-bad"
                )}
              >
                <span
                  className={clsx(
                    "flex h-8 w-8 items-center justify-center rounded-full",
                    verdictTone === "ok" ? "bg-ok-wash text-ok" : "bg-bad-wash text-bad"
                  )}
                >
                  {verdictTone === "ok" ? (
                    <Check className="h-4.5 w-4.5" strokeWidth={2.5} aria-hidden />
                  ) : (
                    <X className="h-4.5 w-4.5" strokeWidth={2.5} aria-hidden />
                  )}
                </span>
                <p
                  className={clsx(
                    "display-md text-[1.75rem] leading-none",
                    verdictTone === "ok" ? "text-ok" : "text-bad"
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

          {!result.correct && result.answer && (
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="eyebrow">Answer</span>
              {result.answer.value_html !== undefined && (
                <Math html={result.answer.value_html} />
              )}
              {result.answer.blanks?.map((b) => (
                <span key={b.index} className="flex items-baseline gap-1.5">
                  <span className="mono-meta">{b.index}</span>
                  <Math html={b.html} />
                </span>
              ))}
              {result.answer.correct_choice_ids && (
                <span className="font-mono text-sm">
                  {result.answer.correct_choice_ids.join(", ")}
                </span>
              )}
            </div>
          )}

          {/* Ordering shows the sequence in full — a list of letters would make
              the student re-map them back onto the steps themselves. */}
          {!result.correct && result.answer?.correct_order && (
            <div>
              <span className="eyebrow">The right order</span>
              <CorrectOrder steps={problem.items ?? []} order={result.answer.correct_order} />
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
              <button
                type="button"
                onClick={beginRetry}
                disabled={busy}
                className="btn btn-outline"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Try again
              </button>
              <p className="mono-meta mt-3">
                One more attempt, with the hint. Your first answer is what counts for the
                set — this is for you.
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
                    <p className="text-sm leading-relaxed text-muted">{s.note}</p>
                  </div>
                </li>
              ))}
            </ol>
          </details>
          )}
        </div>
      )}
    </article>
  );
}
