/**
 * Step three: judge the solutions against the answer keys, and write what
 * survives into the pool.
 *
 * The gates are `solverGates` — the pipeline's, not a copy. That is the only
 * reason this tool is defensible: a problem seeded here is held to exactly the
 * bar a generated one is held to, so nothing gets into the pool by way of a
 * check that was written to be easier to pass.
 *
 * There is deliberately no repair pass. `verifyOrRepair` spends a model call
 * rewriting a problem the solver disagreed with, because a live build has a
 * student waiting and a slot to fill. Nothing is waiting here, the slot is
 * imaginary, and the cheap move is to discard the problem and write another —
 * so a disagreement is reported with both answers and the problem is dropped.
 */
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askModelIfEquivalent, type EquivalenceCheck } from "@/lib/ai/equivalence";
import { SolvedBatchSchema, type SolverResult, type TaggedProblem } from "@/lib/ai/schemas";
import { solverGates } from "@/lib/ai/verify";
import { insertProblems, rowFromGenerated } from "@/lib/sets";
import { adjudicateWithClaude } from "@/tools/seed-pool/adjudicate";
import { loadAuthored, reportDropped } from "@/tools/seed-pool/authored";
import { attemptCap } from "@/tools/seed-pool/claude-cli";
import { assertSolvedMatchesBrief } from "@/tools/seed-pool/solve";
import {
  FILES,
  readJson,
  readJsonIfPresent,
  schemaComplaint,
  writeJson,
  type SeedPlan,
} from "@/tools/seed-pool/shared";

type SolvedResult = ReturnType<typeof SolvedBatchSchema.parse>["results"][number];

/**
 * Put each result against the problem it claims, positionally-safe.
 *
 * Identical rule to `solveBatch`, and for the identical reason: the number is
 * something the solver wrote, so an out-of-range or repeated one is dropped
 * rather than trusted into another problem's slot. Pairing by array position
 * instead would mis-pair the entire tail of the batch the moment one result
 * went missing, and a problem judged against its neighbour's solution is the
 * worst outcome available here — it is exactly how a wrong answer key passes.
 */
export function pairSolved(results: SolvedResult[], count: number): (SolverResult | null)[] {
  const out: (SolverResult | null)[] = new Array(count).fill(null);
  for (const r of results) {
    const index = r.problem_number - 1;
    if (index < 0 || index >= count || out[index] !== null) continue;
    out[index] = r;
  }
  return out;
}

/** One answer pair a local comparison could not settle. */
export type Pending = {
  key: string;
  problem_number: number;
  reference: string;
  acceptable_forms: string[];
  answer_given: string;
  equivalent: boolean | null;
};

