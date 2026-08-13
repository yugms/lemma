"use client";

import { useRef, useState } from "react";
import clsx from "clsx";
import { Check, CornerDownLeft, Eye, Lightbulb, Loader2, X } from "lucide-react";
import { Math, Prose } from "@/components/latex";
import { MultiSelectInput } from "@/components/problem-inputs/multi-select";
import { OrderingInput } from "@/components/problem-inputs/ordering";
import { MatchingInput } from "@/components/problem-inputs/matching";
import { MultiPartInput } from "@/components/problem-inputs/multi-part";
import { MATH_INPUT_PROPS } from "@/components/problem-inputs/math-input-props";
import { MathKeys } from "@/components/problem-inputs/math-keys";
import { GraphPointsInput, type Point } from "@/components/problem-inputs/graph-points";
import {
  curveFromHandles,
  GraphSketchInput,
  type Handle,
} from "@/components/problem-inputs/graph-sketch";
import {
  curveToPayload,
  seedFrom,
  sketchKind,
} from "@/components/problem-inputs/answer-shape";
import { assertNeverFormat } from "@/lib/ai/kinds";
import type { CheckResponse, PreparedProblem } from "@/lib/ai/schemas";

/**
 * Everything the student answers with: the per-format input, the hint, and the
 * buttons that hand the answer over.
 *
 * This is the half of the card that a ninth format changes, and it owns the
 * answer state rather than receiving it — nine `useState` pairs threaded down
 * from the shell would make every format's state the shell's business. What
 * crosses the boundary instead is one payload, at submit time.
 */
