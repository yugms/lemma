/**
 * The three steps, run end to end without a person between them.
 *
 * `plan`/`solve`/`ingest` exist as separate commands because the expensive part
 * is somebody reading one file and writing another. That somebody can be an
 * agent running under its own subscription, and once it is, the files between
 * the steps stop being a handoff and become an implementation detail — so this
 * drives all three in a loop, picking whichever (topic, difficulty) cell the
 * pool is thinnest at and moving on to the next one until the clock runs out.
 *
 * Nothing here reimplements a step. It calls `writeAuthoringBrief`,
 * `normalizeAuthored`, `writeSolvingBrief`, `judgeAll` and `insertProblems` —
 * the same functions the manual commands call, in the same order. What it adds
 * is the loop, the cell ranking, and the subprocess.
 *
 * **Who checks the work is the one real decision here**, and it is two flags,
 * kept apart because they are not the same trade:
 *
 * - `--verify` decides who re-solves each batch. `gemini` (default) uses
 *   `solveBatch`, the pipeline's own checker: a different model that never sees
 *   the workspace, so the independence is structural. It costs provider
 *   requests — roughly three per twelve problems — but a pool problem is
 *   authored once and reused for as long as it lives, against five requests
 *   every time a build has to write one. `claude` runs a second subprocess in a
 *   directory holding the statements and nothing else. It spends no provider
 *   quota and it is weaker: an author and a solver that are the same model
 *   share their blind spots, which is the objection that makes
 *   Gemini-writes-Gemini-checks worth distrusting in the first place. Isolation
 *   here is the directory and the brief, not a sandbox.
 * - `--equivalence` decides who settles "are these two the same answer, written
 *   differently?" — the question every prose answer ends at. `claude` is a far
 *   softer choice there than under `--verify`, for the reason `adjudicate.ts`
 *   sets out: that question takes both answers as input, so it was never going
 *   to be blind, and it is a language comparison rather than a second opinion.
 *
 * `--author-model` and `--check-model` split the subprocess in two, because
 * writing a problem and marking one are not the same job. Authoring is the hard
 * half and worth the larger model; solving a stated problem and comparing two
 * answers are not, and a smaller model does them faster and further from the
 * author's own blind spots.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askModelIfEquivalent } from "@/lib/ai/equivalence";
import type { ProblemFormat, ProblemStyle } from "@/lib/ai/kinds";
import { SolvedBatchSchema, type SolverResult, type TaggedProblem } from "@/lib/ai/schemas";
import { solveBatch } from "@/lib/ai/verify";
import { insertProblems, rowFromGenerated } from "@/lib/sets";
import { normalizeAuthored } from "@/tools/seed-pool/authored";
import {
  attemptCap,
  DRIVER_NOTE,
  killLiveChildren,
  runClaude,
} from "@/tools/seed-pool/claude-cli";
import {
  deferringEquivalence,
  judgeAll,
  judgeWithClaudeAdjudicator,
  pairSolved,
  type Judgement,
  type Pending,
} from "@/tools/seed-pool/ingest";
import {
  avoidList,
  loadCatalog,
  loadPool,
  writeAuthoringBrief,
  type PoolRow,
  type TopicRow,
} from "@/tools/seed-pool/plan";
import { writeSolvingBrief } from "@/tools/seed-pool/solve";
import { FILES, readJsonIfPresent, schemaComplaint } from "@/tools/seed-pool/shared";

export type Cell = { topic: TopicRow; difficulty: number; depth: number };

/**
 * The cells worth authoring into, thinnest first.
 *
 * Depth counts only rows a build asking for *these* styles and formats could
 * actually reuse, which is the number that matters and not the one `census`
 * prints. The pool query matches style and format with `IN` and difficulty with
 * `=`, so a topic holding forty drill/mcq problems is still empty as far as a
 * student asking for a `word_problem` in `open` form is concerned — and ranking
 * on the raw total would send every hour of this straight back to the cells
 * that are already the deepest.
 */