export function equivalenceKey(
  student: string,
  reference: string,
  forms: string[]
): string {
  return createHash("sha256")
    .update(JSON.stringify([student, reference, [...forms].sort()]))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Stand in for the equivalence model call by collecting the question instead of
 * answering it.
 *
 * `solverAgrees` ends at "are these two the same answer, written differently?"
 * for every prose answer — which is every `proof`, `conceptual` and
 * `error_analysis` problem, since `checkOpenAnswer` can never do better than
 * "uncertain" on text. Live, that goes to a model. Offline, answering it here
 * would mean either calling the provider this tool exists to avoid, or
 * resolving it to `false` — and resolving it to `false` is the exact bug that
 * once rejected 100% of prose-answered problems while drill looked fine.
 *
 * So it is deferred: the question is written out, and the run that supplies the
 * verdict picks up where this one stopped. Returning `false` in the meantime is
 * safe because the caller reads `pending` and reports those problems as
 * unresolved rather than as rejected.
 */
export function deferringEquivalence(known: Map<string, boolean> = new Map()) {
  const pending: Pending[] = [];
  const check: EquivalenceCheck = async (student, reference, acceptableForms = []) => {
    const key = equivalenceKey(student, reference, acceptableForms);
    const verdict = known.get(key);
    if (verdict !== undefined) return verdict;
    if (!pending.some((p) => p.key === key)) {
      pending.push({
        key,
        problem_number: 0,
        reference,
        acceptable_forms: acceptableForms,
        answer_given: student,
        equivalent: null,
      });
    }
    return false;
  };
  return { check, pending };
}

/**
 * Fold this run's open questions into the file, keeping every verdict already
 * given.
 *
 * A run that resolves two questions and still has a third writes the file
 * again, and a verdict that vanished there would have to be given twice — the
 * problems it accepted were accepted *because* of it, so the record of it is
 * the only reason a later run doesn't ask again.
 */
export function mergeAdjudications(previous: Pending[], pending: Pending[]): Pending[] {
  const known = new Set(previous.map((p) => p.key));
  return [...previous, ...pending.filter((p) => !known.has(p.key))];
}

export type Judgement =
  | { status: "accepted"; number: number; problem: TaggedProblem; verification: unknown }
  | { status: "unsolved"; number: number; statement: string }
  | { status: "deferred"; number: number; statement: string }
  | { status: "rejected"; number: number; statement: string; reason: string };

export async function judgeAll(
  problems: TaggedProblem[],
  solved: (SolverResult | null)[],
  difficulty: number,
  equivalence: { check: EquivalenceCheck; pending: Pending[] }
): Promise<Judgement[]> {
  const out: Judgement[] = [];
  for (const [i, problem] of problems.entries()) {
    const number = i + 1;
    const statement = problem.statement_latex.slice(0, 100);
    const solver = solved[i];
    if (!solver) {
      out.push({ status: "unsolved", number, statement });
      continue;
    }

    // A gate run that asked a question nobody has answered yet failed for want
    // of an answer, not on the merits. Watching `pending` grow is how the two
    // are told apart, since `solverGates` reports both as an answer mismatch.
    const before = equivalence.pending.length;
    const reason = await solverGates(problem, solver, difficulty, equivalence.check);
    for (const p of equivalence.pending.slice(before)) p.problem_number = number;

    if (reason === null) {
      out.push({
        status: "accepted",
        number,
        problem,
        verification: {
          status: "verified",
          // Distinct from the pipeline's "independent-solve" on purpose. The
          // check is the same one, but who ran it is not, and the column is the
          // only record of that. Anything ever found wrong with a batch seeded
          // this way is findable by this string and by nothing else.
          method: "offline-independent-solve",
          solver_answer: solver.final_answer_latex,
          difficulty_estimate: solver.difficulty_estimate,
        },
      });
      continue;
    }
    out.push(
      equivalence.pending.length > before
        ? { status: "deferred", number, statement }
        : { status: "rejected", number, statement, reason }
    );
  }
  return out;
}

/**
 * Where an adjudicating subprocess works: the questions and nothing else.
 *
 * Named for the files it holds rather than for the step, since `adjudicate.json`
 * — the hand-answered version of the same questions — sits in the parent
 * directory and two things called `adjudicate` a level apart is a good way to
 * open the wrong one.
 */
export const equivalenceDir = (dir: string) => join(dir, "equivalence");

/**
 * Judge a batch twice, with `claude -p` answering in between whatever local
 * comparison could not settle.
 *
 * Two passes rather than a check that spawns per question, because a cell of
 * twelve prose problems raises a dozen questions and a subprocess each would
 * cost more wall clock than the authoring did. The shape is the one the manual
 * flow already has — collect, answer, judge again — with `adjudicate.json`'s
 * round trip through a person replaced by one round trip through a subprocess.
 *
 * Re-judging is free: `solverGates` makes no model call of its own, so the
 * second pass is the same local arithmetic over a map that now has answers in
 * it. Every question left unanswered stays deferred, which drops its problem —
 * the same outcome `--equivalence defer` gives, and the floor this degrades to
 * when the subprocess fails.
 */
export async function judgeWithClaudeAdjudicator(
  problems: TaggedProblem[],
  solved: (SolverResult | null)[],
  difficulty: number,
  opts: { dir: string; model?: string; timeoutMs: number; known?: Map<string, boolean> },
  log: (line: string) => void = () => {}
): Promise<{ judged: Judgement[]; pending: Pending[]; asked: number }> {
  const known = new Map(opts.known ?? []);
  const first = deferringEquivalence(known);
  const judged = await judgeAll(problems, solved, difficulty, first);
  if (first.pending.length === 0) return { judged, pending: [], asked: 0 };

  mkdirSync(opts.dir, { recursive: true });
  const verdicts = await adjudicateWithClaude(
    first.pending,
    opts.dir,
    { model: opts.model, timeoutMs: opts.timeoutMs },
    log
  );
  if (verdicts.size === 0) {
    return { judged, pending: first.pending, asked: first.pending.length };
  }

  for (const [key, verdict] of verdicts) known.set(key, verdict);
  const second = deferringEquivalence(known);
  return {
    judged: await judgeAll(problems, solved, difficulty, second),
    pending: second.pending,
    asked: first.pending.length,
  };
}

export type IngestOptions = {
  dir: string;
  dryRun: boolean;
  /**
   * `defer` writes the open questions out for a person; `ai` spends a provider
   * call on each; `claude` asks a subprocess, which is the same question put to
   * a model that is not the provider's.
   */
  equivalence: "defer" | "ai" | "claude";
  /** Which Claude answers them under `--equivalence claude`. */
  model?: string;
};

export async function runIngest(db: SupabaseClient, opts: IngestOptions): Promise<void> {
  const { dir } = opts;
  const plan = readJson<SeedPlan>(dir, FILES.plan, `run \`npm run seed -- plan\` first`);
  const { problems, dropped } = loadAuthored(dir, plan);
  reportDropped(dropped);
  if (problems.length === 0) throw new Error(`nothing in ${dir}/${FILES.authored} to ingest`);

  const rawSolved = readJson<unknown>(
    dir,
    FILES.solved,
    `write it from ${dir}/${FILES.solvingBrief}`
  );
  const parsed = SolvedBatchSchema.safeParse(rawSolved);
  if (!parsed.success) {
    throw new Error(
      `${dir}/${FILES.solved} does not match the solver schema: ${schemaComplaint(parsed.error)}`
    );
  }
  // Before anything is paired by number, prove the numbers still mean what they
  // meant when the brief was written.
  assertSolvedMatchesBrief(dir, problems);
  const solved = pairSolved(parsed.data.results, problems.length);

  const previous = readJsonIfPresent<Pending[]>(dir, FILES.adjudicate) ?? [];
  const answered = new Map(
    previous
      .filter((p) => typeof p.equivalent === "boolean")
      .map((p) => [p.key, p.equivalent as boolean])
  );
  if (answered.size > 0) {
    console.log(`Using ${answered.size} equivalence verdict(s) from ${FILES.adjudicate}.`);
  }

  let judged: Judgement[];
  let pending: Pending[];
  if (opts.equivalence === "claude") {
    // No run deadline here the way `auto` has one — a person is watching this
    // one — so the subprocess gets the flat ceiling `attemptCap` tops out at.
    const run = await judgeWithClaudeAdjudicator(
      problems,
      solved,
      plan.difficulty,
      {
        dir: equivalenceDir(dir),
        model: opts.model,
        timeoutMs: attemptCap(Infinity),
        known: answered,
      },
      (line) => console.log(line.trim())
    );
    if (run.asked > 0) {
      console.log(`Asked \`claude\` about ${run.asked} answer pair(s) local comparison could not settle.`);
    }
    judged = run.judged;
    pending = run.pending;
  } else {
    const equivalence =
      opts.equivalence === "ai"
        ? { check: askModelIfEquivalent, pending: [] as Pending[] }
        : deferringEquivalence(answered);
    judged = await judgeAll(problems, solved, plan.difficulty, equivalence);
    pending = equivalence.pending;
  }

  const accepted = judged.filter((j) => j.status === "accepted");
  const deferred = judged.filter((j) => j.status === "deferred");
  const unsolved = judged.filter((j) => j.status === "unsolved");

  console.log(`\n${judged.length} problem${judged.length === 1 ? "" : "s"} judged:`);
  for (const j of judged) {
    const tag =
      j.status === "accepted"
        ? "ok      "
        : j.status === "unsolved"
          ? "unsolved"
          : j.status === "deferred"
            ? "ask     "
            : "reject  ";
    const note = j.status === "rejected" ? ` — ${j.reason}` : "";
    const text = j.status === "accepted" ? j.problem.statement_latex.slice(0, 100) : j.statement;
    console.log(`  ${tag} [${j.number}] ${text}${note}`);
  }
  const rejected = judged.length - accepted.length - deferred.length - unsolved.length;
  console.log(
    `\n${accepted.length} accepted, ${rejected} rejected, ${unsolved.length} unsolved, ${deferred.length} awaiting a verdict.`
  );

  if (deferred.length > 0) {
    const path = writeJson(dir, FILES.adjudicate, mergeAdjudications(previous, pending));
    console.log(
      `\n${pending.length} answer pair(s) need a judgement — these are the prose answers
local comparison cannot settle. Open ${path}, set each "equivalent" to true or
false, and run ingest again. Judge the conclusion only: "even" and "n+m=2k, so
the sum is even" are the same answer.`
    );
  }

  if (accepted.length === 0) {
    console.log(`\nNothing to insert.`);
    return;
  }

  const byIndex = plan.topics.map((t) => t.id);
  const rows = accepted.map((j) =>
    rowFromGenerated(j.problem, byIndex[j.problem.topic_index], "ai", null, j.verification)
  );

  if (opts.dryRun) {
    console.log(`\nDry run — ${rows.length} row(s) not written.`);
    return;
  }
  const inserted = await insertProblems(db, rows);
  console.log(`\nWrote ${inserted.length} problem(s) into the pool as \`active\`.`);
  if (inserted.length < rows.length) {
    // `insertProblems` collapses rows sharing `(topic_id, content_hash)` before
    // sending them, so a shortfall here is duplicate problems in one batch, not
    // a partial write.
    console.log(
      `  ${rows.length - inserted.length} collapsed into an existing row — same topic and same content hash.`
    );
  }
}
