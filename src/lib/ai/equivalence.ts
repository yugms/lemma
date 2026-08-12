import { callStructured, CHECKER_MODELS } from "@/lib/ai/provider";
import { EQUIVALENCE_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { EquivalenceResultSchema } from "@/lib/ai/schemas";

/**
 * Resolves the one verdict local comparison cannot reach: two answers written
 * differently that might still mean the same thing.
 *
 * Both ladders need it. Grading has always escalated an "uncertain" submission
 * here; verification needs it for the same reason and did not have it, which
 * is why it discarded every prose-answered problem it ever authored — a solver
 * asked to justify a claim will not phrase its conclusion character for
 * character the way the author did, and `checkOpenAnswer` reports exactly that
 * as "uncertain".
 *
 * It lives in its own module so verification can share the implementation
 * without importing the whole grading path, which pulls in plot geometry and
 * every answer-record shape it does not need.
 */
export type EquivalenceCheck = (
  student: string,
  reference: string,
  acceptableForms?: string[]
) => Promise<boolean>;

export const askModelIfEquivalent: EquivalenceCheck = async (
  student,
  reference,
  acceptableForms = []
) => {
  const result = await callStructured({
    models: CHECKER_MODELS,
    label: "equivalence",
    system: EQUIVALENCE_SYSTEM_PROMPT,
    prompt: `Reference answer (LaTeX): ${reference}${
      acceptableForms.length ? `\nAlso acceptable: ${acceptableForms.join(" ; ")}` : ""
    }\nStudent's answer: ${student}`,
    schema: EquivalenceResultSchema,
    maxOutputTokens: 2000,
  });
  return result?.equivalent ?? false;
};

/** Stands in for the model call when the caller has no budget left for one. */
export const notEquivalentWithoutAsking: EquivalenceCheck = async () => false;
