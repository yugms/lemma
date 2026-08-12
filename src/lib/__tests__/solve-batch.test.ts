import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { GeneratedProblem } from "@/lib/ai/schemas";

vi.mock("@/lib/ai/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/provider")>();
  return { ...actual, callStructured: vi.fn() };
});

const { callStructured, SOLVES_PER_CALL } = await import("@/lib/ai/provider");
const { solveBatch } = await import("@/lib/ai/verify");

const call = callStructured as unknown as Mock;

/** null for an unsolved slot, so a gap reads differently from a zero. */
const nums = (out: ({ final_answer_numeric?: number | null } | null)[]) =>
  out.map((r) => (r ? (r.final_answer_numeric ?? null) : null));

/** Only the fields the solver path reads. */
const problems = (n: number): GeneratedProblem[] =>
  Array.from(
    { length: n },
    (_, i) =>
      ({
        format: "open",
        style: "drill",
        statement_latex: `problem ${i + 1}`,
        explanation_steps: [],
        answer: { value_latex: String(i + 1), kind: "numeric" },
      }) as unknown as GeneratedProblem
  );

const result = (n: number) => ({
  problem_number: n,
  final_answer_latex: `answer ${n}`,
  final_answer_numeric: n,
  is_well_posed: true,
  difficulty_estimate: 3,
});

beforeEach(() => call.mockReset());

describe("solveBatch", () => {
  it("solves a whole batch in one request", async () => {
    call.mockResolvedValue({ results: [1, 2, 3, 4].map(result) });

    const out = await solveBatch(problems(4));

    expect(call).toHaveBeenCalledTimes(1);
    expect(nums(out)).toEqual([1, 2, 3, 4]);
  });

  // The failure this exists to prevent is the worst one available here: a
  // problem judged against another problem's solution, which agrees or
  // disagrees for reasons that have nothing to do with it.
  it("pairs by the number the model stated, not by array position", async () => {
    call.mockResolvedValue({ results: [result(3), result(1), result(4), result(2)] });

    const out = await solveBatch(problems(4));

    expect(nums(out)).toEqual([1, 2, 3, 4]);
  });

  it("leaves a gap rather than shifting the tail when a result is missing", async () => {
    // Four problems, three results — positional pairing would silently move
    // problem 4's answer onto problem 3.
    call.mockResolvedValue({ results: [result(1), result(2), result(4)] });

    const out = await solveBatch(problems(4));

    expect(nums(out)).toEqual([1, 2, null, 4]);
  });

  it("drops a result claiming a problem that was not in the batch", async () => {
    call.mockResolvedValue({ results: [result(1), result(99), result(0), result(-1)] });

    const out = await solveBatch(problems(3));

    expect(nums(out)).toEqual([1, null, null]);
  });

  it("keeps the first of two results claiming the same problem", async () => {
    call.mockResolvedValue({
      results: [result(1), { ...result(1), final_answer_numeric: 999 }, result(2)],
    });

    const out = await solveBatch(problems(2));

    expect(nums(out)).toEqual([1, 2]);
  });

  it("returns all nulls when the call produces nothing usable", async () => {
    call.mockResolvedValue(null);

    const out = await solveBatch(problems(3));

    // Nulls, not disagreements — the caller re-solves these individually.
    expect(out).toEqual([null, null, null]);
  });

  it("splits into chunks rather than sending one huge context", async () => {
    // Args are optional because `mockReset` invokes the implementation once
    // with none, which would otherwise throw before the test has begun.
    call.mockImplementation(async (args?: { prompt?: string; label?: string }) => {
      const named = [...(args?.prompt ?? "").matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
      // A one-problem chunk goes through the solo path, which has no [n] labels
      // and expects a bare result rather than a batch.
      return (args?.label ?? "").startsWith("solve:batch")
        ? { results: named.map(result) }
        : result(1);
    });

    const n = SOLVES_PER_CALL * 2 + 1;
    const out = await solveBatch(problems(n));

    expect(call).toHaveBeenCalledTimes(Math.ceil(n / SOLVES_PER_CALL));
    expect(out.every((r) => r !== null)).toBe(true);
  });

  it("solves a lone problem on its own, without the batch schema", async () => {
    call.mockResolvedValue({ final_answer_numeric: 1, is_well_posed: true, difficulty_estimate: 3 });

    await solveBatch(problems(1));

    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0].label).toBe("solve:open");
  });

  it("runs its chunks through the caller's pool", async () => {
    // Args are optional because `mockReset` invokes the implementation once
    // with none, which would otherwise throw before the test has begun.
    call.mockImplementation(async (args?: { prompt?: string; label?: string }) => {
      const named = [...(args?.prompt ?? "").matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
      // A one-problem chunk goes through the solo path, which has no [n] labels
      // and expects a bare result rather than a batch.
      return (args?.label ?? "").startsWith("solve:batch")
        ? { results: named.map(result) }
        : result(1);
    });
    let used = 0;
    const pool = <T,>(fn: () => Promise<T>) => {
      used += 1;
      return fn();
    };

    await solveBatch(problems(SOLVES_PER_CALL * 2), pool);

    // Authoring and verification share one concurrency budget; a solve that
    // sidestepped the pool would burst past the whole build's limit.
    expect(used).toBe(2);
  });
});
