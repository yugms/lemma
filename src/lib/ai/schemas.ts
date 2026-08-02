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

/** Which kind an already-authored problem came from — needed to repair it. */
export function kindOf(p: GeneratedProblem): GenerationKind {
  return p.format === "graph"
    ? (`graph_${p.response_kind}` as GenerationKind)
    : (p.format as GenerationKind);
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

const CHOICE_IDS = ["A", "B", "C", "D", "E", "F"] as const;
export type ChoiceId = (typeof CHOICE_IDS)[number];

/**
 * Right-hand ids for `matching`. Digits rather than more letters so a pair
 * reads unambiguously ("B→3"); two letter columns invite the author and the
 * solver to disagree about which side a bare "C" refers to.
 */
const MATCH_TARGET_IDS = ["1", "2", "3", "4", "5", "6", "7"] as const;
export type MatchTargetId = (typeof MATCH_TARGET_IDS)[number];

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
  note: z
    .string()
    .describe(
      "Short plain-English explanation of what happened in this step. Prose: wrap any inline math in \\( \\)"
    ),
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
    .describe(
      "4-5 answer choices. A bare LaTeX expression when the choice is one, e.g. \\frac{3}{8}. If a choice is a sentence, write prose and wrap the math in \\( \\)"
    ),
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

/**
 * Select-all-that-apply. Strictly more diagnostic than MCQ: a student who holds
 * one misconception among four true statements can still pick the single right
 * answer by elimination, but cannot pick the right *set*.
 */
export const MultiSelectProblemSchema = z.object({
  ...baseFields,
  format: z.literal("multi_select"),
  choices: z
    .array(z.object({ id: z.enum(CHOICE_IDS), latex: z.string() }))
    .describe(
      "4-6 statements, of which more than one may be correct. These are sentences, so write prose and wrap any inline math in \\( \\) — never put a whole sentence in LaTeX"
    ),
  correct_choice_ids: z
    .array(z.enum(CHOICE_IDS))
    .describe("Every correct choice. At least one, and never all of them"),
  distractor_rationales: z
    .array(
      z.object({
        choice_id: z.enum(CHOICE_IDS),
        misconception: z.string().describe("The specific error that makes this one look right"),
      })
    )
    .describe("One entry per incorrect choice"),
});

/**
 * Put the solution steps in order. The only format here that tests method
 * rather than arithmetic — a student can know every individual manipulation and
 * still not know which comes first.
 */
export const OrderingProblemSchema = z.object({
  ...baseFields,
  format: z.literal("ordering"),
  items: z
    .array(z.object({ id: z.enum(CHOICE_IDS), latex: z.string() }))
    .describe(
      "3-6 steps, listed in the scrambled order the student should see. A step that is purely an equation may be bare LaTeX; a step that reads as a sentence must be prose with its math in \\( \\)"
    ),
  correct_order: z
    .array(z.enum(CHOICE_IDS))
    .describe("Every item id, in the correct order. Must not match the listed order"),
});

/**
 * Match each prompt to its counterpart. The unmatched right-hand entries are
 * load-bearing: with an equal number on both sides the last pair is free, so a
 * student who knows n-1 of them scores n.
 */
export const MatchingProblemSchema = z.object({
  ...baseFields,
  format: z.literal("matching"),
  left: z
    .array(z.object({ id: z.enum(CHOICE_IDS), latex: z.string() }))
    .describe(
      "3-5 prompts to match, labelled A, B, C, ... Bare LaTeX for an expression; prose with math in \\( \\) for a phrase"
    ),
  right: z
    .array(z.object({ id: z.enum(MATCH_TARGET_IDS), latex: z.string() }))
    .describe(
      "Candidate matches labelled 1, 2, 3, ... Include 1-2 extras that match nothing. Same convention as the left column"
    ),
  correct_pairs: z
    .array(
      z.object({
        left_id: z.enum(CHOICE_IDS),
        right_id: z.enum(MATCH_TARGET_IDS),
      })
    )
    .describe("Exactly one entry per left item, each naming its correct right id"),
});

/**
 * One problem in several parts, where a later part builds on an earlier one.
 * Graded all-or-nothing, like `fill_blank`: partial credit would make the set
 * score mean something different for this format than for every other.
 */
export const MultiPartProblemSchema = z.object({
  ...baseFields,
  format: z.literal("multi_part"),
  parts: z
    .array(
      z.object({
        label: z.string().describe("Short part label, e.g. 'a', 'b', 'c'"),
        prompt_latex: z
          .string()
          .describe("What this part asks. Prose with inline math in \\( \\)"),
        answer: OpenAnswerSchema,
      })
    )
    .describe("2-4 parts, each answerable on its own once the previous is done"),
});

/* ── Graph ────────────────────────────────────────────────────────── */

export const GRAPH_RESPONSE_KINDS = ["value", "points", "sketch"] as const;
export type GraphResponseKind = (typeof GRAPH_RESPONSE_KINDS)[number];

/** Same guard rail as `assertNeverFormat`, one level down. */
export function assertNeverGraphResponse(x: never): never {
  throw new Error(`Unhandled graph response kind: ${JSON.stringify(x)}`);
}

/**
 * Curves as coefficients rather than a discriminated union of shapes. A union
 * here becomes `anyOf` in JSON Schema, which models follow far less reliably
 * than one flat object — and the arity is checked in `structuralCheck` anyway.
 */
const PlotCurveSpecSchema = z.object({
  kind: z.enum(["linear", "quadratic", "abs", "exp"]),
  coeffs: z
    .array(z.number())
    .describe(
      "linear: [m, b] for y=mx+b. quadratic: [a, b, c] for y=ax^2+bx+c. abs: [a, h, k] for y=a|x-h|+k. exp: [a, base] for y=a*base^x"
    ),
});

const PlotSpecSchema = z.object({
  x_min: z.number(),
  x_max: z.number(),
  y_min: z.number(),
  y_max: z.number(),
  curves: z.array(PlotCurveSpecSchema).describe("Curves to draw. May be empty for a bare grid"),
  marks: z
    .array(z.object({ x: z.number(), y: z.number(), label: z.string().nullable() }))
    .describe("Points to draw on the plot. Never mark the point you are asking for"),
  show_grid: z.boolean(),
});

const PointSchema = z.object({ x: z.number(), y: z.number() });

/**
 * All three graph interactions share one DB format and one stored shape;
 * `response_kind` says which of the three answer fields is the live one, and
 * `structuralCheck` enforces that exactly one is populated. Authoring uses the
 * stricter per-kind schemas below, so a model is only ever shown the one field
 * it is meant to fill.
 */
export const GraphProblemSchema = z.object({
  ...baseFields,
  format: z.literal("graph"),
  plot: PlotSpecSchema,
  response_kind: z.enum(GRAPH_RESPONSE_KINDS),
  answer: OpenAnswerSchema.nullish(),
  correct_points: z.array(PointSchema).nullish(),
  target_curve: PlotCurveSpecSchema.nullish(),
});

const graphBase = {
  ...baseFields,
  format: z.literal("graph"),
  plot: PlotSpecSchema,
};

/** Read the plot, type an answer. Graded by the existing open-answer ladder. */
export const GraphValueProblemSchema = z.object({
  ...graphBase,
  response_kind: z.literal("value"),
  answer: OpenAnswerSchema,
});

/** Read the plot, click the points being asked for. */
export const GraphPointsProblemSchema = z.object({
  ...graphBase,
  response_kind: z.literal("points"),
  correct_points: z
    .array(PointSchema)
    .describe("Every point that must be selected. Integer coordinates inside the window"),
});

/** Produce a curve by positioning it, rather than reading one. */
export const GraphSketchProblemSchema = z.object({
  ...graphBase,
  response_kind: z.literal("sketch"),
  target_curve: PlotCurveSpecSchema.describe(
    "The curve the student must produce. Use kind linear or quadratic or abs — not exp"
  ),
});

export const GeneratedProblemSchema = z.discriminatedUnion("format", [
  McqProblemSchema,
  OpenProblemSchema,
  FillBlankProblemSchema,
  MultiSelectProblemSchema,
  OrderingProblemSchema,
  MatchingProblemSchema,
  MultiPartProblemSchema,
  GraphProblemSchema,
]);
export type GeneratedProblem = z.infer<typeof GeneratedProblemSchema>;
export type GraphProblem = z.infer<typeof GraphProblemSchema>;

export const ProblemBatchSchema = z.object({
  problems: z.array(GeneratedProblemSchema),
});
export type ProblemBatch = z.infer<typeof ProblemBatchSchema>;

/**
 * Generation asks for one format at a time. A discriminated union survives the
 * round-trip through JSON Schema, but a flat single-shape schema is what models
 * follow most reliably — and a per-format request also lets the prompt speak
 * only about the format at hand. The batch and repair maps below hold that
 * per-kind mapping; both carry the same `satisfies Record<GenerationKind, …>`
 * guard, so a new kind without a schema is still a compile error.
 */

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

const BATCH_SCHEMA_BY_KIND = {
  mcq: z.object({ problems: z.array(McqProblemSchema.extend({ topic_index: topicIndex })) }),
  open: z.object({ problems: z.array(OpenProblemSchema.extend({ topic_index: topicIndex })) }),
  fill_blank: z.object({
    problems: z.array(FillBlankProblemSchema.extend({ topic_index: topicIndex })),
  }),
  multi_select: z.object({
    problems: z.array(MultiSelectProblemSchema.extend({ topic_index: topicIndex })),
  }),
  ordering: z.object({
    problems: z.array(OrderingProblemSchema.extend({ topic_index: topicIndex })),
  }),
  matching: z.object({
    problems: z.array(MatchingProblemSchema.extend({ topic_index: topicIndex })),
  }),
  multi_part: z.object({
    problems: z.array(MultiPartProblemSchema.extend({ topic_index: topicIndex })),
  }),
  graph_value: z.object({
    problems: z.array(GraphValueProblemSchema.extend({ topic_index: topicIndex })),
  }),
  graph_points: z.object({
    problems: z.array(GraphPointsProblemSchema.extend({ topic_index: topicIndex })),
  }),
  graph_sketch: z.object({
    problems: z.array(GraphSketchProblemSchema.extend({ topic_index: topicIndex })),
  }),
} as const satisfies Record<GenerationKind, unknown>;

/**
 * Stamp `format` and `response_kind` before validating.
 *
 * Both are properties of the *request*: one kind is asked for per call, so the
 * values are known before the model answers and it has nothing to contribute.
 * Gemini does not enforce `const`, so a model shown "graph_points" as the
 * format writes exactly that into both fields — and an otherwise perfect
 * problem then fails validation and is discarded. Deciding these here rather
 * than trusting them makes that class of loss impossible.
 */
function stamped<T>(kind: GenerationKind, inner: z.ZodType<T>): z.ZodType<T> {
  const format = formatForKind(kind);
  const responseKind = kind.startsWith("graph_") ? kind.slice("graph_".length) : null;

  const fix = (p: unknown) => {
    if (!p || typeof p !== "object") return p;
    const o = p as Record<string, unknown>;
    o.format = format;
    if (responseKind) o.response_kind = responseKind;
    return o;
  };

  return z.preprocess((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const r = raw as Record<string, unknown>;
    if (Array.isArray(r.problems)) r.problems = r.problems.map(fix);
    if (r.fixed_problem) r.fixed_problem = fix(r.fixed_problem);
    return r;
  }, inner) as unknown as z.ZodType<T>;
}

export function batchSchemaFor(
  kind: GenerationKind
): z.ZodType<{ problems: TaggedProblem[] }> {
  return stamped(
    kind,
    BATCH_SCHEMA_BY_KIND[kind] as unknown as z.ZodType<{ problems: TaggedProblem[] }>
  );
}

const REPAIR_SCHEMA_BY_KIND = {
  mcq: z.object({ diagnosis: z.string(), fixed_problem: McqProblemSchema }),
  open: z.object({ diagnosis: z.string(), fixed_problem: OpenProblemSchema }),
  fill_blank: z.object({ diagnosis: z.string(), fixed_problem: FillBlankProblemSchema }),
  multi_select: z.object({ diagnosis: z.string(), fixed_problem: MultiSelectProblemSchema }),
  ordering: z.object({ diagnosis: z.string(), fixed_problem: OrderingProblemSchema }),
  matching: z.object({ diagnosis: z.string(), fixed_problem: MatchingProblemSchema }),
  multi_part: z.object({ diagnosis: z.string(), fixed_problem: MultiPartProblemSchema }),
  graph_value: z.object({ diagnosis: z.string(), fixed_problem: GraphValueProblemSchema }),
  graph_points: z.object({ diagnosis: z.string(), fixed_problem: GraphPointsProblemSchema }),
  graph_sketch: z.object({ diagnosis: z.string(), fixed_problem: GraphSketchProblemSchema }),
} as const satisfies Record<GenerationKind, unknown>;

export function repairSchemaFor(
  kind: GenerationKind
): z.ZodType<{ diagnosis: string; fixed_problem: GeneratedProblem }> {
  return stamped(
    kind,
    REPAIR_SCHEMA_BY_KIND[kind] as unknown as z.ZodType<{
      diagnosis: string;
      fixed_problem: GeneratedProblem;
    }>
  );
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
  chosen_choice_ids: z
    .array(z.string())
    .nullable()
    .describe("For select-all-that-apply: every letter you chose, else null"),
  chosen_order: z
    .array(z.string())
    .nullable()
    .describe("For ordering: the item letters in the order you would put them, else null"),
  chosen_pairs: z
    .array(z.object({ left_id: z.string(), right_id: z.string() }))
    .nullable()
    .describe("For matching: one entry per left item naming the right id you paired it with, else null"),
  part_answers: z
    .array(z.object({ label: z.string(), answer_latex: z.string() }))
    .nullable()
    .describe("For multi-part: your answer to each part, labelled, else null"),
  chosen_points: z
    .array(z.object({ x: z.number(), y: z.number() }))
    .nullable()
    .describe("For graph point-selection: every point you would select, else null"),
  chosen_curve: z
    .object({
      kind: z.enum(["linear", "quadratic", "abs", "exp"]),
      coeffs: z.array(z.number()),
    })
    .nullable()
    .describe(
      "For graph sketching: the curve you would draw, same coefficient convention as the problem, else null"
    ),
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

/**
 * The coach's read on a student's practice history. `generator_directives` are
 * the point: they feed straight into the authoring prompt for a targeted set,
 * which is how a set gets narrower than the builder's controls can express.
 */
export const CoachReadSchema = z.object({
  diagnosis: z
    .string()
    .describe(
      "2-4 sentences addressed to the student about what their misses have in common. Inline math in \\( \\)"
    ),
  focus_areas: z
    .array(
      z.object({
        label: z.string().describe("A specific skill, 2-5 words"),
        why: z.string().describe("One sentence of evidence from their history. Inline math in \\( \\)"),
      })
    )
    .max(3),
  generator_directives: z
    .array(
      z
        .string()
        .describe(
          "One imperative instruction to a problem author, e.g. 'Include problems where a negative must survive distribution'"
        )
    )
    .max(6),
});
export type CoachRead = z.infer<typeof CoachReadSchema>;

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

/** The plot as authored, before `plotFromSpec` turns it into drawing input. */
export type AuthoredPlot = z.infer<typeof PlotSpecSchema>;
export type AuthoredCurve = z.infer<typeof PlotCurveSpecSchema>;
export type PlotPoint = z.infer<typeof PointSchema>;

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