export function pickCells(
  topics: TopicRow[],
  pool: PoolRow[],
  opts: {
    difficulties: number[];
    styles: ProblemStyle[];
    formats: ProblemFormat[];
    target: number;
  }
): Cell[] {
  const styles = new Set<string>(opts.styles);
  const formats = new Set<string>(opts.formats);
  const depth = new Map<string, number>();
  for (const r of pool) {
    if (!styles.has(r.style) || !formats.has(r.format)) continue;
    const key = `${r.topic_id}|${r.difficulty}`;
    depth.set(key, (depth.get(key) ?? 0) + 1);
  }

  const cells: Cell[] = [];
  for (const topic of topics) {
    for (const difficulty of opts.difficulties) {
      const have = depth.get(`${topic.id}|${difficulty}`) ?? 0;
      if (have < opts.target) cells.push({ topic, difficulty, depth: have });
    }
  }
  // Ties broken by slug and level rather than left to the catalog's order, so a
  // run interrupted at twenty minutes and restarted picks up where it stopped
  // instead of re-authoring the same twenty cells.
  return cells.sort(
    (a, b) =>
      a.depth - b.depth ||
      a.topic.slug.localeCompare(b.topic.slug) ||
      a.difficulty - b.difficulty
  );
}

/**
 * How much of the requested vocabulary one batch asks for.
 *
 * Not all of it, deliberately. A twelve-problem batch spread over four styles
 * and eight formats is one or two problems of each, and `splitAcrossKinds`
 * divides before the mix is packed into calls — so asking for everything at
 * once buys a thin sample of the cross product at the worst request count. A
 * narrow slice that *rotates* covers the same ground over successive visits
 * and packs properly on each one.
 */
const STYLES_PER_BATCH = 2;
const FORMATS_PER_BATCH = 3;

const sliceOf = <T>(xs: T[], offset: number, size: number): T[] =>
  Array.from({ length: Math.min(size, xs.length) }, (_, k) => xs[(offset + k) % xs.length]);

/**
 * The slice of styles and formats this attempt asks for.
 *
 * Strides are coprime with the list lengths often enough that successive
 * attempts land on different windows, which is the whole point: over a long run
 * every topic is approached from every angle rather than repeatedly from the
 * first two. `pickCells` still measures depth over the *whole* requested
 * vocabulary, so a cell keeps coming back until it is stocked across all of it.
 */
export function rotate(
  attempt: number,
  styles: ProblemStyle[],
  formats: ProblemFormat[]
): { styles: ProblemStyle[]; formats: ProblemFormat[] } {
  return {
    styles: sliceOf(styles, attempt * STYLES_PER_BATCH, STYLES_PER_BATCH),
    formats: sliceOf(formats, attempt * FORMATS_PER_BATCH, FORMATS_PER_BATCH),
  };
}

/**
 * The file a detached run watches for "please stop".
 *
 * A run started in another window, or with its console closed behind it, has no
 * Ctrl-C to receive — and killing it outright abandons whatever cell is in
 * flight along with the authoring already paid for. `npm run seed -- stop`
 * writes this, and the loop finishes what it is holding and exits.
 */
export const stopPath = (dir: string) => join(dir, "auto", "stop");

/**
 * Where one cell keeps its files, refusing a slug that isn't one.
 *
 * The name is interpolated into a path this function's callers then `rmSync`
 * recursively and forcibly, twice — once to clear a stale workspace and once to
 * sweep a successful one. The slug comes from `topics.slug`, which is ours, and
 * that is exactly the assumption worth not making: "ours" is a fact about the
 * catalog today, while `{ recursive: true, force: true }` is unrecoverable on
 * any day, and a single `..` in that column would move the delete somewhere
 * nobody would think to look for it. Checked here rather than at the call sites
 * so both deletes are covered by construction.
 *
 * All 103 slugs in the catalog satisfy this; a cell that cannot be named is
 * refused rather than guessed at, which costs that cell and no other.
 */
const CATALOG_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function cellDir(dir: string, slug: string, difficulty: number): string {
  if (!CATALOG_SLUG.test(slug)) {
    throw new Error(`refusing to build a workspace path out of the slug "${slug}"`);
  }
  return join(dir, "auto", `${slug}-d${difficulty}`);
}

export function requestStop(dir: string): string {
  const path = stopPath(dir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "");
  return path;
}

