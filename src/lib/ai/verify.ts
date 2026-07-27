import katex from "katex";
import { callStructured, CHECKER_MODELS } from "@/lib/ai/provider";
import { SOLVER_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import {
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
  // Statement: check each embedded math segment
  const segments = [...p.statement_latex.matchAll(/\\\((.+?)\\\)|\\\[([\s\S]+?)\\\]/g)];
  for (const m of segments) {
    const inner = m[1] ?? m[2];
    if (inner && !renderOk(inner)) return { ok: false, reason: `statement latex fails: ${inner}` };
  }
  for (const step of p.explanation_steps) {
    if (step.latex && !renderOk(step.latex))
      return { ok: false, reason: `explanation latex fails: ${step.latex}` };
  }
  if (p.explanation_steps.length === 0) return { ok: false, reason: "no explanation steps" };

  if (p.format === "mcq") {
    const ids = p.choices.map((c) => c.id);
    if (new Set(ids).size !== ids.length) return { ok: false, reason: "duplicate choice ids" };
    if (p.choices.length < 3) return { ok: false, reason: "too few choices" };
    if (!ids.includes(p.correct_choice_id))
      return { ok: false, reason: "correct_choice_id not among choices" };
    for (const c of p.choices) {
      if (!renderOk(c.latex)) return { ok: false, reason: `choice latex fails: ${c.latex}` };
    }
    // No duplicate choice contents
    const normalized = p.choices.map((c) => normalizeMath(c.latex));
    if (new Set(normalized).size !== normalized.length)
      return { ok: false, reason: "duplicate choice values" };
  }
  if (p.format === "open" && !renderOk(p.answer.value_latex)) {
    return { ok: false, reason: `answer latex fails: ${p.answer.value_latex}` };
  }
  if (p.format === "fill_blank") {
    const placeholders = [...p.statement_latex.matchAll(/\{\{(\d+)\}\}/g)].map((m) =>
      parseInt(m[1], 10)
    );
    if (placeholders.length === 0) return { ok: false, reason: "no {{n}} placeholders" };
    const answered = new Set(p.blanks.map((b) => b.index));
    for (const ph of placeholders) {
      if (!answered.has(ph)) return { ok: false, reason: `blank {{${ph}}} has no answer` };
    }
  }
  return { ok: true };
}

/** Independent solve with the cheap model. Statement only — no answer leakage. */
export async function solveIndependently(p: GeneratedProblem): Promise<SolverResult | null> {
  let statement = p.statement_latex;
  if (p.format === "mcq") {
    statement += `\n\nChoices:\n${p.choices.map((c) => `${c.id}) ${c.latex}`).join("\n")}`;
  }
  if (p.format === "fill_blank") {
    statement += `\n\n(Fill in each numbered blank {{n}}. Give your answers as a list: 1: ..., 2: ...)`;
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
  if (p.format === "mcq") {
    return (
      s.chosen_choice_id?.trim().toUpperCase() === p.correct_choice_id ||
      // solver may have answered with the value instead of the letter
      normalizeMath(s.final_answer_latex) ===
        normalizeMath(p.choices.find((c) => c.id === p.correct_choice_id)?.latex ?? "")
    );
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
