import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SolverResult } from "@/lib/ai/schemas";
import { normalizeAuthored } from "@/tools/seed-pool/authored";
import { attemptCap, cellDir, childEnv, pickCells, rotate } from "@/tools/seed-pool/auto";
import { loadCatalog, type PoolRow, type TopicRow } from "@/tools/seed-pool/plan";
import { assertSolvedMatchesBrief, writeSolvingBrief } from "@/tools/seed-pool/solve";
import {
  deferringEquivalence,
  equivalenceKey,
  judgeAll,
  mergeAdjudications,
  pairSolved,
  type Pending,
} from "@/tools/seed-pool/ingest";
import {
  DEFAULT_DIR,
  parseDifficulties,
  parseEnumList,
  seedCommand,
  selectAll,
  splitList,
} from "@/tools/seed-pool/shared";
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

describe("pickCells", () => {
  const topic = (slug: string): TopicRow => ({
    id: slug,
    slug,
    title: slug,
    description: null,
    units: null,
  });
  const row = (over: Partial<PoolRow> = {}): PoolRow => ({
    topic_id: "a",
    difficulty: 2,
    style: "word",
    format: "open",
    ...over,
  });
  const want = {
    difficulties: [2],
    styles: ["word"] as const,
    formats: ["open"] as const,
    target: 3,
  };

  it("leaves out a cell that already has the target depth", () => {
    const pool = [row(), row(), row()];
    expect(pickCells([topic("a")], pool, { ...want, styles: [...want.styles], formats: [...want.formats] })).toEqual([]);
  });

  /**
   * The reason depth is counted per request rather than per cell. The pool
   * query matches style and format with `IN`, so forty drill/mcq problems are
   * worth nothing to a student asking for a word problem in open form — and
   * ranking on the raw total would spend the whole run on the deepest cells.
   */
  it("does not count problems a build asking for these styles could not reuse", () => {
    const pool = [row({ style: "drill" }), row({ format: "mcq" }), row({ difficulty: 3 })];
    const cells = pickCells([topic("a")], pool, {
      ...want,
      styles: [...want.styles],
      formats: [...want.formats],
    });
    expect(cells).toHaveLength(1);
    expect(cells[0].depth).toBe(0);
  });

  // Ties broken deterministically so a run stopped at twenty minutes and
  // started again picks up where it left off rather than repeating itself.
  it("orders thinnest first, then by slug and level", () => {
    const cells = pickCells([topic("b"), topic("a")], [row({ topic_id: "a" })], {
      ...want,
      difficulties: [2, 3],
      styles: [...want.styles],
      formats: [...want.formats],
    });
    expect(cells.map((c) => `${c.topic.slug}${c.difficulty}`)).toEqual(["a3", "b2", "b3", "a2"]);
  });
});

describe("rotate", () => {
  const STYLES = ["word", "conceptual", "proof", "error_analysis"] as const;
  const FORMATS = ["mcq", "open", "fill_blank", "multi_select", "ordering"] as const;

  it("asks for a slice rather than the whole vocabulary", () => {
    const { styles, formats } = rotate(0, [...STYLES], [...FORMATS]);
    expect(styles).toEqual(["word", "conceptual"]);
    expect(formats).toEqual(["mcq", "open", "fill_blank"]);
  });

  // The point of rotating at all: over successive visits a topic is approached
  // from every angle, not repeatedly from the first two.
  it("reaches every style and every format over successive attempts", () => {
    const seen = { styles: new Set<string>(), formats: new Set<string>() };
    for (let i = 0; i < 20; i += 1) {
      const mix = rotate(i, [...STYLES], [...FORMATS]);
      mix.styles.forEach((s) => seen.styles.add(s));
      mix.formats.forEach((f) => seen.formats.add(f));
    }
    expect(seen.styles.size).toBe(STYLES.length);
    expect(seen.formats.size).toBe(FORMATS.length);
  });

  it("collapses to what there is when asked for one style and one format", () => {
    expect(rotate(3, ["proof"], ["open"])).toEqual({ styles: ["proof"], formats: ["open"] });
  });
});

describe("attemptCap", () => {
  /**
   * A rate-limited subscription does not refuse, it waits — one invocation sat
   * for two and a half hours inside a twenty-minute run. A ceiling that outlives
   * the budget it sits under is not a ceiling.
   */
  it("never lets one invocation outlast what is left of the run", () => {
    expect(attemptCap(Date.now() + 5 * 60_000)).toBeLessThanOrEqual(5 * 60_000);
  });

  it("caps a generous budget rather than handing over the whole hour", () => {
    expect(attemptCap(Date.now() + 60 * 60_000)).toBe(15 * 60_000);
  });

  // Below the floor there is no point starting, but a cell already under way
  // gets the floor rather than a timeout it cannot possibly meet.
  it("floors an almost-spent budget", () => {
    expect(attemptCap(Date.now())).toBe(3 * 60_000);
  });
});

