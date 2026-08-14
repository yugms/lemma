/**
 * The problem vocabulary, with no zod in it.
 *
 * These live apart from `schemas.ts` for one reason: the browser needs them and
 * must not pay for zod to get them. `schemas.ts` defines 36 top-level schemas,
 * so importing *any* value from it — a format list, an exhaustiveness helper —
 * pulls the whole zod runtime into the client bundle. It measured 283 kB, on
 * seven routes including the landing page, to give three components a list of
 * eight strings.
 *
 * `schemas.ts` re-exports everything below, so it is still the one file to open
 * to learn what a problem is. The split is a bundling boundary, not a second
 * source of truth: nothing here may import zod, and nothing here may reference
 * a type inferred from a schema. `kindOf` stays on the other side for exactly
 * that reason — it takes a `GeneratedProblem`.
 *
 * `client-bundle.test.ts` is what keeps this honest.
 */

export const PROBLEM_STYLES = [
  "drill",
  "word",
  "conceptual",
  "proof",
  "error_analysis",
] as const;
export type ProblemStyle = (typeof PROBLEM_STYLES)[number];

export const PROBLEM_FORMATS = [
  "mcq",
  "open",
  "fill_blank",
  "multi_select",
  "ordering",
  "matching",
  "multi_part",
  "graph",
] as const;
export type ProblemFormat = (typeof PROBLEM_FORMATS)[number];

/**
 * What one authoring call asks for. `graph` is three genuinely different tasks
 * sharing a DB format — reading a value off a plot, identifying points on it,
 * and producing a curve — and a model writes each of them far better when the
 * request and the schema speak about only one.
 */
export const GENERATION_KINDS = [
  "mcq",
  "open",
  "fill_blank",
  "multi_select",
  "ordering",
  "matching",
  "multi_part",
  "graph_value",
  "graph_points",
  "graph_sketch",
] as const;
export type GenerationKind = (typeof GENERATION_KINDS)[number];

/** The DB format a generation kind produces. */
export function formatForKind(kind: GenerationKind): ProblemFormat {
  return kind.startsWith("graph_") ? "graph" : (kind as ProblemFormat);
}

/** The authoring kinds that can satisfy a requested format. */
export function kindsForFormat(format: ProblemFormat): GenerationKind[] {
  return format === "graph"
    ? ["graph_value", "graph_points", "graph_sketch"]
    : [format as GenerationKind];
}

/**
 * Every format-dependent branch in this codebase ends in this. Adding a format
 * then turns each unhandled branch into a compile error instead of a silent
 * wrong answer — a fall-through here used to mean an unanswerable problem, a
 * disabled Check button, or a 500 from `/api/check`.
 */
export function assertNeverFormat(x: never): never {
  throw new Error(`Unhandled problem format: ${JSON.stringify(x)}`);
}

export const GRAPH_RESPONSE_KINDS = ["value", "points", "sketch"] as const;
export type GraphResponseKind = (typeof GRAPH_RESPONSE_KINDS)[number];

/** Same guard rail as `assertNeverFormat`, one level down. */
export function assertNeverGraphResponse(x: never): never {
  throw new Error(`Unhandled graph response kind: ${JSON.stringify(x)}`);
}

/**
 * A difficulty in range, or the middle of the range when there wasn't a number.
 *
 * The 1-5 scale is enforced in four unrelated places — a model's self-reported
 * level, a coach prescription, a row on its way into `problems`, and the
 * builder's shift control — and three of them had spelled the same
 * `Math.min(5, Math.max(1, Math.round(d)))` inline. Changing the scale is
 * therefore one edit rather than a search.
 *
 * The `NaN` fallback is why this is a function and not an expression: it only
 * matters where the number came from a model, but it costs nothing everywhere
 * else, and the alternative was one call site quietly having a stricter rule
 * than the others.
 */
export function clampDifficulty(value: number): number {
  const level = Math.round(value);
  return Number.isFinite(level) ? Math.min(5, Math.max(1, level)) : 3;
}

/**
 * Option letters, in the two lengths the app uses.
 *
 * `mcq` offers up to five so a printed sheet keeps one line per option;
 * `multi_select`, `matching` and `ordering` go to six. Both were spelled out
 * as literals in the schemas, in the template helpers, and again wherever a
 * letter had to be assigned — and a list that disagrees with its schema is a
 * problem the model authors and validation then discards.
 */
export const MCQ_CHOICE_IDS = ["A", "B", "C", "D", "E"] as const;
export const CHOICE_IDS = [...MCQ_CHOICE_IDS, "F"] as const;
export type ChoiceId = (typeof CHOICE_IDS)[number];
