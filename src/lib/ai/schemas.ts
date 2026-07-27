import { z } from "zod";

/**
 * Single source of truth for problem content shapes:
 * - model structured outputs (converted to JSON Schema in lib/ai/provider)
 * - DB jsonb columns (problems.content / answer / explanation)
 * - UI types
 */

export const PROBLEM_STYLES = [
  "drill",
  "word",
  "conceptual",
  "proof",
  "error_analysis",
] as const;
export type ProblemStyle = (typeof PROBLEM_STYLES)[number];

export const PROBLEM_FORMATS = ["mcq", "open", "fill_blank"] as const; // graph/matching/multi_part later
export type ProblemFormat = (typeof PROBLEM_FORMATS)[number];

export const OpenAnswerSchema = z.object({
  value_latex: z
    .string()
    .describe("The canonical answer in LaTeX, e.g. \\frac{3}{4} or x=2,\\ x=-5"),
  kind: z.enum(["numeric", "expression", "text"]),
  numeric_value: z
    .number()
    .nullable()
    .describe("Decimal value when the answer is a single number, else null"),
  tolerance: z
    .number()
    .nullable()
    .describe("Absolute tolerance for numeric grading, or null for exact"),
  acceptable_forms: z
    .array(z.string())
    .describe("Other acceptable ways to write the answer, in LaTeX or plain text"),
  multi_valued: z
    .boolean()
    .describe("True when the answer is a list/set (e.g. two roots) graded order-independently"),
});
export type OpenAnswer = z.infer<typeof OpenAnswerSchema>;

export const ExplanationStepSchema = z.object({
  latex: z.string().describe("The math for this step in LaTeX (may be empty for prose-only steps)"),
  note: z.string().describe("Short plain-English explanation of what happened in this step"),
});
export type ExplanationStep = z.infer<typeof ExplanationStepSchema>;

const baseFields = {
  style: z.enum(PROBLEM_STYLES),
  difficulty: z.number().describe("Difficulty 1-5 you actually authored, per the rubric"),
  statement_latex: z
    .string()
    .describe(
      "Problem statement. Prose with inline math wrapped in \\( \\). Display math in \\[ \\]."
    ),
  hint: z.string().nullable().describe("One nudge that doesn't give the answer away, or null"),
  explanation_steps: z
    .array(ExplanationStepSchema)
    .describe("Complete step-by-step solution, 2-8 steps"),
};

export const McqProblemSchema = z.object({
  ...baseFields,
  format: z.literal("mcq"),
  choices: z
    .array(z.object({ id: z.enum(["A", "B", "C", "D", "E"]), latex: z.string() }))
    .describe("4-5 answer choices"),
  correct_choice_id: z.enum(["A", "B", "C", "D", "E"]),
  distractor_rationales: z
    .array(
      z.object({
        choice_id: z.enum(["A", "B", "C", "D", "E"]),
        misconception: z.string().describe("The specific error that leads to this wrong choice"),
      })
    )
    .describe("One entry per wrong choice"),
});

export const OpenProblemSchema = z.object({
  ...baseFields,
  format: z.literal("open"),
  answer: OpenAnswerSchema,
});

export const FillBlankProblemSchema = z.object({
  ...baseFields,
  format: z.literal("fill_blank"),
  // statement_latex contains placeholders {{1}}, {{2}}, ...
  blanks: z
    .array(z.object({ index: z.number(), answer: OpenAnswerSchema }))
    .describe("One entry per {{n}} placeholder in the statement"),
});

export const GeneratedProblemSchema = z.discriminatedUnion("format", [
  McqProblemSchema,
  OpenProblemSchema,
  FillBlankProblemSchema,
]);
export type GeneratedProblem = z.infer<typeof GeneratedProblemSchema>;

export const ProblemBatchSchema = z.object({
  problems: z.array(GeneratedProblemSchema),
});
export type ProblemBatch = z.infer<typeof ProblemBatchSchema>;

/**
 * Generation asks for one format at a time. A discriminated union survives the
 * round-trip through JSON Schema, but a flat single-shape schema is what models
 * follow most reliably — and a per-format request also lets the prompt speak
 * only about the format at hand.
 */
const PROBLEM_SCHEMA_BY_FORMAT = {
  mcq: McqProblemSchema,
  open: OpenProblemSchema,
  fill_blank: FillBlankProblemSchema,
} as const;

// Each per-format schema validates one arm of the union, so widening the
// declared type to the union is sound — TS just can't prove it, because
// ZodType is invariant in its output type.
export function problemSchemaFor(format: ProblemFormat): z.ZodType<GeneratedProblem> {
  return PROBLEM_SCHEMA_BY_FORMAT[format] as unknown as z.ZodType<GeneratedProblem>;
}