describe("childEnv", () => {
  // A nested `claude -p` that inherits the parent session's variables does not
  // fail, it hangs — which reads as a slow model rather than a bad spawn.
  it("clears the parent session's variables and keeps the ordinary ones", () => {
    const out = childEnv({ ...process.env, CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli" });
    expect(out.CLAUDECODE).toBeUndefined();
    expect(out.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(out.PATH).toBe(process.env.PATH);
  });

  /**
   * The author writes one JSON file into the directory it was started in. It
   * has no use for a key that bypasses RLS on the table holding every answer in
   * the app, and handing it one is a grant nothing asked for.
   */
  it("keeps the run's credentials out of the subprocess", () => {
    const out = childEnv({
      ...process.env,
      SUPABASE_SECRET_KEY: "sb-secret",
      GEMINI_API_KEY: "g-key",
      TURNSTILE_SECRET_KEY: "t-secret",
    });
    expect(out.SUPABASE_SECRET_KEY).toBeUndefined();
    expect(out.GEMINI_API_KEY).toBeUndefined();
    expect(out.TURNSTILE_SECRET_KEY).toBeUndefined();
  });

  // Matched on the name, so a secret added to `.env.local` next year is not
  // inherited silently by a list nobody thought to update.
  it("clears a credential it has never heard of", () => {
    const out = childEnv({ ...process.env, STRIPE_SECRET_KEY: "x", SOME_SERVICE_TOKEN: "y" });
    expect(out.STRIPE_SECRET_KEY).toBeUndefined();
    expect(out.SOME_SERVICE_TOKEN).toBeUndefined();
  });

  /**
   * A DSN carries a password in the middle of a URL and admits nothing in its
   * name, so the name pattern alone would hand it over intact.
   */
  it("clears a credential the name gives no sign of", () => {
    const out = childEnv({
      ...process.env,
      DATABASE_URL: "postgres://admin:hunter2@db.example.com:5432/app",
      PGCONN: "host=db.example.com password=hunter2",
      HARMLESS_URL: "https://example.com/health",
    });
    expect(out.DATABASE_URL).toBeUndefined();
    expect(out.PGCONN).toBeUndefined();
    // ...without sweeping up a URL that carries no credential.
    expect(out.HARMLESS_URL).toBe("https://example.com/health");
  });

  // Stripping these doesn't contain the child, it stops it running.
  it("leaves `claude` its own way of authenticating", () => {
    const out = childEnv({
      ...process.env,
      ANTHROPIC_API_KEY: "ak",
      CLAUDE_CODE_OAUTH_TOKEN: "ot",
    });
    expect(out.ANTHROPIC_API_KEY).toBe("ak");
    expect(out.CLAUDE_CODE_OAUTH_TOKEN).toBe("ot");
  });
});

describe("loadCatalog", () => {
  const topic = (slug: string) => ({ id: slug, slug, title: slug, description: null, units: null });

  /** A db that hands back the given pages, one per `.range()` call. */
  const paged = (pages: unknown[][]) => {
    const ranges: [number, number][] = [];
    const db = {
      from: () => ({
        select: () => ({
          range: (from: number, to: number) => {
            ranges.push([from, to]);
            return Promise.resolve({ data: pages.shift() ?? [], error: null });
          },
        }),
      }),
    };
    return { ranges, db: db as unknown as Parameters<typeof loadCatalog>[0] };
  };

  /**
   * PostgREST caps a response at 1000 rows silently. A catalog that stopped
   * there wouldn't fail — `census` would omit the topics past the cut and
   * `auto` would never pick a cell in them, which reads as those topics being
   * well stocked rather than invisible.
   */
  it("keeps reading past a full first page", async () => {
    const first = Array.from({ length: 1000 }, (_, i) => topic(`t${i}`));
    const { ranges, db } = paged([first, [topic("last-a"), topic("last-b")]]);
    const all = await loadCatalog(db);
    expect(all).toHaveLength(1002);
    expect(all.at(-1)?.slug).toBe("last-b");
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("stops after one page when that page comes back short", async () => {
    const { ranges, db } = paged([[topic("a"), topic("b")]]);
    await expect(loadCatalog(db)).resolves.toHaveLength(2);
    expect(ranges).toEqual([[0, 999]]);
  });

  it("still narrows to one course", async () => {
    const inCourse = { ...topic("a"), units: { title: "u", courses: { title: "Algebra 1" } } };
    const { db } = paged([[inCourse, topic("b")]]);
    await expect(loadCatalog(db, "Algebra 1")).resolves.toEqual([inCourse]);
  });
});

describe("assertSolvedMatchesBrief", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "seed-manifest-"));
  const batch = (n: number) =>
    normalizeAuthored(
      { problems: Array.from({ length: n }, (_, i) => mcq({ statement_latex: `Problem ${i}` })) },
      plan
    ).problems;

  it("passes when the batch is the one the brief was written from", () => {
    const d = dir();
    const problems = batch(3);
    writeSolvingBrief(problems, d, null);
    expect(() => assertSolvedMatchesBrief(d, problems)).not.toThrow();
  });

  /**
   * `problem_number` is an offset into the survivors of `authored.json`, and
   * `ingest` re-derives them from the file. Deleting one from the middle — which
   * `reportDropped` tells you to do — renumbers everything after it, and every
   * result still lands in range. Each problem would be judged against the next
   * one's solution, silently.
   */
  it("refuses a batch a problem was removed from the middle of", () => {
    const d = dir();
    const problems = batch(3);
    writeSolvingBrief(problems, d, null);
    const shortened = [problems[0], problems[2]];
    expect(() => assertSolvedMatchesBrief(d, shortened)).toThrow(/has changed since/);
  });

  it("refuses a batch whose problems were reordered", () => {
    const d = dir();
    const problems = batch(3);
    writeSolvingBrief(problems, d, null);
    expect(() =>
      assertSolvedMatchesBrief(d, [problems[1], problems[0], problems[2]])
    ).toThrow(/has changed since/);
  });

  // No manifest is no evidence either way, and the cost of guessing wrong is a
  // wrong answer key stamped `verified`.
  it("refuses a workspace with no manifest at all", () => {
    expect(() => assertSolvedMatchesBrief(dir(), batch(2))).toThrow(/is missing/);
  });
});

describe("cellDir", () => {
  it("names a cell after its topic and level", () => {
    expect(cellDir(".seed", "integer-operations", 3)).toBe(
      join(".seed", "auto", "integer-operations-d3")
    );
  });

  /**
   * The path this returns is `rmSync`'d recursively and forcibly, and the slug
   * in it comes from a database column. A `..` there would move the delete
   * somewhere nobody would think to look for it.
   */
  it("refuses a slug that would climb out of the workspace", () => {
    expect(() => cellDir(".seed", "../../..", 3)).toThrow(/refusing/);
    expect(() => cellDir(".seed", "a/../../b", 3)).toThrow(/refusing/);
    expect(() => cellDir(".seed", "C:\\Windows", 3)).toThrow(/refusing/);
    expect(() => cellDir(".seed", "", 3)).toThrow(/refusing/);
  });
});

describe("seedCommand", () => {
  it("says nothing about the workspace when it is the default one", () => {
    expect(seedCommand("ingest", DEFAULT_DIR)).toBe("npm run seed -- ingest");
  });

  /**
   * Without this the printed next step reads the default workspace, finds none
   * of the work just done, and reports the previous step as never having
   * happened — a confusing way to be told you typed the right thing in the
   * wrong place.
   */
  it("carries a custom workspace through to the next step", () => {
    expect(seedCommand("solve", "/tmp/pool")).toBe("npm run seed -- solve --dir /tmp/pool");
  });

  it("quotes a path with a space in it", () => {
    expect(seedCommand("ingest", "C:\\my pool")).toBe(`npm run seed -- ingest --dir "C:\\my pool"`);
  });
});

describe("flag parsing", () => {
  it("drops the empties a trailing comma leaves", () => {
    expect(splitList("a, b ,")).toEqual(["a", "b"]);
  });

  /**
   * `pickCells` iterates the difficulties, so an empty list means no cells —
   * which `auto` reads as "everything is stocked", raises the target, and under
   * `--forever` repeats for as long as it is left running.
   */
  it("refuses a difficulty list that parsed to nothing", () => {
    expect(() => parseDifficulties("")).toThrow(/at least one/);
    expect(() => parseDifficulties(" , ")).toThrow(/at least one/);
  });

  it("takes the levels it was given, once each", () => {
    expect(parseDifficulties("3, 1 ,3")).toEqual([3, 1]);
  });

  it("rejects a level outside the rubric", () => {
    expect(() => parseDifficulties("1,6")).toThrow(/1 to 5/);
    expect(() => parseDifficulties("2.5")).toThrow(/1 to 5/);
  });

  it("names the allowed values when one is misspelled", () => {
    expect(() => parseEnumList("mcq,opne", ["mcq", "open"], "formats")).toThrow(/opne/);
  });

  it("collapses a repeated value", () => {
    expect(parseEnumList("mcq,mcq,open", ["mcq", "open"], "formats")).toEqual(["mcq", "open"]);
  });
});
