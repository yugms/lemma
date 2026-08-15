/**
 * Step two: turn the authored batch into statements to be solved blind.
 *
 * This is the step the whole tool is arranged around. Seeding the pool by hand
 * is only worth doing if the problems that land in it are checked as hard as
 * the ones the pipeline writes, and the pipeline's check is an independent
 * solve of the statement alone. So the brief is built from `solverPrompt` —
 * the same function the live solver is shown — and contains no answer, no
 * explanation, and no distractor rationale.
 *
 * It needs no database and no key, so it can be run in a context that has never
 * seen the answers. That is the point of it being a separate step.
 */
import { createHash } from "node:crypto";
import { SOLVER_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { jsonSchemaFor } from "@/lib/ai/provider";
import { SolvedBatchSchema, type TaggedProblem } from "@/lib/ai/schemas";
import { solverPrompt } from "@/lib/ai/verify";
import { loadAuthored, reportDropped } from "@/tools/seed-pool/authored";
import {
  fence,
  FILES,
  readJson,
  readJsonIfPresent,
  writeFile,
  writeJson,
  type SeedPlan,
} from "@/tools/seed-pool/shared";

/**
 * A fingerprint of exactly what the solver was shown, in the order it saw it.
 *
 * Hashed from `solverPrompt` rather than from the statement, because the prompt
 * is the whole of what was solved — a problem whose choices were reordered is a
 * different question with the same statement.
 */
export const promptHashes = (problems: TaggedProblem[]): string[] =>
  problems.map((p) => createHash("sha256").update(solverPrompt(p)).digest("hex").slice(0, 16));

/**
 * Refuse to pair solutions onto a batch that is no longer the one they answer.
 *
 * `problem_number` is an offset into the survivors of `authored.json`, and
 * `ingest` re-derives those survivors from the file rather than from whatever
 * `solve` saw. Between the two steps the file is *expected* to be edited —
 * `reportDropped` says so in as many words — so deleting a problem from the
 * middle and re-running `ingest` without re-running `solve` renumbers
 * everything after it. Nothing downstream can notice: the numbers are all in
 * range, every result claims one, and each problem is judged against the next
 * one's solution. That is the failure `problem_number` exists to prevent,
 * arriving through the one door it doesn't cover.
 *
 * A missing manifest is treated as a mismatch. It means `solve` has not been
 * run since this check shipped, so there is no evidence either way — and the
 * cost of being wrong is a wrong answer key stamped `verified`, against a
 * re-run that costs one command.
 */
export function assertSolvedMatchesBrief(dir: string, problems: TaggedProblem[]): void {
  const manifest = readJsonIfPresent<{ prompts?: unknown }>(dir, FILES.solveManifest);
  const before = Array.isArray(manifest?.prompts) ? (manifest.prompts as string[]) : null;
  const now = promptHashes(problems);

  if (before === null) {
    throw new Error(
      `${dir}/${FILES.solveManifest} is missing, so there is no way to tell whether ` +
        `${FILES.solved} answers these problems — run \`npm run seed -- solve\` and solve the brief it writes`
    );
  }
  if (before.length !== now.length || before.some((h, i) => h !== now[i])) {
    throw new Error(
      `${FILES.authored} has changed since \`solve\` was run — the solutions in ${FILES.solved} ` +
        `were written against a different batch, and pairing them by number now would judge each ` +
        `problem against its neighbour's answer. Re-run \`npm run seed -- solve\` and solve the new brief.`
    );
  }
}

/**
 * Write the statements-only brief and the schema its answers must match.
 *
 * `dir` is deliberately a plain argument rather than the workspace: `auto`
 * writes this into a directory holding nothing else, so that the solver's
 * blindness is a property of the filesystem rather than of the paragraph below
 * asking for it. `next` says who runs the following step, and — as in
 * `writeAuthoringBrief` — whether the files are named bare or qualified.
 */
export function writeSolvingBrief(
  problems: TaggedProblem[],
  dir: string,
  next: string | null
): { path: string; brief: string } {
  const at = (name: string) => (next === null ? name : `${dir}/${name}`);
  writeJson(dir, FILES.solverSchema, jsonSchemaFor(SolvedBatchSchema));
  // What `ingest` checks its own reading of `authored.json` against before it
  // pairs anything by number. Written here because here is where the numbering
  // is decided.
  writeJson(dir, FILES.solveManifest, { prompts: promptHashes(problems) });

  const body = problems
    .map((p, i) => `### [${i + 1}]\n\n${solverPrompt(p)}`)
    .join("\n\n---\n\n");

  const brief = `# Solving brief

${problems.length} problem${problems.length === 1 ? "" : "s"} to solve. Write
\`${at(FILES.solved)}\`${next === null ? "." : `, then run:\n\n    ${next}`}

## Solve these as if you had never seen them before

This is a verification pass, not a review. Every problem below is about to be
stored and served to students, and the only thing standing between a confidently
wrong answer key and somebody's homework is whether this solve was genuinely
independent.

So: **do not open \`${FILES.authored}\`.** It holds the answer, the worked
solution and, on a multiple-choice problem, a note on why each wrong choice is
wrong. Reading any of it turns this step into a formality — you will agree with
the author, the gates will pass, and a wrong answer will go into the pool with a
"verified" stamp on it. If you authored these in this same session, hand this
file to a fresh context instead; there is nothing here that needs the history.

Everything you need is below. Solve each problem from its statement.

Report what you actually got, including when you think the problem is broken.
A disagreement here is the tool working: \`ingest\` discards the problem rather
than the solution, which costs one problem and saves a wrong answer.
Set \`is_well_posed: false\` for anything ambiguous, self-contradictory, or
unsolvable with its topic's tools, and say why in \`issue\`.

## Rules

${fence(SOLVER_SYSTEM_PROMPT)}

## Problems

${body}

## Output

Write \`${at(FILES.solved)}\` as one JSON object matching
\`${at(FILES.solverSchema)}\`:

    { "results": [ { "problem_number": 1, ... }, ... ] }

\`problem_number\` is the \`[n]\` heading of the problem each result answers —
not the position in your array. It is checked rather than trusted: a number out
of range or used twice is dropped, and a problem left unclaimed is reported and
skipped rather than paired with its neighbour's solution.
`;

  return { brief, path: writeFile(dir, FILES.solvingBrief, brief) };
}

export function runSolve(dir: string): void {
  const plan = readJson<SeedPlan>(dir, FILES.plan, `run \`npm run seed -- plan\` first`);
  const { problems, dropped } = loadAuthored(dir, plan);
  reportDropped(dropped);
  if (problems.length === 0) {
    throw new Error(`nothing in ${dir}/${FILES.authored} survived validation`);
  }

  const { path } = writeSolvingBrief(problems, dir, "npm run seed -- ingest");
  console.log(`Wrote ${path}`);
  console.log(`  ${problems.length} problem${problems.length === 1 ? "" : "s"}, statements only`);
  console.log(`\nNext: solve them into ${dir}/${FILES.solved}, then \`npm run seed -- ingest\`.`);
}