export type AutoOptions = {
  dir: string;
  course?: string;
  /** Restrict the catalog to these slugs. Without it, every topic is in scope. */
  slugs?: string[];
  difficulties: number[];
  styles: ProblemStyle[];
  formats: ProblemFormat[];
  count: number;
  target: number;
  minutes: number;
  /** Run until stopped rather than until `minutes` is up. */
  forever: boolean;
  jobs: number;
  verify: "gemini" | "claude";
  equivalence: "ai" | "defer" | "claude";
  /**
   * Which Claude writes, and which one marks. Resolved by the CLI, where
   * `--model` sets both and either half overrides it, so nothing downstream has
   * to know a shorthand existed.
   *
   * They are separate because the two jobs are not the same difficulty. Writing
   * a good problem from nothing is the expensive half and the one worth a large
   * model; re-solving a stated problem and comparing two answers are ordinary
   * work, and a smaller model does them faster, cheaper, and — being trained
   * differently enough to fail in different places — slightly further from the
   * author's own blind spots. Slightly: same family, related training, nothing
   * like the independence `--verify gemini` gets structurally.
   */
  authorModel?: string;
  checkModel?: string;
  dryRun: boolean;
};

/**
 * `kept` is what passed the gates and `inserted` is what reached the table, and
 * they are separate so a `--dry-run` still reports honestly: a run that says
 * "3 kept" and "0 written" is describing itself, where one number doing both
 * jobs has to lie about one of them.
 */
type CellOutcome = { kept: number; inserted: number; authored: number; note: string };

const nothing = (note: string, authored = 0): CellOutcome => ({
  kept: 0,
  inserted: 0,
  authored,
  note,
});

/** One cell: brief, author, check, judge, write. */
async function seedCell(
  db: SupabaseClient,
  cell: Cell,
  opts: AutoOptions,
  mix: { styles: ProblemStyle[]; formats: ProblemFormat[] },
  deadline: number,
  log: (line: string) => void
): Promise<CellOutcome> {
  // Cleared rather than reused. A previous run's `authored.json` left in place
  // is a batch that gets solved and ingested a second time, and every one of
  // its problems would land on the content hash it already has — an upsert that
  // rewrites rows rather than an error anybody would see.
  const root = cellDir(opts.dir, cell.topic.slug, cell.difficulty);
  rmSync(root, { recursive: true, force: true });
  const authorDir = join(root, "author");
  const solveDir = join(root, "solve");
  mkdirSync(authorDir, { recursive: true });
  mkdirSync(solveDir, { recursive: true });
  // Made on demand by the adjudicator, since most cells never raise a question.

  const avoid = await avoidList(db, [cell.topic.id], cell.difficulty);
  const { plan, brief } = writeAuthoringBrief({
    topics: [cell.topic],
    difficulty: cell.difficulty,
    count: opts.count,
    styles: mix.styles,
    formats: mix.formats,
    avoid,
    dir: authorDir,
    next: null,
  });

  // The brief goes in on stdin as well as onto disk. The file is what makes a
  // failed cell diagnosable afterwards; passing the text is what stops the whole
  // batch depending on the subprocess deciding to open it.
  const authored = await runClaude(authorDir, `${brief}${DRIVER_NOTE}`, {
    model: opts.authorModel,
    timeoutMs: attemptCap(deadline),
  });

  // The file decides, not the exit code. An author that wrote the batch and then
  // wedged on something afterwards has done the expensive part, and throwing
  // that away costs the cell for a reason that has nothing to do with the work.
  const raw = readJsonIfPresent<unknown>(authorDir, FILES.authored);
  if (raw === null) {
    return nothing(authored.ok ? `author wrote no ${FILES.authored}` : `author ${authored.detail}`);
  }
  if (!authored.ok) log(`    author ${authored.detail}, but left a file — using it`);

  const { problems, dropped } = normalizeAuthored(raw, plan);
  for (const d of dropped) log(`    dropped [${d.position}] ${d.reason}`);
  if (problems.length === 0) return nothing("nothing survived validation");

  const solved =
    opts.verify === "gemini"
      ? await solveBatch(problems)
      : await solveWithClaude(problems, solveDir, opts, deadline, log);
  if (solved === null) return nothing("checker failed", problems.length);

  let judged: Judgement[];
  if (opts.equivalence === "claude") {
    // A second deadline read, not the one the author was given: authoring is
    // most of the cell, so what is left of the run now is a different number.
    const run = await judgeWithClaudeAdjudicator(
      problems,
      solved,
      cell.difficulty,
      {
        dir: join(root, "equivalence"),
        model: opts.checkModel,
        timeoutMs: attemptCap(deadline),
      },
      log
    );
    if (run.asked > 0) log(`    asked about ${run.asked} prose answer(s)`);
    judged = run.judged;
  } else {
    const equivalence =
      opts.equivalence === "ai"
        ? { check: askModelIfEquivalent, pending: [] as Pending[] }
        : deferringEquivalence();
    judged = await judgeAll(problems, solved, cell.difficulty, equivalence);
  }

  const accepted = judged.filter((j) => j.status === "accepted");
  for (const j of judged) {
    if (j.status === "rejected") log(`    reject [${j.number}] ${j.reason}`);
    if (j.status === "unsolved") log(`    unsolved [${j.number}] ${j.statement}`);
    if (j.status === "deferred") log(`    prose answer left unjudged [${j.number}]`);
  }
  const kept = accepted.length;
  if (kept === 0) return nothing("nothing passed the gates", problems.length);
  if (opts.dryRun) {
    return { kept, inserted: 0, authored: problems.length, note: "dry run, not written" };
  }

  const rows = accepted.map((j) =>
    rowFromGenerated(j.problem, cell.topic.id, "ai", null, j.verification)
  );
  const inserted = await insertProblems(db, rows);

  // Swept once the problems are safely in the table, and only then. A run over
  // the whole catalog would otherwise leave several hundred directories of
  // answer keys and worked solutions behind it, which is the thing `.gitignore`
  // is protecting and not a state worth accumulating. What stays is what failed
  // — the only copies anybody has a reason to open.
  rmSync(root, { recursive: true, force: true });
  return {
    kept,
    inserted: inserted.length,
    authored: problems.length,
    // `insertProblems` collapses rows sharing `(topic_id, content_hash)` before
    // sending them, so a shortfall is the author having written one problem
    // twice — worth saying, since the batch itself looked fine.
    note: inserted.length < kept ? `${kept - inserted.length} collapsed onto an existing hash` : "",
  };
}

