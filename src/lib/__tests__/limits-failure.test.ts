import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the caps do when they cannot count.
 *
 * Separate from `limits.test.ts` because `vi.mock` is hoisted to the whole
 * file, and that file asserts against the real modules.
 *
 * The bug being pinned here shipped and was invisible: every cap read
 * `const { count } = await db…`, discarding the query's `error`. A failed count
 * yields `count === null`, `(null ?? 0) >= cap` is `0 >= cap`, which is false —
 * so a database hiccup did not tighten the caps or degrade them, it removed
 * them entirely, silently, for as long as it lasted. Nothing about the app's
 * behaviour would have looked different until the model bill arrived.
 */

type QueryResult = { count: number | null; error: { message: string } | null };

let result: QueryResult;

/**
 * Stands in for the Supabase query builder, which is chained
 * (`.from().select().eq().gte()`) and only resolves when awaited. Every method
 * returns the same object, and `then` is what makes the chain a thenable.
 */
function fakeQuery(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "select", "eq", "gte", "not", "is", "limit", "order"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (value: QueryResult) => unknown) => Promise.resolve(resolve(result));
  return chain;
}

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => fakeQuery(),
}));

const { aiGradingAllowed, CAP_CHECK_FAILED, scanAllowance } = await import("../limits");

beforeEach(() => {
  result = { count: 0, error: null };
});

describe("a cap that cannot be counted", () => {
  it("refuses the scan rather than waving it through", () => {
    result = { count: null, error: { message: "connection terminated" } };
    return expect(scanAllowance("user-1", false)).resolves.toEqual({
      ok: false,
      message: CAP_CHECK_FAILED,
    });
  });

  it("still allows a scan when the count succeeds and is under the cap", async () => {
    result = { count: 1, error: null };
    await expect(scanAllowance("user-1", false)).resolves.toEqual({ ok: true });
  });

  it("refuses once the count reaches the cap", async () => {
    result = { count: 5, error: null };
    const guest = await scanAllowance("user-1", true);
    expect(guest.ok).toBe(false);
    // Worth naming the way out — a guest at their cap has one, and it is the
    // one thing that turns an abandoned session into a signed-in student.
    expect("message" in guest && guest.message).toContain("Sign in");
  });

  it("keeps grading permissive when its own count fails, unlike the others", async () => {
    // The deliberate exception. Refusing here does not save a model call, it
    // silently switches every student into degraded grading for the rest of
    // the day — they keep the mark and lose the explanation, without being
    // told. Guessing the other way costs one call.
    result = { count: null, error: { message: "connection terminated" } };
    await expect(aiGradingAllowed("user-1", false)).resolves.toBe(true);
  });

  it("still enforces the grading budget when the count works", async () => {
    result = { count: 200, error: null };
    await expect(aiGradingAllowed("user-1", false)).resolves.toBe(false);
  });
});
