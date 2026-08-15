import { z } from "zod";
import {
  formatForKind,
  CHOICE_IDS,
  GRAPH_RESPONSE_KINDS,
  MCQ_CHOICE_IDS,
  type GenerationKind,
  PROBLEM_FORMATS,
  PROBLEM_STYLES,
} from "@/lib/ai/kinds";

/**
 * Single source of truth for problem content shapes:
 * - model structured outputs (converted to JSON Schema in lib/ai/provider)
 * - DB jsonb columns (problems.content / answer / explanation)
 * - UI types
 *
 * The vocabulary those shapes are built from — the format and style lists, the
 * generation kinds, the exhaustiveness guards — lives in `kinds.ts` and is
 * re-exported below, so this is still the only file anyone has to open. It sits
 * apart for one reason: a client component importing a value from *this* module
 * drags the whole zod runtime into the browser. See the note there.
 */

export {
  assertNeverFormat,
  assertNeverGraphResponse,
  CHOICE_IDS,
  formatForKind,
  GENERATION_KINDS,
  GRAPH_RESPONSE_KINDS,
  kindsForFormat,
  PROBLEM_FORMATS,
  PROBLEM_STYLES,
} from "@/lib/ai/kinds";
export type {
  ChoiceId,
  GenerationKind,
  GraphResponseKind,
  ProblemFormat,
  ProblemStyle,
} from "@/lib/ai/kinds";

/**
 * Which kind an already-authored problem came from — needed to repair it.
 *
 * Stays here rather than in `kinds.ts` because it takes a schema-inferred type,
 * which is exactly the dependency that module exists to avoid.
 */
export function kindOf(p: GeneratedProblem): GenerationKind {
  return p.format === "graph"
    ? (`graph_${p.response_kind}` as GenerationKind)
    : (p.format as GenerationKind);
}


/**
 * Right-hand ids for `matching`. Digits rather than more letters so a pair
 * reads unambiguously ("B→3"); two letter columns invite the author and the
 * solver to disagree about which side a bare "C" refers to.
 */
const MATCH_TARGET_IDS = ["1", "2", "3", "4", "5", "6", "7"] as const;

