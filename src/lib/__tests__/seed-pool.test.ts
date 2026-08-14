import { describe, expect, it, vi } from "vitest";
import type { SolverResult } from "@/lib/ai/schemas";
import { normalizeAuthored } from "@/tools/seed-pool/authored";
import {
  deferringEquivalence,
  equivalenceKey,
  judgeAll,
  mergeAdjudications,
  pairSolved,
  type Pending,
} from "@/tools/seed-pool/ingest";
import { parseEnumList, selectAll, splitList } from "@/tools/seed-pool/shared";
import type { SeedPlan } from "@/tools/seed-pool/shared";

/**
 * The offline half of `npm run seed`.
 *
 * Everything here is the part of pool seeding that decides what reaches the
 * `problems` table, which is a table the app serves to strangers and one whose
 * answer keys nothing downstream re-checks. The gates themselves are
 * `solverGates` and `structuralCheck`, tested elsewhere; what is tested here is
 * that this tool actually runs them, and that the three ways a problem can fail
 * to be judged — unsolved, unresolved, disagreed with — stay distinguishable.
 */

const plan: SeedPlan = {
  difficulty: 2,
  styles: ["drill"],
  formats: ["mcq"],
  count: 2,
  topics: [
    { id: "topic-a", slug: "a", title: "A" },
    { id: "topic-b", slug: "b", title: "B" },
  ],
};

const mcq = (over: Record<string, unknown> = {}) => ({
  topic_index: 0,
  format: "mcq",
  style: "drill",
  difficulty: 2,
  statement_latex: "Solve \\(x + 1 = 4\\).",
  hint: null,
  explanation_steps: [{ latex: "x = 3", note: "Subtract one from both sides." }],
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
  ...over,
});

const prose = (over: Record<string, unknown> = {}) => ({
  topic_index: 0,
  format: "open",
  style: "conceptual",
  difficulty: 2,
  statement_latex: "Is the sum of two even integers even?",
  hint: null,
  explanation_steps: [{ latex: "", note: "Write each as twice an integer." }],
  answer: {
    value_latex: "even",
    kind: "text",
    numeric_value: null,
    tolerance: null,
    acceptable_forms: [],
    multi_valued: false,
  },
  ...over,
});

const solved = (over: Partial<SolverResult> = {}) =>
  ({
    reasoning_summary: "Subtracted one.",
    final_answer_latex: "3",
    final_answer_numeric: 3,
    chosen_choice_id: "A",
    chosen_choice_ids: null,
    chosen_order: null,
    chosen_pairs: null,
    part_answers: null,
    chosen_points: null,
    chosen_curve: null,
    is_well_posed: true,
    issue: null,
    difficulty_estimate: 2,
    ...over,
  }) as SolverResult;

const numbered = (n: number, over: Partial<SolverResult> = {}) => ({
  ...solved(over),
  problem_number: n,
});

describe("pairSolved", () => {
  it("pairs by the number the solver claimed, not by array position", () => {
    const out = pairSolved([numbered(3), numbered(1)], 3);
    expect(out[0]).not.toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).not.toBeNull();
  });

  it("drops a number outside the batch rather than wrapping it onto a problem", () => {
    expect(pairSolved([numbered(0), numbered(9)], 2)).toEqual([null, null]);
  });

  // The failure this prevents is the whole reason the field exists: two results
  // claiming problem 1 must not shunt the second onto problem 2.
  it("keeps the first claim on a repeated number and drops the rest", () => {
    const out = pairSolved(
      [numbered(1, { final_answer_latex: "first" }), numbered(1, { final_answer_latex: "second" })],
      2
    );
    expect(out[0]?.final_answer_latex).toBe("first");
    expect(out[1]).toBeNull();
  });
});

describe("normalizeAuthored", () => {
  it("keeps a problem that validates and renders", () => {
    const { problems, dropped } = normalizeAuthored({ problems: [mcq()] }, plan);
    expect(dropped).toEqual([]);
    expect(problems).toHaveLength(1);
  });

  it("rejects a file that is not a problems array", () => {
    expect(() => normalizeAuthored({ items: [] }, plan)).toThrow(/problems/);
  });

  // One bad entry must not cost the other eleven their pass — the file is fixed
  // by hand, so the position and the field are the whole value of the report.
  it("drops one malformed problem and names the field, keeping the rest", () => {
    const { problems, dropped } = normalizeAuthored(
      { problems: [mcq(), { ...mcq(), format: "open" }, mcq()] },
      plan
    );
    expect(problems).toHaveLength(2);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].position).toBe(2);
    expect(dropped[0].reason).toMatch(/^schema: answer/);
  });

  it("drops a problem whose LaTeX will not render, naming the segment", () => {
    const { problems, dropped } = normalizeAuthored(
      { problems: [mcq({ statement_latex: "Evaluate \\(\\frac{1}{\\)." })] },
      plan
    );
    expect(problems).toHaveLength(0);
    expect(dropped[0].reason).toMatch(/^structural: statement latex fails/);
  });

  // Clamped, not discarded — the same call `generateProblems` makes. A bogus
  // index is a tagging slip on a problem that may be perfectly good.
  it("clamps a topic_index past the end of the plan's topic list", () => {
    const { problems } = normalizeAuthored({ problems: [mcq({ topic_index: 7 })] }, plan);
    expect(problems[0].topic_index).toBe(1);
  });
});

