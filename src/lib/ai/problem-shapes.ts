/**
 * What a problem looks like once it is stored, sent, or shown.
 *
 * Split from `schemas.ts` on the same line `kinds.ts` draws: everything here is
 * a plain type or a pure function, and the only thing it takes from the schemas
 * is the shape of what they infer — a type-only import, erased at compile time.
 * So this module carries no zod at runtime, and the types the browser needs can
 * be reached without a client component having to remember to write
 * `import type`. `schemas.ts` re-exports all of it, so it is still the one file
 * to open.
 */
import { assertNeverFormat } from "@/lib/ai/kinds";
import type { GraphResponseKind, ProblemFormat, ProblemStyle } from "@/lib/ai/kinds";
import type {
  AuthoredCurve,
  AuthoredPlot,
  ExplanationStep,
  GeneratedProblem,
  OpenAnswer,
  PlotPoint,
} from "@/lib/ai/schemas";

/** What the client is allowed to see during practice (no answers). */
export type SanitizedProblem = {
  id: string;
  position: number;
  style: ProblemStyle;
  format: ProblemFormat;
  difficulty: number;
  statement_latex: string;
  hint: string | null;
  choices?: { id: string; latex: string }[];
  blanks_count?: number;
  /** Ordering: the steps in the scrambled order the student sees them. */
  items?: { id: string; latex: string }[];
  /** Matching: both columns are public; only the pairing is secret. */
  left?: { id: string; latex: string }[];
  right?: { id: string; latex: string }[];
  /** Multi-part: the prompts only — each part's answer stays in the key. */
  parts?: { label: string; prompt_latex: string }[];
  /** Graph: the plot is the stimulus, so it travels with the statement. */
  plot?: AuthoredPlot;
  response_kind?: GraphResponseKind;
  sketch_kind?: string;
  topic_title?: string;
};

/**
 * A `SanitizedProblem` with its math already rendered to HTML on the server.
 * This is what reaches the browser: KaTeX runs in Node, and the client only
 * ever injects markup. Built by `prepareProblem()` in `@/lib/math-render`.
 */
export type PreparedProblem = {
  id: string;
  position: number;
  style: ProblemStyle;
  format: ProblemFormat;
  difficulty: number;
  statement_html: string;
  hint_html: string | null;
  choices?: { id: string; html: string }[];
  blanks_count?: number;
  items?: { id: string; html: string }[];
  left?: { id: string; html: string }[];
  right?: { id: string; html: string }[];
  parts?: { label: string; prompt_html: string }[];
  /** Graph: SVG rendered in Node, plus the window the overlay needs. */
  plot_svg?: string;
  plot_window?: { xMin: number; xMax: number; yMin: number; yMax: number };
  response_kind?: GraphResponseKind;
  sketch_kind?: string;
  topic_title?: string;
};

/**
 * What `POST /api/check` returns. Math arrives as rendered HTML rather than
 * LaTeX so the practice page never has to load KaTeX.
 */
export type CheckResponse = {
  correct?: boolean;
  revealed?: boolean;
  feedback?: {
    what_went_wrong_html: string;
    next_hint_html: string;
    /** The named error, for the mistake log. Not shown as prose. */
    misconception?: string;
  } | null;
  /**
   * The answer key. Absent while a retry is still available — handing over the
   * answer and then inviting a second attempt would make the retry a copying
   * exercise. Present on every terminal outcome: correct, revealed, retried,
   * or recalled.
   */
  answer?: {
    correct_choice_id?: string;
    correct_choice_ids?: string[];
    value_html?: string;
    blanks?: { index: number; html: string }[];
    /** Ordering: the item ids in the correct sequence. */
    correct_order?: string[];
    /** Matching: the correct pairing. */
    correct_pairs?: { left_id: string; right_id: string }[];
    /** Multi-part: the answer to each part, in order. */
    part_answers?: { label: string; html: string }[];
    /** Graph: the points that should have been selected. */
    correct_points?: PlotPoint[];
    /** Graph sketch: the target curve, and the plot showing it drawn. */
    target_curve?: AuthoredCurve;
    solution_plot_svg?: string;
  };
  /**
   * `note_html`, not `note`: a step note is prose that can carry inline math,
   * and shipping it raw meant students read `\(2, 5\)` as source. Every other
   * prose field on this response is pre-rendered; this one was the exception.
   */
  explanation?: { steps: { math_html: string | null; note_html: string }[] };
  /**
   * Why each wrong choice was tempting, authored alongside the problem. Sent
   * only once an attempt is on record — same disclosure rule as `explanation`.
   */
  choice_notes?: { choice_id: string; html: string }[];
  /** What the student originally submitted. Only sent back by "recall". */
  submitted?: unknown;
  /**
   * The second attempt, when one exists. The verdict above always describes the
   * first attempt — that is what scores the set — so review can say "not quite,
   * but you got it on the retry" without contradicting the nav dot.
   */
  retry?: { correct: boolean; submitted?: unknown } | null;
  /** Whether this problem is still eligible for a retry. */
  can_retry?: boolean;
  /**
   * The attempt was stored and nothing is being said about it — a quiz answer.
   * The verdict arrives when the quiz is handed in.
   */
  recorded?: boolean;
};

