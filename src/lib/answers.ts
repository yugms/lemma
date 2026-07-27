import type { OpenAnswer } from "@/lib/ai/schemas";

/**
 * Local (zero-cost) answer comparison. Returns:
 *  - "correct" / "incorrect" when we can decide locally
 *  - "uncertain" when the answer needs an AI equivalence check
 */
export type LocalCheckResult = "correct" | "incorrect" | "uncertain";

/** Normalize a LaTeX-ish math string into a canonical ASCII form for comparison. */
export function normalizeMath(input: string): string {
  let s = input.trim();
  // Strip math delimiters and sizing commands
  s = s.replace(/\\left|\\right|\\!|\\,|\\;|\\quad|\\qquad/g, "");
  s = s.replace(/\$\$?|\\\(|\\\)|\\\[|\\\]/g, "");
  // \frac{a}{b} -> (a)/(b)   (repeat for nesting)
  for (let i = 0; i < 5; i++) {
    const before = s;
    s = s.replace(/\\d?frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)");
    if (s === before) break;
  }
  // \sqrt[n]{x} -> root(n,x) ; \sqrt{x} -> sqrt(x)
  s = s.replace(/\\sqrt\[([^\]]*)\]\{([^{}]*)\}/g, "root($1,$2)");
  s = s.replace(/\\sqrt\{([^{}]*)\}/g, "sqrt($1)");
  s = s.replace(/\\cdot|\\times/g, "*");
  s = s.replace(/\\div/g, "/");
  s = s.replace(/\\pi/g, "pi");
  s = s.replace(/\\infty/g, "inf");
  s = s.replace(/\\pm/g, "+-");
  s = s.replace(/\\(sin|cos|tan|sec|csc|cot|ln|log|exp|arcsin|arccos|arctan)/g, "$1");
  // ^{ab} -> ^(ab), _{ab} -> _(ab)
  s = s.replace(/\^\{([^{}]*)\}/g, "^($1)");
  s = s.replace(/_\{([^{}]*)\}/g, "_($1)");
  // Remaining braces act as grouping
  s = s.replace(/\{/g, "(").replace(/\}/g, ")");
  // Drop any leftover backslashes and whitespace, lowercase nothing (vars are case-sensitive)
  s = s.replace(/\\/g, "");
  s = s.replace(/\s+/g, "");
  // Redundant grouping around single tokens: (x) -> x, (12) -> 12 — but keep
  // function application like sqrt(2) intact (paren preceded by a letter).
  for (let i = 0; i < 3; i++) {
    s = s.replace(/(?<![a-zA-Z])\(([a-zA-Z0-9.-]+)\)/g, "$1");
  }
  // x = 5 answers: strip a leading single-variable assignment
  s = s.replace(/^[a-zA-Z](\([a-zA-Z]\))?=/, "");
  // Normalize unary forms
  s = s.replace(/\+-/g, "±").replace(/±/g, "+-");
  return s;
}

/** Try to interpret a normalized string as a plain number (supports fractions like -3/4 and decimals). */
export function parseNumeric(normalized: string): number | null {
  const s = normalized.replace(/[()]/g, "");
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const frac = s.match(/^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/);
  if (frac) {
    const den = parseFloat(frac[2]);
    if (den === 0) return null;
    return parseFloat(frac[1]) / den;
  }
  return null;
}

export function numbersEqual(a: number, b: number, tolerance?: number | null): boolean {
  const tol = tolerance ?? Math.max(1e-6, Math.abs(b) * 1e-6);
  return Math.abs(a - b) <= tol;
}

/** Compare a student's free-form answer against a canonical open answer, locally. */
export function checkOpenAnswer(student: string, canonical: OpenAnswer): LocalCheckResult {
  const s = normalizeMath(student);
  if (s.length === 0) return "incorrect";
  const target = normalizeMath(canonical.value_latex);

  if (s === target) return "correct";

  // Accepted alternate forms
  for (const form of canonical.acceptable_forms ?? []) {
    if (s === normalizeMath(form)) return "correct";
  }

  // Numeric comparison
  const sNum = parseNumeric(s);
  if (canonical.kind === "numeric") {
    const targetNum =
      canonical.numeric_value ?? parseNumeric(target);
    if (sNum !== null && targetNum !== null) {
      return numbersEqual(sNum, targetNum, canonical.tolerance) ? "correct" : "incorrect";
    }
    // Student wrote something non-numeric for a numeric answer — could be an
    // unevaluated expression like "sqrt(2)/2"; punt to AI.
    return "uncertain";
  }

  // Expression answers: exact-normalized match failed; the forms may still be
  // equivalent (e.g. factored vs expanded) — punt to AI.
  return "uncertain";
}

/** Multiset comparison for answers like "x = 2, -5" where order doesn't matter. */
export function checkMultiAnswer(student: string, canonical: OpenAnswer): LocalCheckResult {
  const split = (v: string) =>
    normalizeMath(v)
      .split(/,|;|\bor\b/)
      .map((p) => p.trim().replace(/^[a-zA-Z](\([a-zA-Z]\))?=/, ""))
      .filter(Boolean)
      .sort();
  const sParts = split(student);
  const tParts = split(canonical.value_latex);
  if (sParts.length === tParts.length && sParts.every((p, i) => p === tParts[i])) {
    return "correct";
  }
  // Try numeric multiset compare
  const sNums = sParts.map(parseNumeric);
  const tNums = tParts.map(parseNumeric);
  if (sNums.every((n) => n !== null) && tNums.every((n) => n !== null)) {
    if (sNums.length !== tNums.length) return "incorrect";
    const remaining = [...(tNums as number[])];
    for (const n of sNums as number[]) {
      const idx = remaining.findIndex((t) => numbersEqual(n, t, canonical.tolerance));
      if (idx === -1) return "incorrect";
      remaining.splice(idx, 1);
    }
    return "correct";
  }
  return checkOpenAnswer(student, canonical);
}
