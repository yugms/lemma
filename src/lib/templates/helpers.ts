import { CHOICE_IDS, MCQ_CHOICE_IDS, type ChoiceId } from "@/lib/ai/kinds";
import type { ExplanationStep, OpenAnswer } from "@/lib/ai/schemas";
import type { Rng } from "@/lib/rng";

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

/** "3x", "-x", "x", "0" — a coefficient attached to a symbol. */
export function term(coef: number, sym: string): string {
  if (coef === 0) return "0";
  if (coef === 1) return sym;
  if (coef === -1) return `-${sym}`;
  return `${coef}${sym}`;
}

/** "+ 3x", "- x", "+ 5" — a follow-on term with its sign, or "" when zero. */
export function signedTerm(coef: number, sym = ""): string {
  if (coef === 0) return "";
  const abs = Math.abs(coef);
  const body = sym === "" ? `${abs}` : abs === 1 ? sym : `${abs}${sym}`;
  return coef > 0 ? ` + ${body}` : ` - ${body}`;
}

/** Format ax^2 + bx + c as LaTeX (skipping zero terms). */
export function quadraticLatex(a: number, b: number, c: number, v = "x"): string {
  let s = term(a, `${v}^2`);
  s += signedTerm(b, v);
  s += signedTerm(c);
  return s;
}

/** Format a fraction in lowest terms as LaTeX. */
export function fractionLatex(num: number, den: number): string {
  if (den === 0) return "\\text{undefined}";
  if (num === 0) return "0";
  const sign = num * den < 0 ? "-" : "";
  let n = Math.abs(num);
  let d = Math.abs(den);
  const g = gcd(n, d);
  n /= g;
  d /= g;
  return d === 1 ? `${sign}${n}` : `${sign}\\frac{${n}}{${d}}`;
}

/** Decompose D into k^2 * m with m squarefree-ish (largest square factor extracted). */
export function simplifyRadical(D: number): { k: number; m: number } {
  let k = 1;
  let m = D;
  for (let i = Math.floor(Math.sqrt(D)); i >= 2; i--) {
    if (D % (i * i) === 0) {
      k = i;
      m = D / (i * i);
      break;
    }
  }
  return { k, m };
}

export function numericAnswer(value: number, latex?: string): OpenAnswer {
  return {
    value_latex: latex ?? String(value),
    kind: "numeric",
    numeric_value: value,
    tolerance: null,
    acceptable_forms: [],
    multi_valued: false,
  };
}

export function expressionAnswer(latex: string, acceptable: string[] = []): OpenAnswer {
  return {
    value_latex: latex,
    kind: "expression",
    numeric_value: null,
    tolerance: null,
    acceptable_forms: acceptable,
    multi_valued: false,
  };
}

export function multiValueAnswer(latex: string, acceptable: string[] = []): OpenAnswer {
  return {
    value_latex: latex,
    kind: "expression",
    numeric_value: null,
    tolerance: null,
    acceptable_forms: acceptable,
    multi_valued: true,
  };
}

/**
 * Turn a worked solution into an ordering problem.
 *
 * Templates already author their steps in order, so the exercise is free: shuffle
 * them for presentation and keep the authored sequence as the answer. Every step
 * carries its own note, because "what was done" is the thing being ordered — a
 * bare stack of equations can often be sorted by inspection.
 *
 * Presentation order is drawn from the seeded `rng` and re-drawn until it isn't
 * the answer, since a problem that ships already sorted is no problem at all.
 */
export function buildOrdering(
  rng: Rng,
  steps: ExplanationStep[]
): { items: { id: ChoiceId; latex: string }[]; correct_order: ChoiceId[] } {
  const label = (s: ExplanationStep) => {
    const math = s.latex ? `\\(${s.latex}\\)` : "";
    if (math && s.note) return `${math} — ${s.note}`;
    return math || s.note;
  };

  // Deduplicated because the structural check rejects two items that normalize
  // to the same thing — and a repeated step is unorderable anyway.
  const texts: string[] = [];
  for (const step of steps) {
    const text = label(step);
    if (text.length > 0 && !texts.includes(text)) texts.push(text);
    if (texts.length === CHOICE_IDS.length) break;
  }
  const canonical = texts.map((latex, i) => ({ id: CHOICE_IDS[i], latex }));

  const correct_order = canonical.map((c) => c.id);
  let items = rng.shuffle(canonical);
  for (let tries = 0; tries < 12 && sameOrder(items, correct_order); tries++) {
    items = rng.shuffle(canonical);
  }
  // Guaranteed fallback, so this never returns a pre-sorted problem.
  if (sameOrder(items, correct_order) && items.length >= 2) {
    items = [items[1], items[0], ...items.slice(2)];
  }
  return { items, correct_order };
}

const sameOrder = (items: { id: ChoiceId }[], order: ChoiceId[]) =>
  items.map((i) => i.id).join() === order.join();

/**
 * Numeric distractors that can't collapse.
 *
 * `buildChoices` drops any distractor equal to the answer, and the structural
 * check drops any two that normalize alike — so a set of misconception-derived
 * candidates that happen to coincide (a + b and |a| + |b| are the same number
 * whenever both are positive) can leave a question with two options. Candidates
 * are taken in order of how instructive they are, then padded with near misses
 * only if that is what it takes to reach three.
 */
export function numericDistractors(
  value: number,
  candidates: { value: number; misconception: string }[]
): { latex: string; misconception: string }[] {
  const seen = new Set<number>([value]);
  const out: { latex: string; misconception: string }[] = [];

  for (const c of candidates) {
    if (!Number.isFinite(c.value) || seen.has(c.value)) continue;
    seen.add(c.value);
    out.push({ latex: `${c.value}`, misconception: c.misconception });
    if (out.length === 3) return out;
  }

  for (let d = 1; out.length < 3; d++) {
    for (const v of [value + d, value - d]) {
      if (out.length === 3 || seen.has(v)) continue;
      seen.add(v);
      out.push({ latex: `${v}`, misconception: "Arithmetic slip in the final step." });
    }
  }
  return out;
}

/** Build 4 MCQ choices from a correct value and 3+ distractors (deduped, shuffled). */
export function buildChoices(
  rng: { shuffle<T>(items: readonly T[]): T[] },
  correct: string,
  distractors: { latex: string; misconception: string }[]
): {
  choices: { id: "A" | "B" | "C" | "D" | "E"; latex: string }[];
  correct_choice_id: "A" | "B" | "C" | "D" | "E";
  distractor_rationales: { choice_id: "A" | "B" | "C" | "D" | "E"; misconception: string }[];
} {
  const seen = new Set([correct]);
  const uniqueDistractors = distractors.filter((d) => {
    if (seen.has(d.latex)) return false;
    seen.add(d.latex);
    return true;
  });
  const entries = rng.shuffle([
    { latex: correct, misconception: null as string | null },
    ...uniqueDistractors.slice(0, 3).map((d) => ({ latex: d.latex, misconception: d.misconception as string | null })),
  ]);
  const ids = MCQ_CHOICE_IDS;
  const choices = entries.map((e, i) => ({ id: ids[i], latex: e.latex }));
  const correctIdx = entries.findIndex((e) => e.misconception === null);
  return {
    choices,
    correct_choice_id: ids[correctIdx],
    distractor_rationales: entries
      .map((e, i) => ({ choice_id: ids[i], misconception: e.misconception }))
      .filter((e): e is { choice_id: (typeof ids)[number]; misconception: string } => e.misconception !== null),
  };
}
