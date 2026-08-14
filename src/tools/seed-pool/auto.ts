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
 * **Who checks the work is the one real decision here**, and it is `--verify`:
 *
 * - `gemini` (default) solves each batch with `solveBatch`, the pipeline's own
 *   checker. It is a different model that never sees the workspace, so the
 *   independence is structural. It costs provider requests — roughly three per
 *   twelve problems — but a pool problem is authored once and reused for as
 *   long as it lives, against five requests every time a build has to write one.
 * - `claude` runs a second subprocess in a directory holding the statements and
 *   nothing else. It spends no provider quota at all, and it is weaker: an
 *   author and a checker that are the same model share their blind spots, which
 *   is the same objection that makes Gemini-writes-Gemini-checks worth
 *   distrusting. Isolation here is the directory and the brief, not a sandbox.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askModelIfEquivalent } from "@/lib/ai/equivalence";
import type { ProblemFormat, ProblemStyle } from "@/lib/ai/kinds";
import { SolvedBatchSchema, type SolverResult, type TaggedProblem } from "@/lib/ai/schemas";
import { solveBatch } from "@/lib/ai/verify";
import { insertProblems, rowFromGenerated } from "@/lib/sets";
import { normalizeAuthored } from "@/tools/seed-pool/authored";
import { deferringEquivalence, judgeAll, pairSolved, type Pending } from "@/tools/seed-pool/ingest";
import {
  avoidList,
  loadCatalog,
  loadPool,
  writeAuthoringBrief,
  type PoolRow,
  type TopicRow,
} from "@/tools/seed-pool/plan";
import { writeSolvingBrief } from "@/tools/seed-pool/solve";
import { FILES, readJsonIfPresent } from "@/tools/seed-pool/shared";

/**
 * Session variables the parent Claude Code process exports, cleared before
 * spawning a child.
 *
 * A nested `claude -p` that inherits them does not fail — it hangs, until
 * whatever timeout is watching it gives up, which reads as a slow model rather
 * than a misconfigured spawn. Anything added to this list is a variable whose
 * presence made the child wait forever.
 */
const SESSION_VARS = [
  "CLAUDECODE",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "CLAUDE_CODE_EXECPATH",
  "AI_AGENT",
];

export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const name of SESSION_VARS) delete out[name];
  return out;
}

/**
 * Read, Write and Edit, and deliberately not Bash.
 *
 * The checking subprocess is given a directory holding the statements and
 * nothing else, which is only worth anything while the working directory is the
 * whole of what it can conveniently reach. A shell would make `../author` one
 * command away and turn the isolation into a request.
 */
const ALLOWED_TOOLS = "Read,Write,Edit";

/**
 * The longest one invocation may take, and the least it is worth starting with.
 *
 * Derived from what is left of the run rather than fixed, on the same argument
 * as `attemptCap` in the provider: a ceiling that outlives the budget it sits
 * under is not a ceiling. A subscription that has hit its rate limit does not
 * refuse — `claude -p` sits there waiting for the window to reopen, which is
 * indistinguishable from a long batch until it has eaten the afternoon. One
 * observed here ran 2.5 hours inside a 20-minute run.
 */
const MAX_CLAUDE_MS = 15 * 60_000;
const MIN_CLAUDE_MS = 3 * 60_000;

export const attemptCap = (deadline: number) =>
  Math.min(MAX_CLAUDE_MS, Math.max(MIN_CLAUDE_MS, deadline - Date.now()));

type ClaudeResult = { ok: boolean; detail: string };

function runClaude(
  cwd: string,
  prompt: string,
  opts: { model?: string; timeoutMs: number }
): Promise<ClaudeResult> {
  return new Promise((resolve) => {
    const args = ["-p", "--permission-mode", "acceptEdits", "--allowedTools", ALLOWED_TOOLS];
    if (opts.model) args.push("--model", opts.model);

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn("claude", args, { cwd, env: childEnv(process.env) });
    } catch (err) {
      resolve({ ok: false, detail: err instanceof Error ? err.message : "spawn failed" });
      return;
    }

    let out = "";
    let err = "";
    let settled = false;
    const finish = (result: ClaudeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    // Resolved on the timer rather than on the kill's `close`, which is the bug
    // the 2.5-hour run above was: `close` waits for every inherited stdio pipe,
    // so a child that survives the signal — or leaves one behind — holds the
    // job slot open for as long as it likes with the timeout already spent.
    const timer = setTimeout(() => {
      finish({ ok: false, detail: `timed out after ${Math.round(opts.timeoutMs / 60_000)} min` });
      child.kill();
    }, opts.timeoutMs);
    const cap = (s: string, chunk: unknown) => (s.length > 20_000 ? s : s + String(chunk));

    child.stdout.on("data", (d) => (out = cap(out, d)));
    child.stderr.on("data", (d) => (err = cap(err, d)));
    // `claude` not being on PATH is worth naming outright: it would otherwise
    // repeat once per cell for the length of the run.
    child.on("error", (e) => finish({ ok: false, detail: `could not run \`claude\`: ${e.message}` }));
    child.on("close", (code) =>
      finish(
        code === 0
          ? { ok: true, detail: out.trim().slice(-200) }
          : { ok: false, detail: `exit ${code}: ${err.trim().slice(-400) || out.trim().slice(-400)}` }
      )
    );
    child.stdin.end(prompt);
  });
}

