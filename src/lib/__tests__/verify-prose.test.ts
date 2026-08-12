import { describe, expect, it, vi } from "vitest";
import { solverAgrees, solverGates } from "@/lib/ai/verify";
import { notEquivalentWithoutAsking } from "@/lib/ai/equivalence";
import type { GeneratedProblem, ProblemStyle, SolverResult } from "@/lib/ai/schemas";

/**
 * The shape that used to be unverifiable: an `open` problem whose answer is
 * prose, which is what `proof`, `conceptual` and `error_analysis` necessarily
 * produce. `checkOpenAnswer` reports `kind: "text"` as "uncertain" unless the
 * two strings match character for character, so nothing here can be settled
 * locally — exactly the case that was being resolved to "disagrees".
 */
const proseProblem = (style: ProblemStyle = "proof") =>
  ({
    format: "open",
    style,
    statement_latex: "Show that the sum of two even integers is even.",
    answer: {
      value_latex: "n+m=2(k+j),\\text{ which is even}",
      kind: "text",
      numeric_value: null,
      tolerance: null,
      acceptable_forms: [],
      multi_valued: false,
    },
    explanation_steps: [],
  }) as unknown as GeneratedProblem;

const solvedAs = (latex: string, over: Partial<SolverResult> = {}) =>
  ({
    final_answer_latex: latex,
    final_answer_numeric: null,
    is_well_posed: true,
    difficulty_estimate: 2,
    ...over,
  }) as unknown as SolverResult;

/** The solver's own wording — correct, and nothing like the author's string. */
const paraphrase = solvedAs("2k+2j=2(k+j)\\text{, so the sum is even}");

describe("solverAgrees on a prose answer", () => {
  it("asks whether two differently-worded answers mean the same thing", async () => {
    const equivalent = vi.fn().mockResolvedValue(true);

    await expect(solverAgrees(proseProblem(), paraphrase, equivalent)).resolves.toBe(true);
    expect(equivalent).toHaveBeenCalledOnce();
  });

  it("still disagrees when the answers genuinely differ", async () => {
    const equivalent = vi.fn().mockResolvedValue(false);

    await expect(solverAgrees(proseProblem(), paraphrase, equivalent)).resolves.toBe(false);
  });

  // The regression itself: with no escalation there is no way for a prose
  // answer to pass, so every proof/conceptual/error_analysis problem was
  // discarded on both the first pass and the repair re-check, and a set of
  // them arrived empty behind "no problems passed verification".
  it("cannot agree at all without the escalation", async () => {
    await expect(
      solverAgrees(proseProblem(), paraphrase, notEquivalentWithoutAsking)
    ).resolves.toBe(false);
  });

  it("degrades to disagreement when the checker chain is exhausted", async () => {
    const equivalent = vi.fn().mockRejectedValue(new Error("Every model was rate-limited"));

    // Discarding one problem is the acceptable outcome; throwing would take the
    // whole set with it.
    await expect(solverAgrees(proseProblem(), paraphrase, equivalent)).resolves.toBe(false);
  });

  it("settles a numeric answer locally rather than paying for a call", async () => {
    const equivalent = vi.fn().mockResolvedValue(true);
    const numeric = {
      ...proseProblem("drill"),
      answer: {
        value_latex: "0.75",
        kind: "numeric",
        numeric_value: 0.75,
        tolerance: null,
        acceptable_forms: [],
        multi_valued: false,
      },
    } as unknown as GeneratedProblem;

    await expect(
      solverAgrees(numeric, solvedAs("\\frac{3}{4}", { final_answer_numeric: 0.75 }), equivalent)
    ).resolves.toBe(true);
    expect(equivalent).not.toHaveBeenCalled();
  });
});

describe("solverGates", () => {
  const agree = () => Promise.resolve(true);

  it("does not fail an error_analysis problem for containing its own error", async () => {
    // The style is defined as "put the flawed work inside the statement"; the
    // solver is told to reject anything self-contradictory. Held to both, the
    // style could never produce a single usable problem.
    const flawed = proseProblem("error_analysis");
    const reason = await solverGates(flawed, solvedAs("the error is in step 3", {
      is_well_posed: false,
      issue: "the third line contradicts the second",
    }), 2, agree);

    expect(reason).toBeNull();
  });

  it("still fails a genuinely broken problem in any other style", async () => {
    const reason = await solverGates(
      proseProblem("proof"),
      solvedAs("cannot be determined", { is_well_posed: false, issue: "unsolvable as stated" }),
      2,
      agree
    );

    expect(reason).toMatch(/not well-posed/);
  });

  it("allows a non-drill style to read harder than it was asked for", async () => {
    // A word/proof problem carries a translation or justification step that the
    // rubric counts as load, so the solver rates it above what was requested.
    const reason = await solverGates(proseProblem("word"), solvedAs("x", {
      difficulty_estimate: 4,
    }), 2, agree);

    expect(reason).toBeNull();
  });

  it("holds drill to the tighter bound", async () => {
    const reason = await solverGates(proseProblem("drill"), solvedAs("x", {
      difficulty_estimate: 4,
    }), 2, agree);

    expect(reason).toMatch(/difficulty off/);
  });
});
