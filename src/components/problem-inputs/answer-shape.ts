/**
 * The two shapes an answer takes on its way through the card: the state the
 * inputs hold, and the wire value the grader is sent.
 *
 * Pure, and deliberately outside the `"use client"` inputs that use it —
 * `seedFrom` is the coercion boundary for a stored submission read back off
 * the wire, and that is testable without a browser or React.
 */
import type { Point } from "@/components/problem-inputs/graph-points";
import {
  curveFromHandles,
  defaultHandles,
  type Handle,
  type SketchKind,
} from "@/components/problem-inputs/graph-sketch";
import { assertNeverFormat } from "@/lib/ai/kinds";
import type { PreparedProblem } from "@/lib/ai/schemas";

export type Seed = {
  choice: string | null;
  open: string;
  blanks: Record<string, string>;
  selected: string[];
  order: string[];
  pairs: Record<string, string>;
  parts: Record<string, string>;
  points: Point[];
  handles: Handle[];
};

/** Which curve family a sketch problem asks for, defaulting to a line. */
export function sketchKind(p: PreparedProblem): SketchKind {
  const k = p.sketch_kind;
  return k === "quadratic" || k === "abs" ? k : "linear";
}

/** Curve -> the coefficient form the answer key is stored in. */
export function curveToPayload(c: ReturnType<typeof curveFromHandles>) {
  if (!c) return null;
  switch (c.kind) {
    case "linear":
      return { kind: "linear", coeffs: [c.m, c.b] };
    case "quadratic":
      return { kind: "quadratic", coeffs: [c.a, c.b, c.c] };
    case "abs":
      return { kind: "abs", coeffs: [c.a, c.h, c.k] };
    default:
      return null;
  }
}

const asPoints = (v: unknown): Point[] =>
  Array.isArray(v)
    ? v.flatMap((p) => {
        const { x, y } = (p ?? {}) as { x?: unknown; y?: unknown };
        return typeof x === "number" && typeof y === "number" ? [{ x, y }] : [];
      })
    : [];

/** A `{ key: string }` submission off the wire, with anything else dropped. */
const asStringMap = (v: unknown): Record<string, string> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val;
  }
  return out;
};

const asStringList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** Rebuild the input state from a stored submission, for review mode. */
export function seedFrom(problem: PreparedProblem, submitted: unknown): Seed {
  const empty: Seed = {
    choice: null,
    open: "",
    blanks: {},
    selected: [],
    // Ordering always starts from the scrambled order the problem was stored in,
    // so the server-rendered list and the hydrated one agree.
    order: (problem.items ?? []).map((i) => i.id),
    pairs: {},
    parts: {},
    points: [],
    handles: problem.plot_window
      ? defaultHandles(sketchKind(problem), problem.plot_window)
      : [],
  };
  switch (problem.format) {
    case "mcq":
      return { ...empty, choice: typeof submitted === "string" ? submitted : null };
    case "open":
      return { ...empty, open: typeof submitted === "string" ? submitted : "" };
    case "fill_blank":
      return {
        ...empty,
        blanks:
          submitted && typeof submitted === "object"
            ? (submitted as Record<string, string>)
            : {},
      };
    case "multi_select":
      return { ...empty, selected: asStringList(submitted) };
    case "ordering": {
      const stored = asStringList(submitted);
      // Only trust a stored order that is still a permutation of this problem's
      // steps — a pooled problem could have been re-authored underneath it.
      const valid =
        stored.length === empty.order.length &&
        [...stored].sort().join() === [...empty.order].sort().join();
      return { ...empty, order: valid ? stored : empty.order };
    }
    case "matching":
      return { ...empty, pairs: asStringMap(submitted) };
    case "multi_part":
      return { ...empty, parts: asStringMap(submitted) };
    case "graph":
      if (problem.response_kind === "value") {
        return { ...empty, open: typeof submitted === "string" ? submitted : "" };
      }
      if (problem.response_kind === "points") {
        return { ...empty, points: asPoints(submitted) };
      }
      // A sketch is submitted as the fitted curve, not as handle positions —
      // two placements describe the same line — so review restarts from the
      // defaults rather than trying to invert the fit.
      return empty;
    default:
      return assertNeverFormat(problem.format);
  }
}
