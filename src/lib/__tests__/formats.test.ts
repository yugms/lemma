import { describe, expect, it } from "vitest";
import {
  PROBLEM_FORMATS,
  splitProblem,
  type GeneratedProblem,
  type ProblemFormat,
} from "../ai/schemas";
import { checkSubmission } from "../ai/check-answer";
import { structuralCheck } from "../ai/verify";
import { prepareProblem } from "../math-render";
import { retryEligible, shouldDisclose } from "../attempt-state";

/**
 * The per-format round trip: author -> split into DB columns -> grade a
 * submission -> render for the browser.
 *
 * None of this had a test. Every one of these paths was an if/else-if chain
 * with no terminal branch, so a new format fell through to whatever the last
 * arm assumed — an unanswerable problem out of `splitProblem`, a permanently
 * disabled Check button, and a TypeError inside `checkSubmission` that surfaced
 * as a 500 on every submission. Each format now has to prove it survives the
 * whole trip, and the loop below is keyed off `PROBLEM_FORMATS`, so a format
 * added without a fixture fails here rather than in production.
 */

const steps = [{ latex: "x = 3", note: "Solve." }];

const FIXTURES: Record<ProblemFormat, { problem: GeneratedProblem; right: unknown; wrong: unknown }> = {
  mcq: {
    problem: {
      format: "mcq",
      style: "drill",
      difficulty: 2,
      statement_latex: "Solve \\(x + 1 = 4\\).",
      hint: null,
      explanation_steps: steps,
      choices: [
        { id: "A", latex: "3" },
        { id: "B", latex: "4" },
        { id: "C", latex: "5" },
      ],
      correct_choice_id: "A",
      distractor_rationales: [
        { choice_id: "B", misconception: "Added instead of subtracting." },
        { choice_id: "C", misconception: "Off by two." },
      ],
    },
    right: "A",
    wrong: "B",
  },

  open: {
    problem: {
      format: "open",
      style: "drill",
      difficulty: 2,
      statement_latex: "Solve \\(x + 1 = 4\\).",
      hint: null,
      explanation_steps: steps,
      answer: {
        value_latex: "3",
        kind: "numeric",
        numeric_value: 3,
        tolerance: null,
        acceptable_forms: [],
        multi_valued: false,
      },
    },
    right: "3",
    wrong: "7",
  },

  fill_blank: {
    problem: {
      format: "fill_blank",
      style: "drill",
      difficulty: 2,
      statement_latex: "\\(2 + 2 = \\){{1}}",
      hint: null,
      explanation_steps: steps,
      blanks: [
        {
          index: 1,
          answer: {
            value_latex: "4",
            kind: "numeric",
            numeric_value: 4,
            tolerance: null,
            acceptable_forms: [],
            multi_valued: false,
          },
        },
      ],
    },
    right: { "1": "4" },
    wrong: { "1": "5" },
  },

  multi_select: {
    problem: {
      format: "multi_select",
      style: "conceptual",
      difficulty: 3,
      statement_latex: "Which of these are even?",
      hint: null,
      explanation_steps: steps,
      choices: [
        { id: "A", latex: "2" },
        { id: "B", latex: "3" },
        { id: "C", latex: "4" },
        { id: "D", latex: "5" },
      ],
      correct_choice_ids: ["A", "C"],
      distractor_rationales: [
        { choice_id: "B", misconception: "Confused prime with even." },
        { choice_id: "D", misconception: "Confused odd with even." },
      ],
    },
    right: ["A", "C"],
    // A strict subset must be wrong: that is the whole point of the format.
    wrong: ["A"],
  },

  ordering: {
    problem: {
      format: "ordering",
      style: "drill",
      difficulty: 2,
      statement_latex: "Put the steps in order.",
      hint: null,
      explanation_steps: steps,
      items: [
        { id: "B", latex: "\\(x = 3\\)" },
        { id: "A", latex: "\\(3x = 9\\)" },
        { id: "C", latex: "check the answer" },
      ],
      correct_order: ["A", "B", "C"],
    },
    right: ["A", "B", "C"],
    wrong: ["B", "A", "C"],
  },
};

