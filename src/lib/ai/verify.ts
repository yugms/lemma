import katex from "katex";
import { callStructured, CHECKER_MODELS } from "@/lib/ai/provider";
import { SOLVER_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import {
  assertNeverFormat,
  assertNeverGraphResponse,
  GeneratedProblem,
  SolverResult,
  SolverResultSchema,
} from "@/lib/ai/schemas";
import { curveFromAuthored, curvesMatch, plotFromSpec, pointsMatch } from "@/lib/plot";
import { inlineShape } from "@/lib/math-render";
import {
  checkMultiAnswer,
  checkOpenAnswer,
  normalizeMath,
  numbersEqual,
  parseNumeric,
} from "@/lib/answers";

export type VerificationOutcome = {
  ok: boolean;
  reason?: string;
  solver?: SolverResult;
};

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
    const normalized = options.map((o) =>
      inlineShape(o.latex) === "math" ? normalizeMath(o.latex) : o.latex.trim().toLowerCase()
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

/** Independent solve with the cheap model. Statement only — no answer leakage. */
export async function solveIndependently(p: GeneratedProblem): Promise<SolverResult | null> {
  let statement = p.statement_latex;
  switch (p.format) {
    case "mcq":
      statement += `\n\nChoices:\n${p.choices.map((c) => `${c.id}) ${c.latex}`).join("\n")}`;
      break;
    case "fill_blank":
      statement += `\n\n(Fill in each numbered blank {{n}}. Give your answers as a list: 1: ..., 2: ...)`;
      break;
    case "multi_select":
      statement += `\n\nChoices:\n${p.choices.map((c) => `${c.id}) ${c.latex}`).join("\n")}
\n(More than one may be correct. Put every correct letter in chosen_choice_ids.)`;
      break;
    case "ordering":
      statement += `\n\nSteps, scrambled:\n${p.items.map((i) => `${i.id}) ${i.latex}`).join("\n")}
\n(Put these in the correct order. Give the letters in order in chosen_order.)`;
      break;
    case "matching":
      statement += `\n\nLeft:\n${p.left.map((l) => `${l.id}) ${l.latex}`).join("\n")}
\nRight:\n${p.right.map((r) => `${r.id}) ${r.latex}`).join("\n")}
\n(Pair each left letter with one right number. Some right entries match nothing. Put your pairing in chosen_pairs.)`;
      break;
    case "multi_part":
      statement += `\n\nParts:\n${p.parts
        .map((part) => `(${part.label}) ${part.prompt_latex}`)
        .join("\n")}
\n(Answer every part. Put one entry per part in part_answers, labelled.)`;
      break;
    case "graph": {
      // The solver reads no picture, so describe the plot exactly. That is a
      // fair test of the problem: if the curves and window don't determine the
      // answer in words, the drawing wasn't carrying the question either.
      const w = p.plot;
      statement += `\n\nPlot window: x from ${w.x_min} to ${w.x_max}, y from ${w.y_min} to ${w.y_max}.`;
      if (w.curves.length > 0) {
        statement += `\nCurves drawn: ${w.curves
          .map((c) => `${c.kind}(${c.coeffs.join(", ")})`)
          .join("; ")}`;
      }
      if (w.marks.length > 0) {
        statement += `\nPoints marked: ${w.marks
          .map((m) => `(${m.x}, ${m.y})${m.label ? ` "${m.label}"` : ""}`)
          .join(", ")}`;
      }
      if (p.response_kind === "points") {
        statement += `\n\n(Put every point being asked for in chosen_points.)`;
      } else if (p.response_kind === "sketch") {
        statement += `\n\n(Put the curve being asked for in chosen_curve, using coefficients: linear [m,b], quadratic [a,b,c], abs [a,h,k].)`;
      }
      break;
    }
    case "open":
      break;
    default:
      assertNeverFormat(p);
  }
  return callStructured({
    models: CHECKER_MODELS,
    label: `solve:${p.format}`,
    system: SOLVER_SYSTEM_PROMPT,
    prompt: statement,
    schema: SolverResultSchema,
    maxOutputTokens: 4000,
  });
}