export type ProblemAnswerRecord = {
  correct_choice_id?: string;
  correct_choice_ids?: string[];
  answer?: OpenAnswer;
  blanks?: { index: number; answer: OpenAnswer }[];
  correct_order?: string[];
  correct_pairs?: { left_id: string; right_id: string }[];
  parts?: { label: string; answer: OpenAnswer }[];
  correct_points?: PlotPoint[];
  target_curve?: AuthoredCurve;
  distractor_rationales?: { choice_id: string; misconception: string }[];
};

export type ProblemContentRecord = {
  format: ProblemFormat;
  statement_latex: string;
  hint: string | null;
  choices?: { id: string; latex: string }[];
  blanks_count?: number;
  items?: { id: string; latex: string }[];
  left?: { id: string; latex: string }[];
  right?: { id: string; latex: string }[];
  parts?: { label: string; prompt_latex: string }[];
  plot?: AuthoredPlot;
  response_kind?: GraphResponseKind;
  sketch_kind?: string;
};

export type ProblemExplanationRecord = {
  steps: ExplanationStep[];
};

/** Split a generated problem into DB columns (content is safe-ish, answer is secret). */
export function splitProblem(p: GeneratedProblem): {
  content: ProblemContentRecord;
  answer: ProblemAnswerRecord;
  explanation: ProblemExplanationRecord;
} {
  const content: ProblemContentRecord = {
    format: p.format,
    statement_latex: p.statement_latex,
    hint: p.hint,
  };
  const answer: ProblemAnswerRecord = {};
  switch (p.format) {
    case "mcq":
      content.choices = p.choices;
      answer.correct_choice_id = p.correct_choice_id;
      answer.distractor_rationales = p.distractor_rationales;
      break;
    case "open":
      answer.answer = p.answer;
      break;
    case "fill_blank":
      content.blanks_count = p.blanks.length;
      answer.blanks = p.blanks;
      break;
    case "multi_select":
      content.choices = p.choices;
      answer.correct_choice_ids = p.correct_choice_ids;
      answer.distractor_rationales = p.distractor_rationales;
      break;
    case "ordering":
      // The scrambled order is public; the sequence that sorts it is the key.
      content.items = p.items;
      answer.correct_order = p.correct_order;
      break;
    case "matching":
      // Both columns have to be shown to be answerable; the pairing is the key.
      content.left = p.left;
      content.right = p.right;
      answer.correct_pairs = p.correct_pairs;
      break;
    case "multi_part":
      // Prompts are public, answers are not — so the parts are split rather
      // than stored whole, unlike every other format's option list.
      content.parts = p.parts.map((part) => ({
        label: part.label,
        prompt_latex: part.prompt_latex,
      }));
      answer.parts = p.parts.map((part) => ({ label: part.label, answer: part.answer }));
      break;
    case "graph":
      // The plot is the question, so it is public. Which points, or which
      // curve, is the key — including for `sketch`, where handing over the
      // target coefficients would draw the answer for the student.
      content.plot = p.plot;
      content.response_kind = p.response_kind;
      if (p.response_kind === "value") answer.answer = p.answer ?? undefined;
      else if (p.response_kind === "points")
        answer.correct_points = p.correct_points ?? undefined;
      else {
        answer.target_curve = p.target_curve ?? undefined;
        // Which family, but not where — the student is told they are drawing a
        // parabola in the statement anyway, and they cannot be given handles
        // without it. The coefficients stay in the key.
        content.sketch_kind = p.target_curve?.kind;
      }
      break;
    default:
      assertNeverFormat(p);
  }
  return { content, answer, explanation: { steps: p.explanation_steps } };
}

/** Stable hash input for dedup: the normalized statement + format. */
export function problemHashInput(p: GeneratedProblem): string {
  return `${p.format}::${p.statement_latex.replace(/\s+/g, " ").trim()}`;
}
