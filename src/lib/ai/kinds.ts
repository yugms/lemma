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