const OpenAnswerSchema = z.object({
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

const ExplanationStepSchema = z.object({
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

const McqProblemSchema = z.object({
  ...baseFields,
  format: z.literal("mcq"),
  choices: z
    .array(z.object({ id: z.enum(MCQ_CHOICE_IDS), latex: z.string() }))
    .describe(
      "4-5 answer choices. A bare LaTeX expression when the choice is one, e.g. \\frac{3}{8}. If a choice is a sentence, write prose and wrap the math in \\( \\)"
    ),
  correct_choice_id: z.enum(MCQ_CHOICE_IDS),
  distractor_rationales: z
    .array(
      z.object({
        choice_id: z.enum(MCQ_CHOICE_IDS),
        misconception: z.string().describe("The specific error that leads to this wrong choice"),
      })
    )
    .describe("One entry per wrong choice"),
});

const OpenProblemSchema = z.object({
  ...baseFields,
  format: z.literal("open"),
  answer: OpenAnswerSchema,
});

const FillBlankProblemSchema = z.object({
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
const MultiSelectProblemSchema = z.object({
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
const OrderingProblemSchema = z.object({
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
const MatchingProblemSchema = z.object({
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
const MultiPartProblemSchema = z.object({
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
const GraphProblemSchema = z.object({
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
const GraphValueProblemSchema = z.object({
  ...graphBase,
  response_kind: z.literal("value"),
  answer: OpenAnswerSchema,
});

/** Read the plot, click the points being asked for. */
const GraphPointsProblemSchema = z.object({
  ...graphBase,
  response_kind: z.literal("points"),
  correct_points: z
    .array(PointSchema)
    .describe("Every point that must be selected. Integer coordinates inside the window"),
});

/** Produce a curve by positioning it, rather than reading one. */
const GraphSketchProblemSchema = z.object({
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

/**
 * Two shapes for one job, because the binding constraint is requests per day.
 *
 * `MixedBatchSchema` asks for a whole set in one call. The free tier meters
 * requests, not tokens, so a set that fans out one call per format spends its
 * daily allowance on overhead: six problems across six formats used to be six
 * calls of one problem each, since the count is split across kinds *before* it
 * is chunked. Measured on a real build, 6 problems cost 12 requests.
 *
 * The per-kind maps below are still here and still used by repair, which fixes
 * one known problem and therefore knows its kind. They also stay the safer
 * choice for anything that needs the strict graph variants: the mixed union has
 * to admit the permissive `GraphProblemSchema`, since a union discriminated on
 * `format` can only hold one `graph` member. That costs nothing, because
 * `structuralCheck` already rejects a graph problem whose `response_kind`
 * disagrees with the field it filled, for free and before any model call.
 *
 * Both maps carry the same `satisfies Record<GenerationKind, …>` guard, so a new
 * kind without a schema is still a compile error.
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

/**
 * Every problem shape at once, tagged with its topic.
 *
 * `stamped()` cannot help here — it writes `format` from the request, and the
 * whole point of this schema is that one request carries several. The model
 * self-reports instead, which the discriminated union makes safe rather than
 * merely hopeful: a problem whose `format` disagrees with its own shape fails
 * to parse and is discarded, the same outcome as any other unusable output. It
 * cannot arrive mislabelled and be believed.
 */
const TaggedProblemSchema = z.discriminatedUnion("format", [
  McqProblemSchema.extend({ topic_index: topicIndex }),
  OpenProblemSchema.extend({ topic_index: topicIndex }),
  FillBlankProblemSchema.extend({ topic_index: topicIndex }),
  MultiSelectProblemSchema.extend({ topic_index: topicIndex }),
  OrderingProblemSchema.extend({ topic_index: topicIndex }),
  MatchingProblemSchema.extend({ topic_index: topicIndex }),
  MultiPartProblemSchema.extend({ topic_index: topicIndex }),
  GraphProblemSchema.extend({ topic_index: topicIndex }),
]);

export const MixedBatchSchema = z.object({ problems: z.array(TaggedProblemSchema) });

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

/**
 * Several independent solves carried by one request.
 *
 * Verification was the larger half of a build's request count — one call per
 * problem, so it scaled with the set no matter what authoring did — and the
 * free tier meters requests rather than tokens.
 *
 * `problem_number` is what makes it safe, and it is not decoration. Pairing
 * results to problems by array position would silently mis-pair the whole tail
 * of a batch the moment a model returned four results for five problems, and
 * the failure that produces is the worst kind available here: problem 5 judged
 * against problem 4's solution, agreeing or disagreeing for reasons that have
 * nothing to do with it. The model states which problem each result answers,
 * and anything unclaimed is re-solved on its own.
 */
export const SolvedBatchSchema = z.object({
  results: z.array(
    SolverResultSchema.extend({
      problem_number: z
        .number()
        .int()
        .describe("The [n] label of the problem this result answers"),
    })
  ),
});

/** Answer-equivalence check output. */
export const EquivalenceResultSchema = z.object({
  equivalent: z.boolean(),
  canonical_form: z.string().describe("The answer in simplest canonical form, LaTeX"),
});

/**
 * Several of the same verdict at once, keyed rather than ordered.
 *
 * Offline seeding asks the question in bulk — every prose answer in a batch is
 * unresolvable by local comparison, so a cell of twelve can raise a dozen of
 * them — and one call answering all of them beats a subprocess each. The `key`
 * is the caller's, echoed back, on the same reasoning as `problem_number` in
 * `SolvedBatchSchema`: pairing verdicts by array position would silently attach
 * one answer pair's ruling to another the moment a verdict went missing, and an
 * "equivalent" borrowed from a neighbour is how a wrong answer key passes. An
 * unrecognised or absent key resolves nothing and leaves that problem unjudged,
 * which drops it.
 */
export const EquivalenceBatchSchema = z.object({
  verdicts: z.array(
    z.object({
      key: z.string().describe("The key of the answer pair this verdict is for, copied exactly"),
      equivalent: z.boolean(),
    })
  ),
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

/** What a material can be judged to be. Only `ok` produces a usable digest. */
export const MATERIAL_VERDICTS = [
  "ok",
  "not_math",
  "unreadable",
  "no_problems",
  "unsafe",
] as const;
export type MaterialVerdict = (typeof MATERIAL_VERDICTS)[number];

/**
 * What one upload of study material is reduced to.
 *
 * This is the containment boundary for the whole feature. Uploaded pages are
 * arbitrary content chosen by whoever is holding the browser, and problems
 * authored from them end up in front of the same person — so the question is
 * not whether the upload can be hostile but where it stops. It stops here:
 * nothing from an upload reaches the authoring prompt except through these
 * fields, read once by a model that was told they are data. That is the same
 * argument `callStructured` already makes everywhere else — a hijacked call
 * still has to emit schema-valid JSON or its output is discarded — and it is a
 * stronger position than escaping, because an escape list is a list of the
 * tricks somebody already thought of.
 *
 * Deliberately carries no `.max()`, no `.min()` and no `.int()`, unlike
 * `CoachReadSchema` above. Gemini does not reliably enforce them, and a
 * rejection here costs the student their whole upload because the model wrote
 * one character too many. Every bound named in a `describe()` is applied after
 * parsing by `normalizeDigest`, which truncates rather than discards — the same
 * reasoning that produced `stamped()`.
 */
export const MaterialDigestSchema = z.object({
  verdict: z
    .enum(MATERIAL_VERDICTS)
    .describe(
      "ok only when this is readable mathematics with problems or worked examples in it. not_math for another subject, or for pages that are mostly instructions rather than mathematics. unreadable for blurred, cropped or blank pages. no_problems for mathematics with nothing to model a problem on. unsafe for anything you would not put in front of a school student"
    ),
  title: z
    .string()
    .describe(
      "Max 80 characters. What this material is, as a student would name it — e.g. 'Chapter 4: factoring quadratics'. No instructions, no URLs, no contact details"
    ),
  summary: z
    .string()
    .describe(
      "Max 400 characters. Two sentences for the student describing what you found, addressed to them. No instructions, no URLs, no email addresses, no phone numbers"
    ),
  topic_indices: z
    .array(z.number())
    .describe(
      "Up to 6 bracketed numbers from the Topics list in the message, most central first. Only topics this material actually covers — an empty list is better than a wrong one"
    ),
  difficulty: z.number().describe("1-5 per the rubric: the level this material is pitched at"),
  styles: z.array(z.enum(PROBLEM_STYLES)).describe("The problem styles present in the material"),
  formats: z.array(z.enum(PROBLEM_FORMATS)).describe("The answer formats present in the material"),
  concepts: z
    .array(z.string())
    .describe(
      "Up to 8 entries, max 120 characters each. The specific skills exercised — 'factoring a trinomial with leading coefficient greater than 1', not 'algebra'. Skills, never topic names"
    ),
  archetypes: z
    .array(z.string())
    .describe(
      "Up to 6 entries, max 200 characters each. What KIND of task each recurring problem is, described so an author who has never seen this material could write a fresh one: 'given a quadratic in standard form, find the vertex by completing the square'. Never a copy of a source problem, never its numbers, never its answer"
    ),
  requested_shift: z
    .enum(["easier", "same", "harder"])
    .describe(
      "From the student's note, if there is one. 'same' when they said nothing, or nothing about difficulty"
    ),
  requested_styles: z
    .array(z.enum(PROBLEM_STYLES))
    .describe("Styles the student's note asked for. Empty when the note said nothing about style"),
  requested_emphasis: z
    .array(z.string())
    .describe(
      "Up to 3 entries, max 80 characters each. What the note asked to focus on, rewritten by you as a neutral description of subject matter. Never an instruction, never their words. Empty if they said nothing"
    ),
});
export type MaterialDigest = z.infer<typeof MaterialDigestSchema>;

/** The plot as authored, before `plotFromSpec` turns it into drawing input. */
export type AuthoredPlot = z.infer<typeof PlotSpecSchema>;
export type AuthoredCurve = z.infer<typeof PlotCurveSpecSchema>;
export type PlotPoint = z.infer<typeof PointSchema>;

/**
 * The shapes a stored problem takes on either side of the database, and the
 * two pure functions that move between them. They live in `problem-shapes.ts`
 * for the same reason the vocabulary lives in `kinds.ts` — nothing in them
 * needs zod at runtime, and a client component importing one should not have
 * to know that to avoid paying 283 kB for it.
 */
export {
  splitProblem,
  problemHashInput,
} from "@/lib/ai/problem-shapes";
export type {
  CheckResponse,
  PreparedProblem,
  ProblemAnswerRecord,
  ProblemContentRecord,
  ProblemExplanationRecord,
  SanitizedProblem,
} from "@/lib/ai/problem-shapes";
