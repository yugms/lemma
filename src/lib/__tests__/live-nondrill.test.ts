import { describe, expect, it } from "vitest";
import { callStructured, GENERATOR_MODELS } from "../ai/provider";
import { batchSchemaFor, type GeneratedProblem } from "../ai/schemas";
import { GENERATOR_SYSTEM_PROMPT } from "../ai/prompts";
import { verifyProblem } from "../ai/verify";

/**
 * The production failure, end to end: a set in any style but drill came back
 * empty behind "no problems passed verification". Drill hid it, being served
 * by templates that author nothing.
 *
 * Hits the real Gemini API, so it self-skips without a key. Run it with:
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run src/lib/__tests__/live-nondrill.test.ts
 */
describe.skipIf(!process.env.GEMINI_API_KEY)("live non-drill build", () => {
  /**
   * Built by hand rather than authored, because the regression needs an answer
   * that is a sentence and the generator will not reliably write one — asked
   * for `proof` problems it tends to find a numeric hook, which passes through
   * the old numeric path and proves nothing. This is the shape that could never
   * verify: `kind: "text"`, where no amount of normalisation makes the solver's
   * wording equal the author's.
   */
  const proseProof = (): GeneratedProblem =>
    ({
      format: "open",
      style: "proof",
      difficulty: 3,
      topic_index: 0,
      statement_latex:
        "Let \\(n\\) and \\(m\\) be even integers. Show that \\(n + m\\) is also even.",
      answer: {
        value_latex: "n+m=2(k+j)\\text{, so the sum is even}",
        kind: "text",
        numeric_value: null,
        tolerance: null,
        acceptable_forms: [],
        multi_valued: false,
      },
      explanation_steps: [
        { latex: "n=2k,\\ m=2j", note: "Write each even integer as twice an integer." },
        { latex: "n+m=2k+2j=2(k+j)", note: "Add and factor out the 2." },
        { latex: "2(k+j)", note: "Twice an integer, so the sum is even." },
      ],
    }) as unknown as GeneratedProblem;

  it(
    "verifies a proof whose answer is a sentence",
    async () => {
      const outcome = await verifyProblem(proseProof(), 3);

      // Before the fix this was rejected 100% of the time — "uncertain" from
      // the local compare was resolved to disagreement, on the first pass and
      // again on the repair re-check, which is what emptied the set.
      expect(outcome.ok, `rejected: ${outcome.reason}`).toBe(true);
    },
    120_000
  );

  it(
    "authors and verifies a word problem against the live chain",
    async () => {
      const batch = await callStructured({
        models: GENERATOR_MODELS,
        label: "author:open:word",
        system: GENERATOR_SYSTEM_PROMPT,
        prompt: `Author 2 new problems.

Topics (distribute problems across these):
- Algebra 1 / Linear equations / Setting up equations from a scenario

Requirements:
- Format: open — a free-response answer the student types
- Difficulty: 2 (per the rubric)
- Allowed styles: word (distribute across them)`,
        schema: batchSchemaFor("open"),
        maxOutputTokens: 30000,
        thinking: "medium",
      });

      expect(batch, "nothing was authored").not.toBeNull();
      expect(batch!.problems.length).toBeGreaterThan(0);

      const outcomes = await Promise.all(batch!.problems.map((p) => verifyProblem(p, 2)));
      for (const [i, o] of outcomes.entries()) {
        const p = batch!.problems[i];
        const kind = p.format === "open" ? p.answer.kind : p.format;
        console.log(`word[${i}] ok=${o.ok} kind=${kind}`, o.ok ? "" : `reason=${o.reason}`);
      }

      expect(
        outcomes.some((o) => o.ok),
        `all rejected: ${outcomes.map((o) => o.reason).join(" | ")}`
      ).toBe(true);
    },
    300_000
  );
});
