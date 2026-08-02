import { describe, expect, it } from "vitest";
import { outstandingMisses, type MissRow } from "../review";
import { SCORED_MODES } from "../attempt-state";

/**
 * The review queue has to be able to empty.
 *
 * "Practise these 4" builds a fresh set of exactly the queued problems, and
 * the page promises the student they will "find out whether the gap closed".
 * Until this rule existed the queue only ever grew: getting all four right
 * left it saying four, and rebuilding served the same four. The loop had no
 * exit, and the remedy the page offers could never be seen to work.
 */

let clock = 0;
/** Rows are consumed newest-first, so tests build them in that order. */
const row = (problemId: string, isCorrect: boolean | null): MissRow => ({
  problem_id: problemId,
  is_correct: isCorrect,
  created_at: new Date(Date.UTC(2026, 0, 1) - clock++ * 60_000).toISOString(),
  problems: {
    difficulty: 2,
    format: "open",
    content: { statement_latex: "Solve." },
    topics: { title: "Fractions", units: { courses: { title: "Foundations" } } },
  },
});

const ids = (rows: MissRow[]) => outstandingMisses(rows, new Set()).map((m) => m.problemId);

describe("outstandingMisses", () => {
  it("drops a problem once the newest attempt on it was correct", () => {
    // Newest first: put right today, missed yesterday.
    expect(ids([row("p1", true), row("p1", false)])).toEqual([]);
  });

  it("keeps a problem that has only ever been missed", () => {
    expect(ids([row("p1", false)])).toEqual(["p1"]);
  });

  it("brings a problem back when a later attempt goes wrong again", () => {
    // Newest first: missed today, right last week. The evidence expired.
    expect(ids([row("p1", false), row("p1", true)])).toEqual(["p1"]);
  });

  it("counts repeat misses without double-counting an older correct answer", () => {
    const rows = [row("p1", false), row("p1", true), row("p1", false)];
    const [missed] = outstandingMisses(rows, new Set());
    expect(missed.problemId).toBe("p1");
    // The correct row in the middle is not a miss.
    expect(missed.misses).toBe(2);
  });

  it("keeps a revealed problem, and marks it as revealed only", () => {
    const [missed] = outstandingMisses([row("p1", null)], new Set());
    expect(missed.revealedOnly).toBe(true);
  });

  it("stops calling it revealed-only once it has actually been answered wrong", () => {
    const [missed] = outstandingMisses([row("p1", false), row("p1", null)], new Set());
    expect(missed.revealedOnly).toBe(false);
  });

  it("still marks an in-set retry as recovered, and sinks it below the rest", () => {
    const rows = [row("p1", false), row("p2", false), row("p2", false)];
    // p1 was put right on a retry; p2 was missed twice and never recovered.
    const out = outstandingMisses(rows, new Set(["p1"]));
    expect(out.map((m) => m.problemId)).toEqual(["p2", "p1"]);
    expect(out[1].recovered).toBe(true);
  });

  it("ranks by miss count before age", () => {
    const rows = [row("p1", false), row("p2", false), row("p2", false)];
    expect(ids(rows)).toEqual(["p2", "p1"]);
  });

  it("skips rows whose problem lost its topic", () => {
    const orphan = { ...row("p1", false), problems: null };
    expect(ids([orphan])).toEqual([]);
  });
});

describe("SCORED_MODES", () => {
  /**
   * The queue filters on this. A flashcard is repeatable with the solution one
   * click away, so a rep that happens to go well would otherwise clear a real
   * miss — and a rep that goes badly would create one.
   */
  it("covers the modes that are a record of working through a set", () => {
    expect([...SCORED_MODES].sort()).toEqual(["practice", "quiz", "scan"]);
  });

  it("excludes flashcards", () => {
    expect(SCORED_MODES).not.toContain("flashcard");
  });
});