/** Compare the solver's independent answer against the problem's stored answer. */
export function solverAgrees(p: GeneratedProblem, s: SolverResult): boolean {
  /** Letters the solver named, however it spelled them. */
  const letters = (raw: string[] | null): string[] =>
    (raw ?? []).map((x) => x.trim().toUpperCase()).filter(Boolean);

  if (p.format === "mcq") {
    return (
      s.chosen_choice_id?.trim().toUpperCase() === p.correct_choice_id ||
      // solver may have answered with the value instead of the letter
      normalizeMath(s.final_answer_latex) ===
        normalizeMath(p.choices.find((c) => c.id === p.correct_choice_id)?.latex ?? "")
    );
  }
  if (p.format === "multi_select") {
    const chosen = new Set(letters(s.chosen_choice_ids));
    const truth = new Set<string>(p.correct_choice_ids);
    return chosen.size === truth.size && [...truth].every((id) => chosen.has(id));
  }
  if (p.format === "ordering") {
    return letters(s.chosen_order).join() === p.correct_order.join();
  }
  if (p.format === "open") {
    const a = p.answer;
    if (a.kind === "numeric" && a.numeric_value !== null && s.final_answer_numeric !== null) {
      return numbersEqual(s.final_answer_numeric, a.numeric_value, a.tolerance);
    }
    const res = a.multi_valued
      ? checkMultiAnswer(s.final_answer_latex, a)
      : checkOpenAnswer(s.final_answer_latex, a);
    if (res === "correct") return true;
    if (res === "incorrect") {
      // last chance: numeric parse both sides
      const sn = s.final_answer_numeric ?? parseNumeric(normalizeMath(s.final_answer_latex));
      const tn = a.numeric_value ?? parseNumeric(normalizeMath(a.value_latex));
      if (sn !== null && tn !== null) return numbersEqual(sn, tn, a.tolerance);
      return false;
    }
    // "uncertain" — treat as agreement failure is too strict; treat as pass only
    // when numerics line up, else fail (repair pass will adjudicate).
    const sn = s.final_answer_numeric ?? parseNumeric(normalizeMath(s.final_answer_latex));
    const tn = a.numeric_value ?? parseNumeric(normalizeMath(a.value_latex));
    if (sn !== null && tn !== null) return numbersEqual(sn, tn, a.tolerance);
    return false;
  }
  if (p.format === "matching") {
    // Set equality on pairs: a solver that gets one pairing wrong necessarily
    // has a second one wrong too, so partial agreement is no agreement.
    const solved = new Map(
      (s.chosen_pairs ?? []).map((pair) => [
        pair.left_id.trim().toUpperCase(),
        pair.right_id.trim(),
      ])
    );
    if (solved.size !== p.correct_pairs.length) return false;
    return p.correct_pairs.every((pair) => solved.get(pair.left_id) === pair.right_id);
  }
  if (p.format === "multi_part") {
    const solved = new Map(
      (s.part_answers ?? []).map((a) => [a.label.trim().toLowerCase(), a.answer_latex])
    );
    return p.parts.every((part) => {
      const given = solved.get(part.label.trim().toLowerCase());
      if (given === undefined) return false;
      const res = part.answer.multi_valued
        ? checkMultiAnswer(given, part.answer)
        : checkOpenAnswer(given, part.answer);
      if (res === "correct") return true;
      // Same last-chance numeric reconciliation the `open` case uses: an
      // unsimplified but numerically right part shouldn't fail the problem.
      const sn = parseNumeric(normalizeMath(given));
      const tn = part.answer.numeric_value ?? parseNumeric(normalizeMath(part.answer.value_latex));
      return sn !== null && tn !== null && numbersEqual(sn, tn, part.answer.tolerance);
    });
  }
  if (p.format === "graph") {
    const plot = plotFromSpec(p.plot);
    if (!plot) return false;
    switch (p.response_kind) {
      case "value": {
        if (!p.answer) return false;
        const res = p.answer.multi_valued
          ? checkMultiAnswer(s.final_answer_latex, p.answer)
          : checkOpenAnswer(s.final_answer_latex, p.answer);
        if (res === "correct") return true;
        const sn = s.final_answer_numeric ?? parseNumeric(normalizeMath(s.final_answer_latex));
        const tn = p.answer.numeric_value ?? parseNumeric(normalizeMath(p.answer.value_latex));
        return sn !== null && tn !== null && numbersEqual(sn, tn, p.answer.tolerance);
      }
      case "points":
        // Tolerant here, exact at grading time: the solver is being asked to
        // agree that the key is right, not to click.
        return pointsMatch(s.chosen_points ?? [], p.correct_points ?? [], 1e-6);
      case "sketch": {
        const target = p.target_curve ? curveFromAuthored(p.target_curve) : null;
        const solved = s.chosen_curve ? curveFromAuthored(s.chosen_curve) : null;
        return target !== null && solved !== null && curvesMatch(solved, target, plot.window, 1e-4);
      }
      default:
        return assertNeverGraphResponse(p.response_kind);
    }
  }
  if (p.format === "fill_blank") {
    // Solver answers as "1: x, 2: y" — check each blank appears (normalized) in the answer string
    const flat = normalizeMath(s.final_answer_latex);
    return p.blanks.every((b) => {
      const t = normalizeMath(b.answer.value_latex);
      if (flat.includes(t)) return true;
      const tn = b.answer.numeric_value ?? parseNumeric(t);
      if (tn === null) return false;
      // check any numeric token in the solver answer matches
      const tokens = flat.split(/[^0-9./-]+/).filter(Boolean);
      return tokens.some((tok) => {
        const v = parseNumeric(tok);
        return v !== null && numbersEqual(v, tn, b.answer.tolerance);
      });
    });
  }
  return false;
}

/** Full verification of one AI-generated problem. */
export async function verifyProblem(
  p: GeneratedProblem,
  requestedDifficulty: number
): Promise<VerificationOutcome> {
  const structural = structuralCheck(p);
  if (!structural.ok) return { ok: false, reason: structural.reason };

  const solver = await solveIndependently(p);
  if (!solver) return { ok: false, reason: "solver call failed" };
  if (!solver.is_well_posed)
    return { ok: false, reason: `not well-posed: ${solver.issue ?? "unspecified"}`, solver };
  if (Math.abs(solver.difficulty_estimate - requestedDifficulty) > 1.5)
    return {
      ok: false,
      reason: `difficulty off: estimated ${solver.difficulty_estimate}, wanted ${requestedDifficulty}`,
      solver,
    };
  if (!solverAgrees(p, solver))
    return { ok: false, reason: `answer mismatch: solver got ${solver.final_answer_latex}`, solver };

  return { ok: true, solver };
}
