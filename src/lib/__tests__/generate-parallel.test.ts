import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// `callStructured` is the only thing standing between this module and the
// network, so stubbing it leaves the real fan-out, dedup and failure handling
// under test.
vi.mock("@/lib/ai/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/provider")>();
  return { ...actual, callStructured: vi.fn() };
});

const { callStructured, createCallPool, PROBLEMS_PER_CALL } = await import("@/lib/ai/provider");
const { generateProblems } = await import("@/lib/ai/generate");

const call = callStructured as unknown as Mock;

/** Counts expressed against the batch ceiling, so retuning it can't quietly void a test. */
const PER_CALL = PROBLEMS_PER_CALL;

const request = (over: Partial<Parameters<typeof generateProblems>[0]> = {}) => ({
  topics: [
    { id: "t1", title: "Linear equations", description: null },
    { id: "t2", title: "Slope", description: null },
  ],
  count: 6,
  difficulty: 3,
  styles: ["drill" as const],
  formats: ["mcq" as const],
  avoid: [] as string[],
  ...over,
});

/** A batch shaped like the generator's output — only the fields the code reads. */
const batchOf = (...statements: string[]) => ({
  problems: statements.map((statement_latex) => ({ statement_latex, topic_index: 0 })),
});

/** Distinct statements, so nothing is dropped by the dedup. */
let serial = 0;
const uniqueBatch = (n: number) =>
  batchOf(...Array.from({ length: n }, () => `problem ${serial++}`));

beforeEach(() => {
  call.mockReset();
  serial = 0;
});

describe("generateProblems fan-out", () => {
  it("splits a format across PROBLEMS_PER_CALL-sized calls", async () => {
    call.mockImplementation(async () => uniqueBatch(PER_CALL));

    const out = await generateProblems(request({ count: PER_CALL * 4, formats: ["mcq"] }));

    expect(call).toHaveBeenCalledTimes(4);
    expect(out).toHaveLength(PER_CALL * 4);
  });

  it("balances the chunks instead of leaving a one-problem remainder", async () => {
    call.mockImplementation(async () => uniqueBatch(1));

    // One over the ceiling splits evenly rather than ceiling-then-1: a call's
    // cost is mostly fixed, so a lone trailing problem costs nearly a full one.
    await generateProblems(request({ count: PER_CALL + 1, formats: ["mcq"] }));

    const asked = call.mock.calls.map((c) => Number(c[0].prompt.match(/Author (\d+)/)?.[1]));
    expect(asked).toHaveLength(2);
    expect(Math.max(...asked) - Math.min(...asked)).toBeLessThanOrEqual(1);
    expect(asked.reduce((a, b) => a + b, 0)).toBe(PER_CALL + 1);
  });

  it("still expands graph into its three kinds, but asks for them in one call", async () => {
    call.mockImplementation(async () => uniqueBatch(3));

    await generateProblems(request({ count: 3, formats: ["graph"] }));

    // The mix is still per-kind — three graph problems must not be three of the
    // same one — but it costs a single request rather than three.
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0].label).toBe("author:graph_value+graph_points+graph_sketch");
    const prompt = call.mock.calls[0][0].prompt as string;
    for (const kind of ["value", "points", "sketch"]) {
      expect(prompt).toContain(`response_kind "${kind}"`);
    }
  });

  // The regression this guards is the one that made the free tier's daily
  // request cap bind: the count was split across kinds *before* it was chunked,
  // so the number of formats set the number of calls and each one authored a
  // single problem. Six problems across every format cost six requests.
  it("does not let the number of formats decide the number of calls", async () => {
    call.mockImplementation(async () => uniqueBatch(6));

    await generateProblems(
      request({
        count: 6,
        formats: ["mcq", "open", "fill_blank", "multi_select", "ordering", "matching"],
      })
    );

    expect(call).toHaveBeenCalledTimes(1);
    const prompt = call.mock.calls[0][0].prompt as string;
    expect(prompt).toMatch(/Author 6 new problems/);
    // Every requested format is still named, with its own count.
    for (const f of ["multiple choice", "open answer", "fill in the blank"]) {
      expect(prompt).toContain(f);
    }
  });

  it("runs the calls concurrently rather than one after another", async () => {
    let active = 0;
    let peak = 0;
    call.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return uniqueBatch(PER_CALL);
    });

    await generateProblems(request({ count: PER_CALL * 4, formats: ["mcq"] }));

    expect(peak).toBeGreaterThan(1);
  });

  it("respects the pool it is given", async () => {
    let active = 0;
    let peak = 0;
    call.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return uniqueBatch(PER_CALL);
    });

    await generateProblems(request({ count: PER_CALL * 5, formats: ["mcq"] }), {
      pool: createCallPool(2),
    });

    expect(peak).toBe(2);
  });

  it("hands each batch to onBatch as it lands", async () => {
    call.mockImplementation(async () => uniqueBatch(PER_CALL));

    const seen: number[] = [];
    const out = await generateProblems(request({ count: PER_CALL * 3, formats: ["mcq"] }), {
      onBatch: (batch) => seen.push(batch.length),
    });

    expect(seen).toEqual([PER_CALL, PER_CALL, PER_CALL]);
    expect(out).toHaveLength(PER_CALL * 3);
  });
});

describe("generateProblems deduplication", () => {
  it("drops a statement a concurrent batch already produced", async () => {
    // Nothing links the batches now that they are written together, so the
    // model landing on the same problem twice has to be caught here.
    call.mockImplementation(async () => batchOf("Solve  2x = 4", "Solve 3x = 9"));

    const out = await generateProblems(request({ count: PER_CALL * 2, formats: ["mcq"] }));

    expect(call).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(2); // four authored, two distinct
  });

  it("ignores whitespace and case when comparing", async () => {
    // Twice the batch ceiling is two calls, which is what makes this a
    // cross-batch comparison rather than a within-batch one.
    call
      .mockImplementationOnce(async () => batchOf("Solve x + 1 = 2"))
      .mockImplementationOnce(async () => batchOf("solve   x + 1 = 2"));

    const out = await generateProblems(request({ count: PER_CALL * 2, formats: ["mcq"] }));
    expect(call).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(1);
  });

  it("drops a statement the set already contains", async () => {
    call.mockImplementation(async () => batchOf("Already in the set"));

    const out = await generateProblems(
      request({ count: PER_CALL, formats: ["mcq"], avoid: ["Already in the set"] })
    );
    expect(out).toHaveLength(0);
  });
});

describe("generateProblems failure handling", () => {
  it("keeps what landed when one call exhausts the model chain", async () => {
    call
      .mockImplementationOnce(async () => uniqueBatch(PER_CALL))
      .mockImplementationOnce(async () => {
        throw new Error("Every model was rate-limited");
      });

    const out = await generateProblems(request({ count: PER_CALL * 2, formats: ["mcq"] }));
    expect(out).toHaveLength(PER_CALL);
  });

  it("throws only when every call failed and nothing was produced", async () => {
    call.mockImplementation(async () => {
      throw new Error("Every model was rate-limited");
    });

    await expect(generateProblems(request({ count: PER_CALL * 2, formats: ["mcq"] }))).rejects.toThrow(
      "Every model was rate-limited"
    );
  });

  it("returns empty rather than throwing when calls merely gave up", async () => {
    // `callStructured` returns null for unusable output; that is a discard, not
    // a capacity failure, and the caller's short-set path handles it.
    call.mockImplementation(async () => null);

    await expect(generateProblems(request({ count: PER_CALL * 2, formats: ["mcq"] }))).resolves.toEqual(
      []
    );
  });
});