export function AnswerInput({
  problem,
  statementId,
  submitted,
  marked,
  answerKey,
  answered,
  inert,
  busy,
  quiet,
  retrying,
  showHint,
  onShowHint,
  onSubmit,
}: {
  problem: PreparedProblem;
  /** Labels the radio group; the statement *is* the question. */
  statementId: string;
  /** A stored submission being reviewed, which the inputs start from. */
  submitted: unknown;
  /**
   * The inputs may show a verdict on themselves. Separate from `answerKey`
   * because the key is withheld while a second attempt is still on offer:
   * the options go quiet then, but nothing is marked right or wrong.
   */
  marked: boolean;
  /** The answer key, when there is one to mark against. */
  answerKey: CheckResponse["answer"] | undefined;
  answered: boolean;
  inert: boolean;
  busy: boolean;
  quiet: boolean;
  retrying: boolean;
  showHint: boolean;
  onShowHint: () => void;
  onSubmit: (action: "answer" | "reveal" | "retry", answer?: unknown) => void;
}) {
  const seed = seedFrom(problem, submitted);
  const [choice, setChoice] = useState<string | null>(seed.choice);
  const [openAnswer, setOpenAnswer] = useState(seed.open);
  const [blankAnswers, setBlankAnswers] = useState<Record<string, string>>(seed.blanks);
  const [selected, setSelected] = useState<string[]>(seed.selected);
  const [order, setOrder] = useState<string[]>(seed.order);
  const [pairs, setPairs] = useState<Record<string, string>>(seed.pairs);
  const [partAnswers, setPartAnswers] = useState<Record<string, string>>(seed.parts);
  const [points, setPoints] = useState<Point[]>(seed.points);
  const [handles, setHandles] = useState<Handle[]>(seed.handles);

  /** The single open-answer field, for the symbol row to type into. `open`
   *  and `graph:value` never render together, so one ref serves both. */
  const openInputRef = useRef<HTMLInputElement>(null);

  const choices = problem.choices ?? [];

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
      case "matching":
        // Every prompt needs a pairing — a partly-filled grid submitted early
        // is a guaranteed miss, since matching is graded all-or-nothing.
        return (
          (problem.left ?? []).length > 0 &&
          (problem.left ?? []).every((l) => (pairs[l.id] ?? "").length > 0)
        );
      case "multi_part":
        return (
          (problem.parts ?? []).length > 0 &&
          (problem.parts ?? []).every((p) => (partAnswers[p.label] ?? "").trim().length > 0)
        );
      case "graph":
        if (problem.response_kind === "value") return openAnswer.trim().length > 0;
        if (problem.response_kind === "points") return points.length > 0;
        // A vertical line or a zero-width parabola has no equation to submit,
        // so the fit failing is exactly the case to keep the button inert.
        return curveFromHandles(sketchKind(problem), handles) !== null;
      default:
        return assertNeverFormat(problem.format);
    }
  })();

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
      case "matching":
        return pairs;
      case "multi_part":
        return partAnswers;
      case "graph":
        if (problem.response_kind === "value") return openAnswer;
        if (problem.response_kind === "points") return points;
        // Send the curve, not the handles: the answer is which graph they
        // produced, and the grader compares curves.
        return curveToPayload(curveFromHandles(sketchKind(problem), handles));
      default:
        return assertNeverFormat(problem.format);
    }
  }

  /**
   * Implicit form submission replaces the old per-input Enter handler: the
   * browser already does this, and doing it ourselves meant the return key
   * still announced itself as a newline. Every other control inside the form
   * declares `type="button"`, so nothing else can fire this.
   */
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittable && !inert && !busy) {
      onSubmit(retrying ? "retry" : "answer", payloadFor());
    }
  }

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

  return (
    <form onSubmit={handleSubmit}>
      {problem.format === "mcq" && (
        <div
          role="radiogroup"
          aria-labelledby={statementId}
          className="mt-8 grid gap-2"
        >
          {choices.map((c, i) => {
            const isPicked = choice === c.id;
            const isCorrectChoice = answerKey?.correct_choice_id === c.id;
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
                  "option-row",
                  isCorrectChoice && "border-ok bg-ok-wash",
                  isWrongPick && "border-bad bg-bad-wash",
                  !marked && isPicked && "border-accent bg-accent-wash",
                  !marked && !isPicked && "border-line hover:border-accent-line hover:bg-surface",
                  // Not 45: dimmed that far, an unchosen option is below
                  // readable contrast on a phone screen in daylight, and these
                  // are the options the choice notes below go on to explain.
                  marked && !isCorrectChoice && !isWrongPick && "border-line opacity-60"
                )}
              >
                <span
                  className={clsx(
                    "option-key",
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
              {...MATH_INPUT_PROPS}
              ref={openInputRef}
              value={openAnswer}
              disabled={inert || busy}
              onChange={(e) => setOpenAnswer(e.target.value)}
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
          <MathKeys
            value={openAnswer}
            onChange={setOpenAnswer}
            getInput={() => openInputRef.current}
            disabled={inert || busy}
          />
          <p className="mt-2.5 text-xs text-faint">
            Type math plainly — fractions as 3/4, roots as sqrt(2), powers as x^2.
          </p>
        </div>
      )}

      {problem.format === "fill_blank" && (
        // A grid rather than a wrapping row of fixed 144px fields: at 350px
        // three blanks laid out 2 + 1 ragged, and the `text-sm` that made them
        // fit is exactly what triggers the iOS focus zoom.
        <div className="mt-8 grid grid-cols-2 gap-4 sm:flex sm:flex-wrap">
          {Array.from({ length: problem.blanks_count ?? 1 }, (_, i) => i + 1).map((n) => (
            <label key={n} className="flex min-w-0 items-center gap-2.5">
              <span className="mono-meta">{n}</span>
              <input
                {...MATH_INPUT_PROPS}
                value={blankAnswers[String(n)] ?? ""}
                disabled={inert || busy}
                onChange={(e) =>
                  setBlankAnswers((prev) => ({ ...prev, [String(n)]: e.target.value }))
                }
                aria-label={`Blank ${n}`}
                className="field w-full py-2 font-mono sm:w-36 sm:text-sm"
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
          graded={answerKey?.correct_choice_ids}
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
          graded={answerKey?.correct_order}
          onReorder={setOrder}
        />
      )}

      {problem.format === "matching" && (
        <MatchingInput
          left={problem.left ?? []}
          right={problem.right ?? []}
          value={pairs}
          disabled={inert || busy}
          graded={answerKey?.correct_pairs}
          onChange={(leftId, rightId) =>
            setPairs((prev) => ({ ...prev, [leftId]: rightId }))
          }
        />
      )}

      {problem.format === "graph" && problem.plot_window && (
        <>
          {problem.response_kind === "points" && (
            <GraphPointsInput
              svg={problem.plot_svg ?? ""}
              window={problem.plot_window}
              selected={points}
              disabled={inert || busy}
              graded={answerKey?.correct_points}
              onToggle={(p) =>
                setPoints((prev) =>
                  prev.some((q) => q.x === p.x && q.y === p.y)
                    ? prev.filter((q) => !(q.x === p.x && q.y === p.y))
                    : [...prev, p]
                )
              }
            />
          )}

          {problem.response_kind === "sketch" && (
            <GraphSketchInput
              svg={problem.plot_svg ?? ""}
              window={problem.plot_window}
              kind={sketchKind(problem)}
              handles={handles}
              disabled={inert || busy}
              solutionSvg={answerKey?.solution_plot_svg}
              onMove={(i, next) =>
                setHandles((prev) => prev.map((h, j) => (j === i ? next : h)))
              }
            />
          )}

          {problem.response_kind === "value" && (
            <div className="mt-8">
              {/* The plot is the question here, so it is shown but not touched. */}
              <div
                className="plot-frame"
                dangerouslySetInnerHTML={{ __html: problem.plot_svg ?? "" }}
              />
              <div className="relative mt-4">
                <input
                  {...MATH_INPUT_PROPS}
                  ref={openInputRef}
                  value={openAnswer}
                  disabled={inert || busy}
                  onChange={(e) => setOpenAnswer(e.target.value)}
                  placeholder="y = 2x + 1"
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
              <MathKeys
                value={openAnswer}
                onChange={setOpenAnswer}
                getInput={() => openInputRef.current}
                disabled={inert || busy}
              />
            </div>
          )}
        </>
      )}

      {problem.format === "multi_part" && (
        <MultiPartInput
          parts={problem.parts ?? []}
          values={partAnswers}
          disabled={inert || busy}
          answers={answerKey?.part_answers}
          onChange={(label, value) =>
            setPartAnswers((prev) => ({ ...prev, [label]: value }))
          }
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
              onClick={onShowHint}
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
        // Sticky on a touch screen, where the statement, the input and the
        // hint together are taller than the visual viewport once the keyboard
        // is up, and this was the thing pushed off the bottom. It sticks only
        // while the card is on screen, so it never stacks with the engine's
        // own Previous/Next row — and the routes that render this card are the
        // ones where MobileTabBar stands down, so there is only ever one bar.
        <div className="mt-8 flex flex-wrap items-center gap-3 pointer-coarse:sticky pointer-coarse:bottom-0 pointer-coarse:z-10 pointer-coarse:-mx-6 pointer-coarse:border-t pointer-coarse:border-line pointer-coarse:bg-surface pointer-coarse:px-6 pointer-coarse:py-3.5 sm:pointer-coarse:mx-0 sm:pointer-coarse:px-0">
          <button
            type="submit"
            disabled={!submittable || busy}
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
              onClick={() => onSubmit("reveal")}
              className="btn btn-ghost"
            >
              <Eye className="h-3.5 w-3.5" aria-hidden />
              Show solution
            </button>
          )}
        </div>
      )}
    </form>
  );
}
