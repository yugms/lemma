import { z } from "zod";
import { callStructured, CHECKER_MODELS, type ImagePart } from "@/lib/ai/provider";
import { SCAN_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import type { ProblemAnswerRecord, ProblemContentRecord } from "@/lib/ai/schemas";

/**
 * Grade photographed handwritten work.
 *
 * The model does two separable jobs here and the schema keeps them apart:
 * *reading* what the student wrote, and *judging* whether it is right. They
 * fail differently — a smudged 7 read as a 1 is not the same event as a wrong
 * method — and only the reading is uncertain enough to need confirming. That is
 * what `confidence` scores: how sure the model is it transcribed correctly, not
 * how sure it is of the mathematics.
 */

export const SCAN_CONFIDENCE_THRESHOLD = 0.8;

const ScanMarkSchema = z.object({
  problem_number: z
    .number()
    .int()
    .describe("The 1-based position of the problem in the set, as numbered on the page"),
  found: z.boolean().describe("False when no work for this problem appears on the pages"),
  read_answer: z
    .string()
    .describe("Exactly what the student wrote as their final answer, transcribed verbatim"),
  correct: z.boolean(),
  confidence: z
    .number()
    .describe(
      "0 to 1: how sure you are that you TRANSCRIBED the handwriting correctly. Not how sure you are of the maths. Use below 0.8 for anything smudged, ambiguous, crossed out, or cut off"
    ),
  note: z
    .string()
    .describe("One sentence for the student on what went wrong, or what was done well"),
});

const ScanResultSchema = z.object({
  marks: z.array(ScanMarkSchema),
  page_note: z
    .string()
    .nullable()
    .describe("A problem with the photos themselves — blurry, cropped, upside down — or null"),
});

export type ScanMark = z.infer<typeof ScanMarkSchema>;
export type ScanResult = z.infer<typeof ScanResultSchema>;

/**
 * Re-exported so this stays the module to reach for when working on scanning.
 * It is *defined* in a zod-free file because the results view needs it in the
 * browser — see the note there.
 */
export { wasAttempted } from "@/lib/scan-marks";

export type ScanProblem = {
  id: string;
  position: number;
  content: ProblemContentRecord;
  answer: ProblemAnswerRecord;
};

/** The answer key, flattened to one line per problem for the prompt. */
function describeAnswer(p: ScanProblem): string {
  const a = p.answer;
  if (a.correct_choice_id) return `choice ${a.correct_choice_id}`;
  if (a.correct_choice_ids) return `choices ${a.correct_choice_ids.join(", ")}`;
  if (a.correct_order) return `order ${a.correct_order.join(" -> ")}`;
  if (a.correct_pairs)
    return `pairs ${a.correct_pairs.map((c) => `${c.left_id}->${c.right_id}`).join(", ")}`;
  if (a.parts) return a.parts.map((part) => `(${part.label}) ${part.answer.value_latex}`).join("; ");
  if (a.blanks) return a.blanks.map((b) => `{{${b.index}}} = ${b.answer.value_latex}`).join(", ");
  if (a.correct_points) return `points ${a.correct_points.map((pt) => `(${pt.x},${pt.y})`).join(", ")}`;
  if (a.target_curve) return `curve ${a.target_curve.kind}(${a.target_curve.coeffs.join(", ")})`;
  if (a.answer) return a.answer.value_latex;
  return "(unrecorded)";
}

/**
 * Read the pages and mark them. Returns null on an unusable response — the
 * caller treats that as "grading failed", never as "everything was wrong".
 */
export async function gradeScan(
  problems: ScanProblem[],
  images: ImagePart[]
): Promise<ScanResult | null> {
  const key = problems
    .map(
      (p) =>
        `${p.position}. ${p.content.statement_latex}\n   ACCEPTED ANSWER: ${describeAnswer(p)}`
    )
    .join("\n\n");

  return callStructured({
    models: CHECKER_MODELS,
    label: "scan",
    system: SCAN_SYSTEM_PROMPT,
    prompt: `The pages above are one student's handwritten work on the following ${problems.length} problem${
      problems.length === 1 ? "" : "s"
    }. Mark each one.

${key}

Return exactly one entry per problem, in order, using the problem numbers above. If a problem does not appear on the pages, set found=false rather than guessing.`,
    images,
    schema: ScanResultSchema,
    maxOutputTokens: 8000,
    thinking: "medium",
    // Vision over several pages is slower than a text call, and this is the
    // only chance to grade — a timeout here loses the upload.
    budgetMs: 180_000,
  });
}
