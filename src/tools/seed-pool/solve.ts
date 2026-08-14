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
import { SOLVER_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { jsonSchemaFor } from "@/lib/ai/provider";
import { SolvedBatchSchema } from "@/lib/ai/schemas";
import { solverPrompt } from "@/lib/ai/verify";
import { loadAuthored, reportDropped } from "@/tools/seed-pool/authored";
import {
  fence,
  FILES,
  readJson,
  writeFile,
  writeJson,
  type SeedPlan,
} from "@/tools/seed-pool/shared";

export function runSolve(dir: string): void {
  const plan = readJson<SeedPlan>(dir, FILES.plan, `run \`npm run seed -- plan\` first`);
  const { problems, dropped } = loadAuthored(dir, plan);
  reportDropped(dropped);
  if (problems.length === 0) {
    throw new Error(`nothing in ${dir}/${FILES.authored} survived validation`);
  }

  writeJson(dir, FILES.solverSchema, jsonSchemaFor(SolvedBatchSchema));

  const body = problems
    .map((p, i) => `### [${i + 1}]\n\n${solverPrompt(p)}`)
    .join("\n\n---\n\n");

  const brief = `# Solving brief

${problems.length} problem${problems.length === 1 ? "" : "s"} to solve. Write
\`${dir}/${FILES.solved}\`, then run:

    npm run seed -- ingest

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

Write \`${dir}/${FILES.solved}\` as one JSON object matching
\`${dir}/${FILES.solverSchema}\`:

    { "results": [ { "problem_number": 1, ... }, ... ] }

\`problem_number\` is the \`[n]\` heading of the problem each result answers —
not the position in your array. It is checked rather than trusted: a number out
of range or used twice is dropped, and a problem left unclaimed is reported and
skipped rather than paired with its neighbour's solution.
`;

  const path = writeFile(dir, FILES.solvingBrief, brief);
  console.log(`Wrote ${path}`);
  console.log(`  ${problems.length} problem${problems.length === 1 ? "" : "s"}, statements only`);
  console.log(`\nNext: solve them into ${dir}/${FILES.solved}, then \`npm run seed -- ingest\`.`);
}
