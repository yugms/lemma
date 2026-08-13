import katex from "katex";
import { callStructured, CHECKER_MODELS, SOLVES_PER_CALL } from "@/lib/ai/provider";
import { SOLVER_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import {
  assertNeverFormat,
  assertNeverGraphResponse,
  GeneratedProblem,
  OpenAnswer,
  SolvedBatchSchema,
  SolverResult,
  SolverResultSchema,
} from "@/lib/ai/schemas";
import { askModelIfEquivalent, type EquivalenceCheck } from "@/lib/ai/equivalence";
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

/**
 * Everything the solver is shown about one problem: the statement plus whatever
 * its format needs to be answerable, and never the answer.
 *
 * Split out from `solveIndependently` so a batched solve shows each problem
 * exactly what a solo solve would. Two ways of describing a problem to the
 * checker would drift, and the one that drifted would be the one used least.
 */
function solverPrompt(p: GeneratedProblem): string {
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
  // The solver is instructed to reject a self-contradictory problem, and an
  // error_analysis statement contains a deliberate mistake — so without this it
  // correctly reports the planted error as a defect and the problem is thrown
  // away for being exactly what it was written to be. Framing only: it is told
  // an error exists, never which one, so the solve stays independent.
  if (p.style === "error_analysis") {
    statement += `\n\n(This problem quotes a worked solution that deliberately contains exactly one mistake and asks for it to be found. The mistake is the subject of the question, not a flaw in the problem: treat the problem as well-posed, and answer with the error and its correction.)`;
  }
  return statement;
}

/** Independent solve with the cheap model. Statement only — no answer leakage. */
export async function solveIndependently(p: GeneratedProblem): Promise<SolverResult | null> {
  return callStructured({
    models: CHECKER_MODELS,
    label: `solve:${p.format}`,
    system: SOLVER_SYSTEM_PROMPT,
    prompt: solverPrompt(p),
    schema: SolverResultSchema,
    maxOutputTokens: 4000,
  });
}

/**
 * Solve a set in one request instead of one per problem.
 *
 * Verification was the half of a build whose request count scaled with the set
 * however cheap authoring got, and on a tier metered by requests that is what
 * bounds how many sets a day exist. Each problem still gets its own reasoning
 * and its own result; they share a request, not an answer.
 *
 * Kept deliberately small (`SOLVES_PER_CALL`) rather than one call per set. The
 * checker is the quality gate the whole pipeline rests on, a long shared
 * context is where a solver starts pattern-matching between problems instead of
 * solving them, and one unusable response should not cost a whole set its
 * verification.
 *
 * Returns one entry per problem, positionally — `null` where the batch did not
 * come back with a result claiming that problem, which the caller re-solves on
 * its own rather than treating as a disagreement.
 */
export async function solveBatch(
  problems: GeneratedProblem[],
  run: <T>(fn: () => Promise<T>) => Promise<T> = (fn) => fn()
): Promise<(SolverResult | null)[]> {
  // One problem is a solo solve; there is nothing to amortise and the batch
  // schema only adds a field for the model to get wrong.
  if (problems.length <= 1) {
    return problems.length === 0 ? [] : [await run(() => solveIndependently(problems[0]))];
  }

  const out: (SolverResult | null)[] = new Array(problems.length).fill(null);
  const chunks: { problem: GeneratedProblem; index: number }[][] = [];
  for (let i = 0; i < problems.length; i += SOLVES_PER_CALL) {
    chunks.push(
      problems.slice(i, i + SOLVES_PER_CALL).map((problem, k) => ({ problem, index: i + k }))
    );
  }

  await Promise.all(
    chunks.map((chunk) =>
      run(async () => {
        if (chunk.length === 1) {
          out[chunk[0].index] = await solveIndependently(chunk[0].problem);
          return;
        }
        const batch = await callStructured({
          models: CHECKER_MODELS,
          label: `solve:batch:${chunk.length}`,
          system: SOLVER_SYSTEM_PROMPT,
          prompt: `Solve each of the ${chunk.length} problems below independently, as if you had been given it on its own. Return one entry in "results" for each, and set problem_number to the [n] label of the problem it answers.\n\n${chunk
            .map((c, k) => `[${k + 1}] ${solverPrompt(c.problem)}`)
            .join("\n\n---\n\n")}`,
          schema: SolvedBatchSchema,
          maxOutputTokens: 4000 * chunk.length,
        });
        if (!batch) return; // leaves nulls; the caller re-solves them individually

        for (const r of batch.results) {
          // The model chose this number, so it is input: an out-of-range or
          // repeated one is dropped rather than trusted into another problem's
          // slot. A dropped result costs one solo re-solve; a mis-paired one
          // would judge a problem against somebody else's answer.
          const slot = chunk[r.problem_number - 1];
          if (!slot || out[slot.index] !== null) continue;
          out[slot.index] = r;
        }
      })
    )
  );

  return out;
}

/**
 * Compare the solver's independent answer against the problem's stored answer.
 *
 * `equivalent` is injected so a caller with no budget can pass
 * `notEquivalentWithoutAsking` and get the old numeric-only behaviour, the same
 * lever `checkSubmission`'s `allowAi` pulls.
 */
export async function solverAgrees(
  p: GeneratedProblem,
  s: SolverResult,
  equivalent: EquivalenceCheck = askModelIfEquivalent
): Promise<boolean> {
  /** Letters the solver named, however it spelled them. */
  const letters = (raw: string[] | null): string[] =>
    (raw ?? []).map((x) => x.trim().toUpperCase()).filter(Boolean);

  /**
   * Resolve an inconclusive local compare the way grading does, by asking.
   *
   * This is the normal case for a prose answer rather than an edge case:
   * `checkOpenAnswer` returns "uncertain" for every `kind: "text"` answer that
   * isn't character-identical, and `text` is what `proof`, `conceptual` and
   * `error_analysis` necessarily produce. Resolving it to `false` here — as
   * this did — rejected 100% of those problems on the first pass and again on
   * the repair re-check, which is why a set of them arrived empty while drill,
   * served entirely by templates, looked fine.
   *
   * A capacity failure degrades to "no agreement" rather than throwing: losing
   * one problem beats losing the set.
   */
  const meansTheSame = async (given: string, a: OpenAnswer): Promise<boolean> => {
    try {
      return await equivalent(given, a.value_latex, a.acceptable_forms ?? []);
    } catch {
      return false;
    }
  };

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
    // "uncertain": numerics first because they settle it for free, then ask.
    const sn = s.final_answer_numeric ?? parseNumeric(normalizeMath(s.final_answer_latex));
    const tn = a.numeric_value ?? parseNumeric(normalizeMath(a.value_latex));
    if (sn !== null && tn !== null) return numbersEqual(sn, tn, a.tolerance);
    return meansTheSame(s.final_answer_latex, a);
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
    for (const part of p.parts) {
      const given = solved.get(part.label.trim().toLowerCase());
      if (given === undefined) return false;
      const res = part.answer.multi_valued
        ? checkMultiAnswer(given, part.answer)
        : checkOpenAnswer(given, part.answer);
      if (res === "correct") continue;
      // Same last-chance numeric reconciliation the `open` case uses: an
      // unsimplified but numerically right part shouldn't fail the problem.
      const sn = parseNumeric(normalizeMath(given));
      const tn = part.answer.numeric_value ?? parseNumeric(normalizeMath(part.answer.value_latex));
      if (sn !== null && tn !== null) {
        if (numbersEqual(sn, tn, part.answer.tolerance)) continue;
        return false;
      }
      // A part answered in prose gets the same escalation as a whole `open`
      // problem — the parts of a proof are prose far more often than not.
      if (res === "incorrect" || !(await meansTheSame(given, part.answer))) return false;
    }
    return true;
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
        if (sn !== null && tn !== null) return numbersEqual(sn, tn, p.answer.tolerance);
        // Reading a value off a plot is usually numeric, so this rarely fires —
        // but when it doesn't parse, the answer is prose and deserves the ask.
        return res !== "incorrect" && meansTheSame(s.final_answer_latex, p.answer);
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

/**
 * `error_analysis` hands the solver a worked solution with a deliberate mistake
 * in it. The solver's contract tells it to fail anything "self-contradictory",
 * so the style and the gate contradict each other outright and the style could
 * never pass. The flaw is the question here, so only the other styles are held
 * to it — and `solveIndependently` says as much in the prompt, so this is the
 * backstop rather than the whole answer.
 */
const flawIsThePoint = (p: GeneratedProblem) => p.style === "error_analysis";

/**
 * How far the solver's difficulty estimate may sit from what was asked for.
 *
 * ±1 fits drill, where the rubric's "one step vs several" maps straight onto
 * the arithmetic. Every other style adds work the rubric counts as cognitive
 * load — translating a scenario, justifying a claim, finding a planted error —
 * so the same problem reads a level harder to the solver than it did to the
 * author. At the builder's default difficulty of 2 that rejected most of what
 * was written before its answer was ever looked at.
 */
const difficultyTolerance = (style: GeneratedProblem["style"]) =>
  style === "drill" ? 1.5 : 2.5;

/**
 * The gates that need a solver result, in one place so the repair re-check
 * applies the same rules as the first pass. It used to drop the difficulty
 * check entirely, which left a problem rejectable for a bound its repaired
 * version was never held to.
 *
 * Returns the reason it failed, or null when it passed.
 */
export async function solverGates(
  p: GeneratedProblem,
  solver: SolverResult,
  requestedDifficulty: number,
  equivalent?: EquivalenceCheck
): Promise<string | null> {
  if (!solver.is_well_posed && !flawIsThePoint(p))
    return `not well-posed: ${solver.issue ?? "unspecified"}`;
  if (Math.abs(solver.difficulty_estimate - requestedDifficulty) > difficultyTolerance(p.style))
    return `difficulty off: estimated ${solver.difficulty_estimate}, wanted ${requestedDifficulty}`;
  if (!(await solverAgrees(p, solver, equivalent)))
    return `answer mismatch: solver got ${solver.final_answer_latex}`;
  return null;
}

/**
 * Full verification of one AI-generated problem.
 *
 * `presolved` is this problem's share of a batched solve. Passing `null` — the
 * batch came back without a result claiming it — falls through to a solo solve
 * rather than counting as a disagreement, so a short or malformed batch costs
 * requests, never problems.
 */
export async function verifyProblem(
  p: GeneratedProblem,
  requestedDifficulty: number,
  presolved?: SolverResult | null
): Promise<VerificationOutcome> {
  const structural = structuralCheck(p);
  if (!structural.ok) return { ok: false, reason: structural.reason };

  const solver = presolved ?? (await solveIndependently(p));
  if (!solver) return { ok: false, reason: "solver call failed" };
  const reason = await solverGates(p, solver, requestedDifficulty);
  return reason ? { ok: false, reason, solver } : { ok: true, solver };
}