describe("every format survives the round trip", () => {
  it("has a fixture for each declared format", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual([...PROBLEM_FORMATS].sort());
  });

  for (const format of PROBLEM_FORMATS) {
    describe(format, () => {
      const { problem, right, wrong } = FIXTURES[format];

      it("passes its own structural check", () => {
        const check = structuralCheck(problem);
        expect(check.ok, check.reason).toBe(true);
      });

      it("splits without leaking the answer key into content", () => {
        const { content, answer, explanation } = splitProblem(problem);
        expect(content.format).toBe(format);
        expect(content.statement_latex).toBe(problem.statement_latex);
        expect(explanation.steps).toEqual(problem.explanation_steps);

        // `content` is the only half the client is ever handed, so nothing that
        // decides correctness may appear in it.
        const serialized = JSON.stringify(content);
        for (const secret of [
          "correct_choice_id",
          "correct_choice_ids",
          "correct_order",
          "distractor_rationales",
        ]) {
          expect(serialized.includes(secret), `${secret} leaked into content`).toBe(false);
        }
        // And the answer half has to actually carry something, or the problem
        // is unanswerable for the rest of its life in the pool.
        expect(Object.keys(answer).length, "answer record is empty").toBeGreaterThan(0);
      });

      it("grades a right and a wrong submission", async () => {
        const { content, answer } = splitProblem(problem);
        await expect(checkSubmission(content, answer, right)).resolves.toMatchObject({
          correct: true,
        });
        await expect(checkSubmission(content, answer, wrong)).resolves.toMatchObject({
          correct: false,
        });
      });

      it("grades an empty submission as wrong rather than throwing", async () => {
        const { content, answer } = splitProblem(problem);
        await expect(checkSubmission(content, answer, undefined)).resolves.toMatchObject({
          correct: false,
        });
      });

      it("pre-renders every displayed string to HTML", () => {
        const { content } = splitProblem(problem);
        const prepared = prepareProblem({
          id: "p1",
          position: 1,
          style: problem.style,
          format,
          difficulty: problem.difficulty,
          statement_latex: content.statement_latex,
          hint: content.hint,
          choices: content.choices,
          blanks_count: content.blanks_count,
          items: content.items,
        });
        expect(prepared.statement_html.length).toBeGreaterThan(0);
        // Whatever the client needs to display has to arrive as HTML — it
        // cannot run KaTeX itself.
        if (content.choices) {
          expect(prepared.choices?.length).toBe(content.choices.length);
          for (const c of prepared.choices ?? []) expect(c.html.length).toBeGreaterThan(0);
        }
        if (content.items) {
          expect(prepared.items?.length).toBe(content.items.length);
          for (const i of prepared.items ?? []) expect(i.html.length).toBeGreaterThan(0);
        }
      });
    });
  }
});

describe("retry eligibility and disclosure", () => {
  const wrong = { is_correct: false };
  const right = { is_correct: true };
  const revealed = { is_correct: null };
  const SET = "11111111-1111-1111-1111-111111111111";

  it("offers a retry only after a genuinely wrong first answer", () => {
    expect(retryEligible(SET, wrong, null)).toBe(true);
    expect(retryEligible(SET, right, null)).toBe(false);
    // A reveal is a give-up, not a miss to come back from.
    expect(retryEligible(SET, revealed, null)).toBe(false);
    expect(retryEligible(SET, null, null)).toBe(false);
  });

  it("offers it once", () => {
    expect(retryEligible(SET, wrong, wrong)).toBe(false);
    expect(retryEligible(SET, wrong, right)).toBe(false);
  });

  it("requires a set, since that is what the one-per-attempt index keys on", () => {
    expect(retryEligible(null, wrong, null)).toBe(false);
  });

  it("never discloses the answer key while a retry is live", () => {
    // The invariant the whole feature rests on: a response may carry the key or
    // offer a second attempt, never both. Handing over the answer and then
    // saying "try again" makes the retry a copying exercise.
    for (const [setId, first, retry] of [
      [SET, wrong, null],
      [SET, right, null],
      [SET, revealed, null],
      [SET, wrong, right],
      [null, wrong, null],
    ] as const) {
      const eligible = retryEligible(setId, first, retry);
      expect(shouldDisclose(eligible)).toBe(!eligible);
    }
  });
});

describe("structural check rejects broken problems", () => {
  it("rejects a select-all where every option is correct", () => {
    const p = structuredClone(FIXTURES.multi_select.problem) as GeneratedProblem & {
      correct_choice_ids: string[];
    };
    p.correct_choice_ids = ["A", "B", "C", "D"];
    expect(structuralCheck(p).ok).toBe(false);
  });

  it("rejects a select-all with nothing correct", () => {
    const p = structuredClone(FIXTURES.multi_select.problem) as GeneratedProblem & {
      correct_choice_ids: string[];
    };
    p.correct_choice_ids = [];
    expect(structuralCheck(p).ok).toBe(false);
  });

  it("rejects an ordering already listed in the right order", () => {
    const p = structuredClone(FIXTURES.ordering.problem) as GeneratedProblem & {
      correct_order: string[];
      items: { id: string }[];
    };
    p.correct_order = p.items.map((i) => i.id);
    expect(structuralCheck(p).ok).toBe(false);
  });

  it("rejects an ordering whose answer isn't a permutation of the steps", () => {
    const p = structuredClone(FIXTURES.ordering.problem) as GeneratedProblem & {
      correct_order: string[];
    };
    p.correct_order = ["A", "B"];
    expect(structuralCheck(p).ok).toBe(false);
  });
});