describe("deferringEquivalence", () => {
  it("records an unanswered pair once and answers no in the meantime", async () => {
    const { check, pending } = deferringEquivalence();
    await expect(check("all reals", "every real number", [])).resolves.toBe(false);
    await expect(check("all reals", "every real number", [])).resolves.toBe(false);
    expect(pending).toHaveLength(1);
    expect(pending[0].equivalent).toBeNull();
  });

  it("uses a verdict already supplied and records nothing", async () => {
    const key = equivalenceKey("all reals", "every real number", []);
    const { check, pending } = deferringEquivalence(new Map([[key, true]]));
    await expect(check("all reals", "every real number", [])).resolves.toBe(true);
    expect(pending).toEqual([]);
  });

  // The key is what carries a verdict across two runs of `ingest`, so it must
  // not depend on the order the author happened to list acceptable forms in.
  it("keys a pair independently of the order of its acceptable forms", () => {
    expect(equivalenceKey("x", "y", ["a", "b"])).toBe(equivalenceKey("x", "y", ["b", "a"]));
  });

  // A verdict is why a problem was accepted; losing it on the run that writes
  // the file again would mean giving it a second time for the same pair.
  it("keeps verdicts already given when writing the file again", () => {
    const settled: Pending = {
      key: "settled",
      problem_number: 1,
      reference: "even",
      acceptable_forms: [],
      answer_given: "the sum is even",
      equivalent: true,
    };
    const fresh: Pending = { ...settled, key: "fresh", problem_number: 2, equivalent: null };

    expect(mergeAdjudications([settled], [fresh])).toEqual([settled, fresh]);
    // ...and does not duplicate one that is already recorded.
    expect(mergeAdjudications([settled], [{ ...settled, equivalent: null }])).toEqual([settled]);
  });
});

describe("judgeAll", () => {
  const defer = () => deferringEquivalence();

  it("accepts a problem the solver agreed with, and records how it was checked", async () => {
    const [judgement] = await judgeAll(
      normalizeAuthored({ problems: [mcq()] }, plan).problems,
      [solved()],
      2,
      defer()
    );
    expect(judgement.status).toBe("accepted");
    expect(judgement).toMatchObject({
      verification: { status: "verified", method: "offline-independent-solve" },
    });
  });

  it("rejects a disagreement and says what the solver got instead", async () => {
    const [judgement] = await judgeAll(
      normalizeAuthored({ problems: [mcq()] }, plan).problems,
      [solved({ chosen_choice_id: "B", final_answer_latex: "4" })],
      2,
      defer()
    );
    expect(judgement).toMatchObject({ status: "rejected" });
    expect(judgement).toHaveProperty("reason", expect.stringMatching(/answer mismatch/));
  });

  // Live, an unclaimed problem falls through to a solo re-solve. Offline there
  // is nothing to fall through to, so it has to be reported rather than judged
  // against a solution that was never written for it.
  it("reports a problem no solution claimed instead of failing it", async () => {
    const [judgement] = await judgeAll(
      normalizeAuthored({ problems: [mcq()] }, plan).problems,
      [null],
      2,
      defer()
    );
    expect(judgement).toMatchObject({ status: "unsolved" });
  });

  /**
   * The distinction the whole deferral exists for. `solverGates` reports "the
   * answers do not match" for both a genuine disagreement and a prose pair
   * nobody has adjudicated yet, and treating the second as the first is the bug
   * that once rejected every prose-answered problem while drill looked fine.
   */
  it("separates a pair awaiting a verdict from a real disagreement", async () => {
    const equivalence = defer();
    const [judgement] = await judgeAll(
      normalizeAuthored({ problems: [prose()] }, plan).problems,
      [solved({ final_answer_latex: "the sum is always even", final_answer_numeric: null })],
      2,
      equivalence
    );
    expect(judgement).toMatchObject({ status: "deferred" });
    expect(equivalence.pending).toHaveLength(1);
    expect(equivalence.pending[0].problem_number).toBe(1);
  });

  it("accepts the same pair once its verdict is supplied", async () => {
    const given = "the sum is always even";
    const known = new Map([[equivalenceKey(given, "even", []), true]]);
    const [judgement] = await judgeAll(
      normalizeAuthored({ problems: [prose()] }, plan).problems,
      [solved({ final_answer_latex: given, final_answer_numeric: null })],
      2,
      deferringEquivalence(known)
    );
    expect(judgement).toMatchObject({ status: "accepted" });
  });
});

describe("selectAll", () => {
  it("keeps reading until a page comes back short", async () => {
    const page = vi
      .fn()
      .mockResolvedValueOnce({ data: [1, 2, 3], error: null })
      .mockResolvedValueOnce({ data: [4], error: null });
    await expect(selectAll<number>(page, 3)).resolves.toEqual([1, 2, 3, 4]);
    expect(page).toHaveBeenCalledTimes(2);
    expect(page).toHaveBeenNthCalledWith(2, 3, 5);
  });

  it("surfaces a read error rather than reporting a short pool", async () => {
    const page = vi.fn().mockResolvedValue({ data: null, error: { message: "nope" } });
    await expect(selectAll<number>(page, 3)).rejects.toThrow("nope");
  });
});

describe("flag parsing", () => {
  it("drops the empties a trailing comma leaves", () => {
    expect(splitList("a, b ,")).toEqual(["a", "b"]);
  });

  it("names the allowed values when one is misspelled", () => {
    expect(() => parseEnumList("mcq,opne", ["mcq", "open"], "formats")).toThrow(/opne/);
  });

  it("collapses a repeated value", () => {
    expect(parseEnumList("mcq,mcq,open", ["mcq", "open"], "formats")).toEqual(["mcq", "open"]);
  });
});
