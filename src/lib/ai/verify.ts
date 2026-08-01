import katex from "katex";
import { callStructured, CHECKER_MODELS } from "@/lib/ai/provider";
import { SOLVER_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import {
  assertNeverFormat,
  GeneratedProblem,
  SolverResult,
  SolverResultSchema,
} from "@/lib/ai/schemas";
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
   * Shared by every format presenting a labelled list. Choices are bare LaTeX;
   * ordering steps are prose that may embed math ("divide both sides by \(3\)"),
   * so they are validated the way the statement is.
   */
  const checkOptions = (
    options: { id: string; latex: string }[],
    min: number,
    noun: string,
    mode: "math" | "prose" = "math"
  ): { ok: boolean; reason?: string } => {
    const ids = options.map((o) => o.id);
    if (new Set(ids).size !== ids.length) return { ok: false, reason: `duplicate ${noun} ids` };
    if (options.length < min) return { ok: false, reason: `too few ${noun}s` };
    for (const o of options) {
      const bad = mode === "prose" ? proseOk(o.latex) : renderOk(o.latex) ? null : o.latex;
      if (bad) return { ok: false, reason: `${noun} latex fails: ${bad}` };
    }
    const normalized = options.map((o) => normalizeMath(o.latex));
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
      const opts = checkOptions(p.items, 3, "item", "prose");
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
    case "open":
      break;
    default:
      assertNeverFormat(p);
  }
  return callStructured({
    models: CHECKER_MODELS,
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

/** Run an async mapper with bounded concurrency. */
export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
