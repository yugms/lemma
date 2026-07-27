import { describe, expect, it } from "vitest";
import { callStructured, CHECKER_MODELS, GENERATOR_MODELS } from "../ai/provider";
import { batchSchemaFor, SolverResultSchema } from "../ai/schemas";
import { SOLVER_SYSTEM_PROMPT } from "../ai/prompts";
import { structuralCheck } from "../ai/verify";

/**
 * Hits the real Gemini API, so it self-skips without a key. Run it with:
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run src/lib/__tests__/live-provider.test.ts
 */
describe.skipIf(!process.env.GEMINI_API_KEY)("live provider", () => {
  it("solves a problem with the checker model", async () => {
    const result = await callStructured({
      models: CHECKER_MODELS,
      system: SOLVER_SYSTEM_PROMPT,
      prompt: "Solve for \\(x\\): \\(3x + 7 = 22\\).",
      schema: SolverResultSchema,
      maxOutputTokens: 4000,
    });
    console.log("CHECKER:", JSON.stringify(result, null, 1));
    expect(result).not.toBeNull();
    expect(result!.final_answer_numeric).toBe(5);
  }, 120_000);

  it("authors a verifiable mcq batch with the generator model", async () => {
    const batch = await callStructured({
      models: GENERATOR_MODELS,
      system: (await import("../ai/prompts")).GENERATOR_SYSTEM_PROMPT,
      prompt: `Author 2 new problems.

Topics (distribute problems across these):
- Algebra 2 / Quadratics / Solving quadratic equations: factoring and the quadratic formula

Requirements:
- Format: mcq — multiple choice: 4-5 choices, exactly one correct, every distractor traceable to a specific misconception
- Difficulty: 3 (per the rubric)
- Allowed styles: drill (distribute across them)`,
      schema: batchSchemaFor("mcq"),
      maxOutputTokens: 30000,
      thinking: "medium",
    });
    console.log("GENERATOR:", JSON.stringify(batch, null, 1));
    expect(batch).not.toBeNull();
    expect(batch!.problems.length).toBeGreaterThan(0);
    for (const p of batch!.problems) {
      const check = structuralCheck(p);
      expect(check.ok, `structural: ${check.reason}`).toBe(true);
    }
  }, 180_000);
});