/**
 * Generated problems carry the topic they were written for. Without this the
 * pool would attribute problems to topics round-robin, and a mis-tagged problem
 * is served forever to students studying the wrong thing.
 */
const topicIndex = z
  .number()
  .int()
  .describe("0-based index of the topic this problem is for, from the numbered Topics list");

export type TaggedProblem = GeneratedProblem & { topic_index: number };

const BATCH_SCHEMA_BY_FORMAT = {
  mcq: z.object({ problems: z.array(McqProblemSchema.extend({ topic_index: topicIndex })) }),
  open: z.object({ problems: z.array(OpenProblemSchema.extend({ topic_index: topicIndex })) }),
  fill_blank: z.object({
    problems: z.array(FillBlankProblemSchema.extend({ topic_index: topicIndex })),
  }),
} as const;

export function batchSchemaFor(
  format: ProblemFormat
): z.ZodType<{ problems: TaggedProblem[] }> {
  return BATCH_SCHEMA_BY_FORMAT[format] as unknown as z.ZodType<{
    problems: TaggedProblem[];
  }>;
}

const REPAIR_SCHEMA_BY_FORMAT = {
  mcq: z.object({ diagnosis: z.string(), fixed_problem: McqProblemSchema }),
  open: z.object({ diagnosis: z.string(), fixed_problem: OpenProblemSchema }),
  fill_blank: z.object({ diagnosis: z.string(), fixed_problem: FillBlankProblemSchema }),
} as const;

export function repairSchemaFor(
  format: ProblemFormat
): z.ZodType<{ diagnosis: string; fixed_problem: GeneratedProblem }> {
  return REPAIR_SCHEMA_BY_FORMAT[format] as unknown as z.ZodType<{
    diagnosis: string;
    fixed_problem: GeneratedProblem;
  }>;
}

/** Independent solver output for verification. */
export const SolverResultSchema = z.object({
  reasoning_summary: z.string().describe("2-3 sentences on how you solved it"),
  final_answer_latex: z.string().describe("Your final answer in LaTeX"),
  final_answer_numeric: z
    .number()
    .nullable()
    .describe("Decimal value if the answer is a single number, else null"),
  chosen_choice_id: z
    .string()
    .nullable()
    .describe("For multiple choice: the letter you chose, else null"),
  is_well_posed: z
    .boolean()
    .describe("False if the problem is ambiguous, unsolvable, or self-contradictory"),
  issue: z.string().nullable().describe("If not well-posed: what's wrong. Else null"),
  difficulty_estimate: z.number().describe("Your 1-5 difficulty rating per the rubric"),
});
export type SolverResult = z.infer<typeof SolverResultSchema>;

/** Repair pass output. */
export const RepairResultSchema = z.object({
  diagnosis: z.string().describe("Who was right and why, briefly"),
  fixed_problem: GeneratedProblemSchema,
});

/** Answer-equivalence check output. */
export const EquivalenceResultSchema = z.object({
  equivalent: z.boolean(),
  canonical_form: z.string().describe("The answer in simplest canonical form, LaTeX"),
});

/** Wrong-answer feedback output. */
export const FeedbackResultSchema = z.object({
  likely_misconception: z
    .string()
    .describe("The most probable specific error the student made"),
  what_went_wrong_latex: z
    .string()
    .describe("1-3 sentences addressed to the student explaining the error. Inline math in \\( \\)"),
  next_hint: z.string().describe("A concrete pointer for what to try instead"),
});
export type FeedbackResult = z.infer<typeof FeedbackResultSchema>;

// ---------- DB storage shapes ----------

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
  topic_title?: string;
};

export type ProblemAnswerRecord = {
  correct_choice_id?: string;
  answer?: OpenAnswer;
  blanks?: { index: number; answer: OpenAnswer }[];
  distractor_rationales?: { choice_id: string; misconception: string }[];
};

export type ProblemContentRecord = {
  format: ProblemFormat;
  statement_latex: string;
  hint: string | null;
  choices?: { id: string; latex: string }[];
  blanks_count?: number;
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
  if (p.format === "mcq") {
    content.choices = p.choices;
    answer.correct_choice_id = p.correct_choice_id;
    answer.distractor_rationales = p.distractor_rationales;
  } else if (p.format === "open") {
    answer.answer = p.answer;
  } else if (p.format === "fill_blank") {
    content.blanks_count = p.blanks.length;
    answer.blanks = p.blanks;
  }
  return { content, answer, explanation: { steps: p.explanation_steps } };
}

/** Stable hash input for dedup: the normalized statement + format. */
export function problemHashInput(p: GeneratedProblem): string {
  return `${p.format}::${p.statement_latex.replace(/\s+/g, " ").trim()}`;
}
