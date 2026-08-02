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

  matching: {
    problem: {
      format: "matching",
      style: "conceptual",
      difficulty: 3,
      statement_latex: "Match each function to its derivative.",
      hint: null,
      explanation_steps: steps,
      left: [
        { id: "A", latex: "x^2" },
        { id: "B", latex: "\\sin x" },
        { id: "C", latex: "e^x" },
      ],
      // One more right entry than left, so the last pair isn't free.
      right: [
        { id: "1", latex: "2x" },
        { id: "2", latex: "\\cos x" },
        { id: "3", latex: "e^x" },
        { id: "4", latex: "-\\sin x" },
      ],
      correct_pairs: [
        { left_id: "A", right_id: "1" },
        { left_id: "B", right_id: "2" },
        { left_id: "C", right_id: "3" },
      ],
    },
    right: { A: "1", B: "2", C: "3" },
    wrong: { A: "1", B: "4", C: "3" },
  },

  multi_part: {
    problem: {
      format: "multi_part",
      style: "word",
      difficulty: 3,
      statement_latex: "A rectangle has width \\(3\\) and height \\(4\\).",
      hint: null,
      explanation_steps: steps,
      parts: [
        {
          label: "a",
          prompt_latex: "What is its area?",
          answer: {
            value_latex: "12",
            kind: "numeric",
            numeric_value: 12,
            tolerance: null,
            acceptable_forms: [],
            multi_valued: false,
          },
        },
        {
          label: "b",
          prompt_latex: "What is its perimeter?",
          answer: {
            value_latex: "14",
            kind: "numeric",
            numeric_value: 14,
            tolerance: null,
            acceptable_forms: [],
            multi_valued: false,
          },
        },
      ],
    },
    right: { a: "12", b: "14" },
    // One part right, one wrong — grading is all-or-nothing, so this must fail.
    wrong: { a: "12", b: "13" },
  },

  // The `graph` DB format covers three different tasks. This slot holds the
  // point-selection one; GRAPH_KINDS below runs all three through the same
  // round trip, so none of them can be added without a fixture.
  graph: {
    problem: {
      format: "graph",
      style: "conceptual",
      difficulty: 3,
      statement_latex: "Select both \\(x\\)-intercepts of the parabola.",
      hint: null,
      explanation_steps: steps,
      plot: {
        x_min: -5,
        x_max: 5,
        y_min: -5,
        y_max: 5,
        curves: [{ kind: "quadratic", coeffs: [1, 0, -4] }],
        marks: [],
        show_grid: true,
      },
      response_kind: "points",
      correct_points: [
        { x: -2, y: 0 },
        { x: 2, y: 0 },
      ],
    },
    // Order must not matter — the student clicks them in whatever order.
    right: [
      { x: 2, y: 0 },
      { x: -2, y: 0 },
    ],
    wrong: [{ x: 2, y: 0 }],
  },
};

/** The three graph tasks, each of which has to survive the round trip too. */
const GRAPH_KINDS: { name: string; problem: GeneratedProblem; right: unknown; wrong: unknown }[] = [
  {
    name: "graph/points",
    problem: FIXTURES.graph.problem,
    right: FIXTURES.graph.right,
    wrong: FIXTURES.graph.wrong,
  },
  {
    name: "graph/value",
    problem: {
      format: "graph",
      style: "conceptual",
      difficulty: 2,
      statement_latex: "What is the slope of the line shown?",
      hint: null,
      explanation_steps: steps,
      plot: {
        x_min: -5,
        x_max: 5,
        y_min: -5,
        y_max: 5,
        curves: [{ kind: "linear", coeffs: [2, 1] }],
        marks: [],
        show_grid: true,
      },
      response_kind: "value",
      answer: {
        value_latex: "2",
        kind: "numeric",
        numeric_value: 2,
        tolerance: null,
        acceptable_forms: [],
        multi_valued: false,
      },
    },
    right: "2",
    wrong: "5",
  },
  {
    name: "graph/sketch",
    problem: {
      format: "graph",
      style: "drill",
      difficulty: 2,
      statement_latex: "Sketch the line \\(y = 2x + 1\\).",
      hint: null,
      explanation_steps: steps,
      plot: {
        x_min: -5,
        x_max: 5,
        y_min: -5,
        y_max: 5,
        curves: [],
        marks: [],
        show_grid: true,
      },
      response_kind: "sketch",
      target_curve: { kind: "linear", coeffs: [2, 1] },
    },
    right: { kind: "linear", coeffs: [2, 1] },
    wrong: { kind: "linear", coeffs: [2, -1] },
  },
];

