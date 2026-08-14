/**
 * The free half of verification: everything a problem can be wrong about that
 * costs nothing to find. LaTeX that will not render, an MCQ whose choices are
 * not distinct, a blank nobody answered, an answer point already drawn on the
 * plot.
 *
 * Kept apart from `verify.ts` because the two halves fail differently and are
 * tested differently: this is pure and synchronous, so five test suites can
 * drive it over every format fixture, while the solver half needs a model and
 * a budget. It also imports the renderer rather than the provider, which is
 * the point — a segment is checked here exactly the way it will be displayed.
 */
import katex from "katex";
import {
  assertNeverFormat,
  assertNeverGraphResponse,
  GeneratedProblem,
} from "@/lib/ai/schemas";
import { curveFromAuthored, curvesMatch, plotFromSpec } from "@/lib/plot";
import { inlineShape } from "@/lib/math-render";
import { normalizeMath } from "@/lib/answers";

/** Zero-cost structural validation: LaTeX renders, MCQ integrity, blanks integrity. */
export function structuralCheck(p: GeneratedProblem): { ok: boolean; reason?: string } {
  const renderOk = (latex: string) => {
    try {
      katex.renderToString(latex, { throwOnError: true, strict: "ignore" });
      return true;
    } catch {
      return false;
    }
  };
  /** Prose with embedded \( \) / \[ \] — every segment must render. */
  const proseOk = (text: string): string | null => {
    for (const m of text.matchAll(/\\\((.+?)\\\)|\\\[([\s\S]+?)\\\]/g)) {
      const inner = m[1] ?? m[2];
      if (inner && !renderOk(inner)) return inner;
    }
    return null;
  };

  const badSegment = proseOk(p.statement_latex);
  if (badSegment) return { ok: false, reason: `statement latex fails: ${badSegment}` };
  for (const step of p.explanation_steps) {
    if (step.latex && !renderOk(step.latex))
      return { ok: false, reason: `explanation latex fails: ${step.latex}` };
  }
  if (p.explanation_steps.length === 0) return { ok: false, reason: "no explanation steps" };

  /**
   * Shared by every format presenting a labelled list.
   *
   * None of these fields has a single shape: an MCQ choice is usually a bare
   * expression but a select-all choice is a sentence, an ordering step is
   * either, and a matching column is expressions on one side and phrases on
   * the other. `inlineShape` is the same call the renderer makes, so a
   * fragment is checked the way it will be displayed rather than the way one
   * format happened to assume.
   */
  const checkOptions = (
    options: { id: string; latex: string }[],
    min: number,
    noun: string
  ): { ok: boolean; reason?: string } => {
    const ids = options.map((o) => o.id);
    if (new Set(ids).size !== ids.length) return { ok: false, reason: `duplicate ${noun} ids` };
    if (options.length < min) return { ok: false, reason: `too few ${noun}s` };
    for (const o of options) {
      const bad = inlineShape(o.latex) === "math" ? (renderOk(o.latex) ? null : o.latex) : proseOk(o.latex);
      if (bad) return { ok: false, reason: `${noun} latex fails: ${bad}` };
    }
    // Prose is compared as written. `normalizeMath` exists to decide whether
    // two *expressions* are the same answer, and putting sentences through it
    // is as likely to collide two distinct statements as to catch a repeat.
    //
    // Runs of whitespace still collapse, because `normalizeMath` removes
    // whitespace outright: every fragment that moves between these two branches
    // — a label like `Step 1` did — would otherwise quietly stop being checked
    // against its neighbour spelled with one more space.
    const normalized = options.map((o) =>
      inlineShape(o.latex) === "math"
        ? normalizeMath(o.latex)
        : o.latex.trim().toLowerCase().replace(/\s+/g, " ")
    );
    if (new Set(normalized).size !== normalized.length)
      return { ok: false, reason: `duplicate ${noun} values` };
    return { ok: true };
  };

  switch (p.format) {
    case "mcq": {
      const opts = checkOptions(p.choices, 3, "choice");
      if (!opts.ok) return opts;
      if (!p.choices.some((c) => c.id === p.correct_choice_id))
        return { ok: false, reason: "correct_choice_id not among choices" };
      return { ok: true };
    }
    case "open":
      if (!renderOk(p.answer.value_latex))
        return { ok: false, reason: `answer latex fails: ${p.answer.value_latex}` };
      return { ok: true };
    case "fill_blank": {
      const placeholders = [...p.statement_latex.matchAll(/\{\{(\d+)\}\}/g)].map((m) =>
        parseInt(m[1], 10)
      );
      if (placeholders.length === 0) return { ok: false, reason: "no {{n}} placeholders" };
      const answered = new Set(p.blanks.map((b) => b.index));
      for (const ph of placeholders) {
        if (!answered.has(ph)) return { ok: false, reason: `blank {{${ph}}} has no answer` };
      }
      return { ok: true };
    }
    case "multi_select": {
      const opts = checkOptions(p.choices, 4, "choice");
      if (!opts.ok) return opts;
      const ids = new Set(p.choices.map((c) => c.id));
      const correct = new Set(p.correct_choice_ids);
      if (correct.size === 0) return { ok: false, reason: "no correct choices" };
      if (correct.size !== p.correct_choice_ids.length)
        return { ok: false, reason: "duplicate correct choice ids" };
      for (const id of correct) {
        if (!ids.has(id)) return { ok: false, reason: `correct id ${id} not among choices` };
      }
      // "Select all" where everything is correct isn't a question — there is
      // nothing to discriminate and the student learns nothing from getting it.
      if (correct.size === ids.size) return { ok: false, reason: "every choice is correct" };
      return { ok: true };
    }
    case "ordering": {
      const opts = checkOptions(p.items, 3, "item");
      if (!opts.ok) return opts;
      const shown = p.items.map((i) => i.id);
      if (p.correct_order.length !== shown.length)
        return { ok: false, reason: "correct_order is not a full ordering" };
      if ([...p.correct_order].sort().join() !== [...shown].sort().join())
        return { ok: false, reason: "correct_order is not a permutation of the items" };
      // Presented already sorted means the problem ships pre-solved.
      if (p.correct_order.join() === shown.join())
        return { ok: false, reason: "items are listed in the correct order" };
      return { ok: true };
    }
    case "matching": {
      const leftOk = checkOptions(p.left, 3, "left item");
      if (!leftOk.ok) return leftOk;
      const rightOk = checkOptions(p.right, 3, "right item");
      if (!rightOk.ok) return rightOk;

      const leftIds = new Set<string>(p.left.map((l) => l.id));
      const rightIds = new Set<string>(p.right.map((r) => r.id));

      // Exactly one pair per left item, or the student is asked to match
      // something with no recorded answer.
      if (p.correct_pairs.length !== p.left.length)
        return { ok: false, reason: "not exactly one pair per left item" };
      const paired = new Set<string>();
      for (const pair of p.correct_pairs) {
        if (!leftIds.has(pair.left_id))
          return { ok: false, reason: `pair names unknown left id ${pair.left_id}` };
        if (!rightIds.has(pair.right_id))
          return { ok: false, reason: `pair names unknown right id ${pair.right_id}` };
        if (paired.has(pair.left_id))
          return { ok: false, reason: `left item ${pair.left_id} paired twice` };
        paired.add(pair.left_id);
      }
      // One right entry serving two left items makes the format ambiguous:
      // the student has no way to express it and grading can't score it.
      const usedRight = p.correct_pairs.map((pair) => pair.right_id);
      if (new Set(usedRight).size !== usedRight.length)
        return { ok: false, reason: "a right item is used by more than one pair" };
      // Equal columns hand over the last pair by elimination.
      if (p.right.length <= p.left.length)
        return { ok: false, reason: "right column needs at least one unmatched extra" };
      return { ok: true };
    }
    case "multi_part": {
      if (p.parts.length < 2) return { ok: false, reason: "multi-part needs 2+ parts" };
      const labels = p.parts.map((part) => part.label.trim());
      if (labels.some((l) => l.length === 0))
        return { ok: false, reason: "a part has an empty label" };
      if (new Set(labels).size !== labels.length)
        return { ok: false, reason: "duplicate part labels" };
      for (const part of p.parts) {
        const badPrompt = proseOk(part.prompt_latex);
        if (badPrompt)
          return { ok: false, reason: `part ${part.label} prompt latex fails: ${badPrompt}` };
        if (!renderOk(part.answer.value_latex))
          return {
            ok: false,
            reason: `part ${part.label} answer latex fails: ${part.answer.value_latex}`,
          };
      }
      return { ok: true };
    }
    case "graph": {
      const plot = plotFromSpec(p.plot);
      if (!plot) return { ok: false, reason: "plot window is empty or non-finite" };
      if (plot.curves.length !== p.plot.curves.length)
        return { ok: false, reason: "a curve has the wrong number of coefficients" };

      const w = plot.window;
      const inWindow = (pt: { x: number; y: number }) =>
        pt.x >= w.xMin && pt.x <= w.xMax && pt.y >= w.yMin && pt.y <= w.yMax;

      switch (p.response_kind) {
        case "value":
          if (!p.answer) return { ok: false, reason: "graph value problem has no answer" };
          if (!renderOk(p.answer.value_latex))
            return { ok: false, reason: `answer latex fails: ${p.answer.value_latex}` };
          return { ok: true };
        case "points": {
          const pts = p.correct_points ?? [];
          if (pts.length === 0) return { ok: false, reason: "no correct points" };
          if (!pts.every(inWindow))
            return { ok: false, reason: "a correct point lies outside the plot window" };
          // Selection snaps to the lattice, so a non-integer key is unreachable
          // — the student could never produce it however well they understood.
          if (!pts.every((pt) => Number.isInteger(pt.x) && Number.isInteger(pt.y)))
            return { ok: false, reason: "correct points must have integer coordinates" };
          const seen = new Set(pts.map((pt) => `${pt.x},${pt.y}`));
          if (seen.size !== pts.length) return { ok: false, reason: "duplicate correct points" };
          // A point already drawn on the plot is being handed over, not asked.
          for (const mark of plot.marks) {
            if (seen.has(`${mark.x},${mark.y}`))
              return { ok: false, reason: "an answer point is already marked on the plot" };
          }
          return { ok: true };
        }
        case "sketch": {
          if (!p.target_curve) return { ok: false, reason: "sketch problem has no target curve" };
          const target = curveFromAuthored(p.target_curve);
          if (!target) return { ok: false, reason: "target curve coefficients are unusable" };
          if (target.kind === "exp")
            return { ok: false, reason: "exponentials are not sketchable with handles" };
          // The target drawn among the reference curves is the answer on show.
          if (plot.curves.some((c) => curvesMatch(c, target, w)))
            return { ok: false, reason: "the target curve is already drawn on the plot" };
          return { ok: true };
        }
        default:
          return assertNeverGraphResponse(p.response_kind);
      }
    }
    default:
      return assertNeverFormat(p);
  }
}