const DRIVER_NOTE = `

---

You are being run non-interactively, in this directory, by \`npm run seed --
auto\`. Nobody is going to answer a question, so do not ask one: work with what
is here. When the file above is written, reply with the single word DONE.`;

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
  jobs: number;
  verify: "gemini" | "claude";
  equivalence: "ai" | "defer";
  model?: string;
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
  deadline: number,
  log: (line: string) => void
): Promise<CellOutcome> {
  // Cleared rather than reused. A previous run's `authored.json` left in place
  // is a batch that gets solved and ingested a second time, and every one of
  // its problems would land on the content hash it already has — an upsert that
  // rewrites rows rather than an error anybody would see.
  const root = join(opts.dir, "auto", `${cell.topic.slug}-d${cell.difficulty}`);
  rmSync(root, { recursive: true, force: true });
  const authorDir = join(root, "author");
  const solveDir = join(root, "solve");
  mkdirSync(authorDir, { recursive: true });
  mkdirSync(solveDir, { recursive: true });

  const avoid = await avoidList(db, [cell.topic.id], cell.difficulty);
  const { plan, brief } = writeAuthoringBrief({
    topics: [cell.topic],
    difficulty: cell.difficulty,
    count: opts.count,
    styles: opts.styles,
    formats: opts.formats,
    avoid,
    dir: authorDir,
    next: null,
  });

  // The brief goes in on stdin as well as onto disk. The file is what makes a
  // failed cell diagnosable afterwards; passing the text is what stops the whole
  // batch depending on the subprocess deciding to open it.
  const authored = await runClaude(authorDir, `${brief}${DRIVER_NOTE}`, {
    ...opts,
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

  const equivalence =
    opts.equivalence === "ai"
      ? { check: askModelIfEquivalent, pending: [] as Pending[] }
      : deferringEquivalence();
  const judged = await judgeAll(problems, solved, cell.difficulty, equivalence);

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
    ...opts,
    timeoutMs: attemptCap(deadline),
  });
  const raw = readJsonIfPresent<unknown>(dir, FILES.solved);
  if (raw === null) {
    log(`    checker ${run.ok ? `wrote no ${FILES.solved}` : run.detail}`);
    return null;
  }
  const parsed = SolvedBatchSchema.safeParse(raw);
  if (!parsed.success) {
    log(`    checker output does not match the solver schema`);
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
  const cells = pickCells(topics, await loadPool(db), opts);
  if (cells.length === 0) {
    console.log(`Every cell is already at ${opts.target}. Raise --target or widen --difficulty.`);
    return;
  }

  const deadline = Date.now() + opts.minutes * 60_000;
  console.log(
    `${cells.length} cell${cells.length === 1 ? "" : "s"} under the target of ${opts.target}, ` +
      `${opts.count} problems each, checked by ${opts.verify}.`
  );
  console.log(
    `Running for up to ${opts.minutes} min with ${opts.jobs} job${opts.jobs === 1 ? "" : "s"}. ` +
      `Cells are attempted thinnest first; stopping early is safe.\n`
  );

  let next = 0;
  let done = 0;
  let written = 0;
  // Three cells in a row that produced nothing is a broken setup, not bad luck
  // — a missing key, a checker that never runs, a schema that stopped matching.
  // Left alone it would spend the whole hour discovering that once per cell.
  let barren = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      // Checked before starting rather than after finishing, on the same
      // argument as `buildDeadline`: what matters is not beginning work that
      // cannot land, and a cell abandoned halfway has cost its authoring for
      // nothing.
      if (next >= cells.length || Date.now() >= deadline || barren >= 3) return;
      const cell = cells[next++];
      const started = Date.now();
      console.log(`→ ${cell.topic.slug} d${cell.difficulty} (pool has ${cell.depth})`);

      const lines: string[] = [];
      let outcome: CellOutcome;
      try {
        outcome = await seedCell(db, cell, opts, deadline, (line) => lines.push(line));
      } catch (err) {
        // One cell's failure is not the run's. A topic whose brief is malformed
        // or whose insert is rejected should cost that topic, not the other
        // ninety-nine.
        outcome = nothing(err instanceof Error ? err.message : String(err));
      }

      done += 1;
      written += outcome.inserted;
      barren = outcome.kept > 0 ? 0 : barren + 1;
      const secs = Math.round((Date.now() - started) / 1000);
      for (const line of lines) console.log(line);
      console.log(
        `  ${cell.topic.slug} d${cell.difficulty}: ${outcome.kept}/${outcome.authored} kept` +
          `${outcome.note ? ` — ${outcome.note}` : ""} (${secs}s, ${written} written so far)\n`
      );
    }
  };

  await Promise.all(Array.from({ length: opts.jobs }, worker));

  const left = cells.length - next;
  console.log(`\n${written} problem${written === 1 ? "" : "s"} written across ${done} cell${done === 1 ? "" : "s"}.`);
  if (barren >= 3) {
    console.log(
      `Stopped after three cells in a row produced nothing — the last few messages above say why.`
    );
  } else if (left > 0) {
    console.log(`${left} cell${left === 1 ? "" : "s"} still under target. Run it again to continue.`);
  }
}
