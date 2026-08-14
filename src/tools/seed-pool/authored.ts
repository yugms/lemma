/**
 * The authored file, read the same way by both steps that read it.
 *
 * `solve` numbers the problems and `ingest` pairs solutions back onto them by
 * that number, so the two have to agree exactly on which problems survived and
 * in what order. One function, called by both, is what makes that true by
 * construction rather than by two filters that happen to match today.
 */
import { MixedBatchSchema, type TaggedProblem } from "@/lib/ai/schemas";
import { structuralCheck } from "@/lib/ai/structural-check";
import { clampDifficulty } from "@/lib/ai/kinds";
import { FILES, readJson, type SeedPlan } from "@/tools/seed-pool/shared";

export type Dropped = { position: number; reason: string; statement: string };

export type LoadedAuthored = {
  /** Survivors, in file order. Their 1-based position here is the `problem_number`. */
  problems: TaggedProblem[];
  dropped: Dropped[];
};

const preview = (value: unknown): string => {
  const statement = (value as { statement_latex?: unknown } | null)?.statement_latex;
  const text = typeof statement === "string" ? statement : JSON.stringify(value);
  return text.length > 90 ? `${text.slice(0, 90)}...` : text;
};

/**
 * Validate and normalize one authored batch.
 *
 * Problems are parsed one at a time rather than as a batch, which the pipeline
 * has no reason to do and this does: a model's malformed batch is discarded
 * whole and re-requested, but this file was written by hand and will be fixed by
 * hand, so "problem 7 has no `correct_choice_id`" is worth far more than the
 * whole file failing to parse.
 *
 * Failures are dropped and reported rather than thrown. A batch where two of
 * twelve need another pass should still get the other ten solved.
 */
export function normalizeAuthored(raw: unknown, plan: SeedPlan): LoadedAuthored {
  const candidates = (raw as { problems?: unknown })?.problems;
  if (!Array.isArray(candidates)) {
    throw new Error(`expected an object with a "problems" array`);
  }

  const problems: TaggedProblem[] = [];
  const dropped: Dropped[] = [];

  candidates.forEach((candidate, i) => {
    const position = i + 1;
    // One at a time through the batch schema, so the union's discrimination and
    // every field rule apply exactly as they do to model output — without
    // needing a second export of the per-problem schema that could drift.
    const parsed = MixedBatchSchema.safeParse({ problems: [candidate] });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      dropped.push({
        position,
        reason: `schema: ${issue?.path.slice(2).join(".") || "(root)"} — ${issue?.message ?? "invalid"}`,
        statement: preview(candidate),
      });
      return;
    }

    const p = parsed.data.problems[0];
    const normalized: TaggedProblem = {
      ...p,
      // Clamped, not discarded — the same call the pipeline makes, for the same
      // reason: a bad index is a tagging slip on an otherwise fine problem.
      topic_index: Math.min(Math.max(p.topic_index, 0), plan.topics.length - 1),
      // The row takes a clamped difficulty anyway; doing it here means the
      // difficulty gate below judges the number that will actually be stored.
      difficulty: clampDifficulty(p.difficulty),
    };

    const structural = structuralCheck(normalized);
    if (!structural.ok) {
      dropped.push({
        position,
        reason: `structural: ${structural.reason ?? "failed"}`,
        statement: preview(candidate),
      });
      return;
    }
    problems.push(normalized);
  });

  return { problems, dropped };
}

export function loadAuthored(dir: string, plan: SeedPlan): LoadedAuthored {
  const raw = readJson<unknown>(
    dir,
    FILES.authored,
    `write it from ${dir}/${FILES.authoringBrief}`
  );
  return normalizeAuthored(raw, plan);
}

export function reportDropped(dropped: Dropped[]): void {
  if (dropped.length === 0) return;
  console.log(
    `\n${dropped.length} problem${dropped.length === 1 ? "" : "s"} dropped before solving:`
  );
  for (const d of dropped) console.log(`  [${d.position}] ${d.reason}\n        ${d.statement}`);
  console.log(
    `\nFix them in ${FILES.authored} and re-run this step; the numbering below counts survivors only.`
  );
}
