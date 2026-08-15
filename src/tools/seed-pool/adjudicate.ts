/**
 * The one verdict local comparison cannot reach, answered by `claude -p`
 * instead of by the provider.
 *
 * `solverAgrees` ends at "are these two the same answer, written differently?"
 * for every prose answer — which is every `proof`, `conceptual` and
 * `error_analysis` problem. Live that goes to `askModelIfEquivalent`; offline
 * the choices were a provider call or `defer`, and `defer` in an unattended run
 * means dropping three of the four styles the tool exists to seed, since
 * templates already serve `drill` for free and `word` is the only one left with
 * an answer a machine can compare.
 *
 * **This is the one checking job where using Claude costs almost nothing.** The
 * blind solve has to be a stranger: it exists to disagree, and an author and a
 * solver that share a blind spot agree wrongly. Equivalence cannot be blind at
 * all — both answers are its input — and what it asks is a language question,
 * "do these two phrasings say the same thing", not a maths one. So the argument
 * against `--verify claude` does not carry over to `--equivalence claude`, and
 * the two flags are separate precisely so the weak choice isn't bundled with
 * the cheap one.
 *
 * The directory it runs in holds the questions and nothing else, which here is
 * tidiness rather than containment — an adjudicator is handed both answers by
 * definition. What it buys is that one cell's questions can't be answered by
 * reading another problem's key out of `authored.json`.
 */
import { jsonSchemaFor } from "@/lib/ai/provider";
import { EquivalenceBatchSchema } from "@/lib/ai/schemas";
import { DRIVER_NOTE, runClaude } from "@/tools/seed-pool/claude-cli";
import {
  FILES,
  readJsonIfPresent,
  schemaComplaint,
  writeFile,
  writeJson,
} from "@/tools/seed-pool/shared";

/**
 * One unsettled answer pair. Structurally a subset of `Pending`, and spelled out
 * here rather than imported so this module owes `ingest` nothing — `ingest` is
 * the one that calls it.
 */
export type OpenQuestion = {
  key: string;
  reference: string;
  acceptable_forms: string[];
  answer_given: string;
};

/** Ask them all in one go: the questions are independent and each is two lines. */
export function writeEquivalenceBrief(questions: OpenQuestion[], dir: string): string {
  writeJson(dir, FILES.equivalenceSchema, jsonSchemaFor(EquivalenceBatchSchema));

  const body = questions
    .map((q) => {
      const also = q.acceptable_forms.length
        ? `\nAlso acceptable: ${q.acceptable_forms.join(" ; ")}`
        : "";
      return `### ${q.key}\n\nReference answer: ${q.reference}${also}\nAnswer given: ${q.answer_given}`;
    })
    .join("\n\n---\n\n");

  const brief = `# Equivalence brief

${questions.length} answer pair${questions.length === 1 ? "" : "s"} to judge.
Write \`${FILES.verdicts}\`.

## What is being asked

Each pair below is one problem's stored answer and what an independent solver
got for the same problem. Local comparison has already tried and returned
"uncertain", which is what every prose answer does — a solver asked to justify a
claim does not phrase its conclusion character for character the way the author
did.

**Judge the conclusion only.** "even" and "n+m=2k, so the sum is even" are the
same answer. So are \`3/4\`, \`0.75\` and \`\\frac{3}{4}\`. Different notation,
different wording, more or less working shown, a different valid route to the
same place — all equivalent.

Not equivalent: a different value, a claim that does not follow, an answer to a
different question, or a conclusion that is right only under an assumption the
other one didn't make. Being *nearly* right is not equivalent — a problem
dropped here costs one problem, and a wrong answer key waved through is served
to students as verified.

You are not marking the problem, re-solving it, or deciding which answer is
correct. If they disagree, say so and let the caller discard it.

## Pairs

${body}

## Output

Write \`${FILES.verdicts}\` as one JSON object matching
\`${FILES.equivalenceSchema}\`:

    { "verdicts": [ { "key": "...", "equivalent": true }, ... ] }

\`key\` is the \`###\` heading of the pair the verdict answers, copied exactly.
It is checked rather than trusted: a key that isn't one of the above, or one
used twice, is dropped. A pair you leave out stays unjudged and its problem is
discarded, so answer all ${questions.length} — but leaving one out is safer
than guessing at it.
`;

  writeFile(dir, FILES.equivalenceBrief, brief);
  return brief;
}

/**
 * Verdicts by key, keeping only rulings on pairs that were actually asked
 * about.
 *
 * The same rule as `pairSolved` and for the same reason: the key is something
 * the model wrote back, so one that was never asked, or one used twice, is
 * dropped rather than trusted. Attaching a stray verdict to a pair it doesn't
 * belong to would let one problem's "equivalent" accept another problem's wrong
 * answer key — and a wrong key that passes is stamped `verified` and served.
 */
export function verdictsFor(
  questions: OpenQuestion[],
  ruled: { key: string; equivalent: boolean }[]
): Map<string, boolean> {
  const asked = new Set(questions.map((q) => q.key));
  const verdicts = new Map<string, boolean>();
  for (const v of ruled) {
    if (!asked.has(v.key) || verdicts.has(v.key)) continue;
    verdicts.set(v.key, v.equivalent);
  }
  return verdicts;
}

/**
 * Ask, and return whatever came back.
 *
 * Every failure path here is "answer fewer questions", never "answer them
 * wrongly": a subprocess that dies, writes nothing, writes unparseable JSON, or
 * invents a key contributes an empty map or a smaller one, and every unanswered
 * pair stays deferred and drops its problem. That is exactly what
 * `--equivalence defer` does, so the floor this degrades to is the behaviour it
 * was added as an alternative to — no path through here is worse than not
 * having asked.
 */
export async function adjudicateWithClaude(
  questions: OpenQuestion[],
  dir: string,
  opts: { model?: string; timeoutMs: number },
  log: (line: string) => void = () => {}
): Promise<Map<string, boolean>> {
  if (questions.length === 0) return new Map();

  const brief = writeEquivalenceBrief(questions, dir);
  const run = await runClaude(dir, `${brief}${DRIVER_NOTE}`, opts);

  const raw = readJsonIfPresent<unknown>(dir, FILES.verdicts);
  if (raw === null) {
    log(`    adjudicator ${run.ok ? `wrote no ${FILES.verdicts}` : run.detail}`);
    return new Map();
  }
  const parsed = EquivalenceBatchSchema.safeParse(raw);
  if (!parsed.success) {
    log(`    adjudicator output does not match the equivalence schema: ${schemaComplaint(parsed.error)}`);
    return new Map();
  }

  const verdicts = verdictsFor(questions, parsed.data.verdicts);
  const missing = questions.length - verdicts.size;
  if (missing > 0) log(`    adjudicator left ${missing} pair(s) unjudged`);
  return verdicts;
}