describe("every graph response kind survives the round trip", () => {
  for (const { name, problem, right, wrong } of GRAPH_KINDS) {
    describe(name, () => {
      it("passes its own structural check", () => {
        const check = structuralCheck(problem);
        expect(check.ok, check.reason).toBe(true);
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

      it("keeps the answer key out of content", () => {
        const { content } = splitProblem(problem);
        const serialized = JSON.stringify(content);
        for (const secret of ["correct_points", "target_curve", "value_latex"]) {
          expect(serialized.includes(secret), `${secret} leaked into content`).toBe(false);
        }
      });

      it("renders its plot to SVG on the server", () => {
        const { content } = splitProblem(problem);
        const prepared = prepareProblem({
          id: "p1",
          position: 1,
          style: problem.style,
          format: "graph",
          difficulty: problem.difficulty,
          statement_latex: content.statement_latex,
          hint: content.hint,
          plot: content.plot,
          response_kind: content.response_kind,
          sketch_kind: content.sketch_kind,
        });
        // The browser gets markup, never a plotting library or a raw spec.
        expect(prepared.plot_svg?.startsWith("<svg")).toBe(true);
        expect(prepared.plot_window).toBeDefined();
      });
    });
  }
});

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
          "correct_pairs",
          "distractor_rationales",
          // multi_part splits its parts apart: the prompts are public, the
          // per-part OpenAnswer is not, so `value_latex` must not survive.
          "value_latex",
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
          left: content.left,
          right: content.right,
          parts: content.parts,
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
        for (const column of [
          [content.left, prepared.left],
          [content.right, prepared.right],
        ] as const) {
          const [raw, rendered] = column;
          if (!raw) continue;
          expect(rendered?.length).toBe(raw.length);
          for (const entry of rendered ?? []) expect(entry.html.length).toBeGreaterThan(0);
        }
        if (content.parts) {
          expect(prepared.parts?.length).toBe(content.parts.length);
          for (const p of prepared.parts ?? []) expect(p.prompt_html.length).toBeGreaterThan(0);
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

  it("rejects a matching with no unmatched extra", () => {
    // Equal columns hand the final pair over by elimination, so a student who
    // knows n-1 pairings scores n.
    const p = structuredClone(FIXTURES.matching.problem) as GeneratedProblem & {
      right: { id: string }[];
    };
    p.right = p.right.slice(0, 3);
    expect(structuralCheck(p).ok).toBe(false);
  });

  it("rejects a matching that reuses one right item for two pairs", () => {
    const p = structuredClone(FIXTURES.matching.problem) as GeneratedProblem & {
      correct_pairs: { left_id: string; right_id: string }[];
    };
    p.correct_pairs[1].right_id = p.correct_pairs[0].right_id;
    expect(structuralCheck(p).ok).toBe(false);
  });

  it("rejects a matching that leaves a left item unpaired", () => {
    const p = structuredClone(FIXTURES.matching.problem) as GeneratedProblem & {
      correct_pairs: unknown[];
    };
    p.correct_pairs.pop();
    expect(structuralCheck(p).ok).toBe(false);
  });

  it("rejects a multi-part with only one part", () => {
    const p = structuredClone(FIXTURES.multi_part.problem) as GeneratedProblem & {
      parts: unknown[];
    };
    p.parts = p.parts.slice(0, 1);
    expect(structuralCheck(p).ok).toBe(false);
  });

  it("rejects a multi-part with duplicate part labels", () => {
    const p = structuredClone(FIXTURES.multi_part.problem) as GeneratedProblem & {
      parts: { label: string }[];
    };
    p.parts[1].label = p.parts[0].label;
    expect(structuralCheck(p).ok).toBe(false);
  });
});
