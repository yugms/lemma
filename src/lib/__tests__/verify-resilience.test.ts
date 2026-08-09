import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TaggedProblem } from "@/lib/ai/schemas";

vi.mock("@/lib/ai/verify", () => ({
  verifyProblem: vi.fn(),
  solveIndependently: vi.fn(),
  solverAgrees: vi.fn(),
}));
vi.mock("@/lib/ai/generate", () => ({ repairProblem: vi.fn(), generateProblems: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn() }));

const { verifyProblem, solveIndependently, solverAgrees } = await import("@/lib/ai/verify");
const { repairProblem } = await import("@/lib/ai/generate");
const { verifyOrRepair } = await import("@/lib/sets");

const verify = verifyProblem as unknown as Mock;
const solve = solveIndependently as unknown as Mock;
const agrees = solverAgrees as unknown as Mock;
const repair = repairProblem as unknown as Mock;

const problem = { statement_latex: "Solve 2x = 4", topic_index: 0 } as unknown as TaggedProblem;
const solver = { final_answer_latex: "2", difficulty_estimate: 3, is_well_posed: true };

/** What `callStructured` throws once every model in a chain is rate-limited. */
const exhausted = () => new Error("Every model was rate-limited, overloaded, or too slow");

beforeEach(() => {
  verify.mockReset();
  solve.mockReset();
  agrees.mockReset();
  repair.mockReset();
});

describe("verifyOrRepair never rejects", () => {
  // The regression this guards: an unhandled rejection here propagates out of
  // `buildProblemSet` and fails the whole request, discarding the pool
  // problems, the templates, and every problem that verified fine alongside
  // this one. On a free tier an exhausted chain is routine, not exceptional.
  it("discards the problem when the checker chain is exhausted", async () => {
    verify.mockRejectedValue(exhausted());

    await expect(verifyOrRepair(problem, 3)).resolves.toBeNull();
  });

  it("discards the problem when the repair call is exhausted", async () => {
    verify.mockResolvedValue({ ok: false, reason: "answer mismatch", solver });
    repair.mockRejectedValue(exhausted());

    await expect(verifyOrRepair(problem, 3)).resolves.toBeNull();
  });

  it("discards the problem when the re-solve is exhausted", async () => {
    verify.mockResolvedValue({ ok: false, reason: "answer mismatch", solver });
    repair.mockResolvedValue(problem);
    solve.mockRejectedValue(exhausted());

    await expect(verifyOrRepair(problem, 3)).resolves.toBeNull();
  });
});

describe("verifyOrRepair outcomes", () => {
  it("passes a verified problem through with its solver evidence", async () => {
    verify.mockResolvedValue({ ok: true, solver });

    const result = await verifyOrRepair(problem, 3);
    expect(result?.problem).toBe(problem);
    expect(result?.verification).toMatchObject({
      status: "verified",
      method: "independent-solve",
      solver_answer: "2",
    });
  });

  it("keeps the original topic when a repair rewrites the problem", async () => {
    // A repair rewrites the statement but has no idea what topic it belongs to,
    // and a mis-attributed problem is served forever to the wrong students.
    const fixed = { statement_latex: "Solve 2x = 6", topic_index: 99 } as unknown as TaggedProblem;
    verify.mockResolvedValue({ ok: false, reason: "answer mismatch", solver });
    repair.mockResolvedValue(fixed);
    solve.mockResolvedValue(solver);
    agrees.mockReturnValue(true);

    const result = await verifyOrRepair({ ...problem, topic_index: 1 } as TaggedProblem, 3);
    expect(result?.problem.topic_index).toBe(1);
    expect(result?.verification).toMatchObject({ status: "repaired" });
  });

  it("discards when there is no solver disagreement to adjudicate", async () => {
    verify.mockResolvedValue({ ok: false, reason: "statement latex fails" });

    await expect(verifyOrRepair(problem, 3)).resolves.toBeNull();
    expect(repair).not.toHaveBeenCalled();
  });

  it("discards when the re-solve still disagrees", async () => {
    verify.mockResolvedValue({ ok: false, reason: "answer mismatch", solver });
    repair.mockResolvedValue(problem);
    solve.mockResolvedValue(solver);
    agrees.mockReturnValue(false);

    await expect(verifyOrRepair(problem, 3)).resolves.toBeNull();
  });
});
