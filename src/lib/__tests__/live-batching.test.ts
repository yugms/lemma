import { describe, expect, it } from "vitest";
import { generateProblems } from "@/lib/ai/generate";
import { solveBatch, verifyProblem } from "@/lib/ai/verify";

/**
 * What a set actually costs in requests, which is the thing the free tier
 * meters. Hits the real Gemini API, so it self-skips without a key:
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run src/lib/__tests__/live-batching.test.ts
 */
describe.skipIf(!process.env.GEMINI_API_KEY)("live request cost", () => {
  it(
    "builds and verifies a six-problem set across four formats",
    async () => {
      const problems = await generateProblems({
        topics: [
          {
            id: "t1",
            title: "Multi-Step Linear Equations",
            description: "Solving linear equations with variables on both sides",
            course_title: "Algebra 1",
            unit_title: "Linear Equations",
          },
        ] as unknown as Parameters<typeof generateProblems>[0]["topics"],
        count: 6,
        difficulty: 2,
        styles: ["drill", "word"],
        formats: ["mcq", "open", "fill_blank", "ordering"],
        avoid: [],
      });

      console.log(
        "AUTHORED",
        problems.length,
        JSON.stringify(problems.map((p) => p.format))
      );
      expect(problems.length).toBeGreaterThan(0);

      const solved = await solveBatch(problems);
      console.log("SOLVED", solved.filter(Boolean).length, "of", problems.length);
      // Every problem must come back claimed; an unclaimed one is a solo
      // re-solve, which is correct but is the cost this change exists to avoid.
      expect(solved.filter(Boolean).length).toBe(problems.length);

      const outcomes = await Promise.all(
        problems.map((p, i) => verifyProblem(p, 2, solved[i]))
      );
      const kept = outcomes.filter((o) => o.ok).length;
      console.log(
        "KEPT",
        kept,
        "of",
        problems.length,
        JSON.stringify(outcomes.filter((o) => !o.ok).map((o) => o.reason))
      );
      expect(kept).toBeGreaterThan(0);
    },
    300_000
  );
});
