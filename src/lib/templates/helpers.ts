import type { OpenAnswer } from "@/lib/ai/schemas";

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
  const ids = ["A", "B", "C", "D", "E"] as const;
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