/** The `--verify claude` half: statements into an otherwise empty directory. */
async function solveWithClaude(
  problems: TaggedProblem[],
  dir: string,
  opts: AutoOptions,
  deadline: number,
  log: (line: string) => void
): Promise<(SolverResult | null)[] | null> {
  const { brief } = writeSolvingBrief(problems, dir, null);
  const run = await runClaude(dir, `${brief}${DRIVER_NOTE}`, {
    model: opts.checkModel,
    timeoutMs: attemptCap(deadline),
  });
  const raw = readJsonIfPresent<unknown>(dir, FILES.solved);
  if (raw === null) {
    log(`    checker ${run.ok ? `wrote no ${FILES.solved}` : run.detail}`);
    return null;
  }
  const parsed = SolvedBatchSchema.safeParse(raw);
  if (!parsed.success) {
    // Named, because this is the most common way `--verify claude` loses a cell
    // and the workspace that would explain it is cleared by the next attempt on
    // the same cell. Without the field and the reason, a run's log says only
    // that a third of its cells failed and offers nothing to act on.
    log(`    checker output does not match the solver schema: ${schemaComplaint(parsed.error)}`);
    return null;
  }
  return pairSolved(parsed.data.results, problems.length);
}

export async function runAuto(db: SupabaseClient, opts: AutoOptions): Promise<void> {
  const wanted = opts.slugs ? new Set(opts.slugs) : null;
  const topics = (await loadCatalog(db, opts.course)).filter((t) => !wanted || wanted.has(t.slug));
  if (topics.length === 0) {
    throw new Error(
      `no topics matched — run \`npm run seed -- census\` for the catalog`
    );
  }
  // A stop left over from the last run is not this one's instruction.
  const stop = stopPath(opts.dir);
  mkdirSync(dirname(stop), { recursive: true });
  rmSync(stop, { force: true });

  const deadline = opts.forever ? Infinity : Date.now() + opts.minutes * 60_000;
  let stopped: string | null = null;
  let written = 0;
  let done = 0;
  let attempt = 0;
  /**
   * Two different kinds of nothing, counted apart because they deserve
   * opposite amounts of patience.
   *
   * A cell that authored a dozen problems and had all twelve rejected is the
   * gates working on a hard patch of the catalog — annoying, not broken, and
   * the next topic may well be fine. A cell that produced *no problems at all*
   * is the tool being stuck: no `claude` on PATH, a subscription that has
   * stopped answering, a schema that no longer matches. Every further attempt
   * at that costs a full timeout to learn the same thing, so it gives up fast.
   */
  let barren = 0;
  let stalled = 0;
  const STALL_LIMIT = 3;
  const BARREN_LIMIT = 10;

  const halt = (why: string) => {
    if (stopped) {
      killLiveChildren();
      process.exit(1);
    }
    stopped = why;
    console.log(
      `\n[${why}] finishing the ${opts.jobs === 1 ? "cell" : "cells"} in flight — again to quit now.`
    );
  };
  process.on("SIGINT", () => halt("interrupted"));
  process.on("SIGTERM", () => halt("terminated"));

  // Checked before starting a cell rather than after finishing one, on the same
  // argument as `buildDeadline`: what matters is not beginning work that cannot
  // land, and a cell abandoned halfway has paid for its authoring and got
  // nothing for it.
  const reasonToStop = (): string | null => {
    if (stopped) return stopped;
    if (Date.now() >= deadline) return `the ${opts.minutes}-minute budget is spent`;
    if (stalled >= STALL_LIMIT) return `${stalled} cells in a row authored nothing at all`;
    if (barren >= BARREN_LIMIT) return `${barren} cells in a row kept nothing`;
    if (existsSync(stop)) return "asked to stop";
    return null;
  };

  // Both halves of "who checks this" are printed, because they are set
  // separately and a run that solves with Claude but still spends provider calls
  // on its prose answers is not the no-provider run somebody meant to start —
  // nor is one that quietly drops every prose problem the no-quota run they did.
  const settles = { ai: "gemini", claude: "claude", defer: "nobody — they drop" };
  console.log(
    `${opts.count} problems per cell, solved by ${opts.verify}, ` +
      `prose answers settled by ${settles[opts.equivalence]}, ` +
      `${opts.jobs} at a time.\n` +
      (opts.forever
        ? `Running until stopped: Ctrl-C, or \`npm run seed -- stop\` from anywhere.`
        : `Running for up to ${opts.minutes} min; Ctrl-C or \`npm run seed -- stop\` ends it sooner.`)
  );

  let target = opts.target;
  for (let round = 1; ; round += 1) {
    const why = reasonToStop();
    if (why) {
      stopped = why;
      break;
    }

    // Re-censused every round rather than once, because the previous round
    // changed the answer. Without it the loop would keep working the cells that
    // were thinnest an hour ago.
    const cells = pickCells(topics, await loadPool(db), { ...opts, target });
    if (cells.length === 0) {
      // Covered once at this depth. Deepening rather than stopping is what
      // "keep going" has to mean past that point, and it deepens the whole
      // catalog evenly instead of burrowing into whichever topic sorted first.
      target += opts.target;
      console.log(`\nEvery cell has reached ${target - opts.target}. Deepening to ${target}.`);
      continue;
    }
    console.log(
      `\n== round ${round}: ${cells.length} cell${cells.length === 1 ? "" : "s"} under ${target} ==\n`
    );

    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        if (next >= cells.length) return;
        const ending = reasonToStop();
        if (ending) {
          stopped = ending;
          return;
        }
        const cell = cells[next++];
        const mix = rotate(attempt++, opts.styles, opts.formats);
        const started = Date.now();
        console.log(
          `→ ${cell.topic.slug} d${cell.difficulty} (has ${cell.depth}) ` +
            `${mix.styles.join("/")} · ${mix.formats.join("/")}`
        );

        const lines: string[] = [];
        let outcome: CellOutcome;
        try {
          outcome = await seedCell(db, cell, opts, mix, deadline, (line) => lines.push(line));
        } catch (err) {
          // One cell's failure is not the run's. A topic whose brief is
          // malformed or whose insert is rejected should cost that topic, not
          // the other hundred.
          outcome = nothing(err instanceof Error ? err.message : String(err));
        }

        done += 1;
        written += outcome.inserted;
        barren = outcome.kept > 0 ? 0 : barren + 1;
        stalled = outcome.authored > 0 ? 0 : stalled + 1;
        const secs = Math.round((Date.now() - started) / 1000);
        for (const line of lines) console.log(line);
        console.log(
          `  ${cell.topic.slug} d${cell.difficulty}: ${outcome.kept}/${outcome.authored} kept` +
            `${outcome.note ? ` — ${outcome.note}` : ""} (${secs}s, ${written} written so far)\n`
        );
      }
    };

    await Promise.all(Array.from({ length: opts.jobs }, worker));
  }

  rmSync(stop, { force: true });
  console.log(
    `\n${written} problem${written === 1 ? "" : "s"} written across ${done} cell${done === 1 ? "" : "s"} — ${stopped}.`
  );
  if (stalled >= STALL_LIMIT || barren >= BARREN_LIMIT) {
    console.log(`The last few messages above say why nothing was landing.`);
  } else {
    console.log(`Run it again whenever; it re-censuses and picks up where this left off.`);
  }
}
