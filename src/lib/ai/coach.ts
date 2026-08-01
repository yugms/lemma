import { callStructured, CHECKER_MODELS } from "@/lib/ai/provider";
import { COACH_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { CoachReadSchema, type CoachRead } from "@/lib/ai/schemas";
import { createServiceClient } from "@/lib/supabase/service";
import type { StatsScope, StatsSnapshot } from "@/lib/analytics";

/**
 * The written read on a student's weak points, and the directives that make a
 * targeted set targeted.
 *
 * Cached in `coach_reads` against a signature derived from their attempt count
 * and last attempt, so it regenerates when they practise rather than on every
 * page view. Two rows per student at most (one per scope).
 *
 * Returns null when the model gives nothing usable — the page falls back to the
 * computed breakdowns, which are the substance anyway.
 */

const MAX_MISTAKES_SENT = 10;

export function coachSignature(snapshot: StatsSnapshot): string {
  return `${snapshot.totals.answered}:${snapshot.totals.revealed}:${snapshot.lastAttemptAt ?? "none"}`;
}

function buildPrompt(snapshot: StatsSnapshot): string {
  const { totals, byTopic, byFormat, byStyle, byDifficulty, mistakes } = snapshot;

  const line = (label: string, correct: number, attempted: number) =>
    `- ${label}: ${correct}/${attempted} correct (${
      attempted > 0 ? Math.round((correct / attempted) * 100) : 0
    }%)`;

  return `Overall: ${totals.correct}/${totals.answered} correct (${
    totals.accuracy ?? 0
  }%), ${totals.revealed} problems given up on without answering.

By topic:
${byTopic
  .map(
    (t) =>
      `${line(`${t.courseTitle} / ${t.title}`, t.correct, t.attempted)}${
        t.revealed > 0 ? `, ${t.revealed} revealed` : ""
      }`
  )
  .join("\n")}

By format:
${byFormat.map((s) => line(s.label, s.correct, s.attempted)).join("\n")}

By style:
${byStyle.map((s) => line(s.label, s.correct, s.attempted)).join("\n")}

By difficulty:
${byDifficulty.map((s) => line(s.label, s.correct, s.attempted)).join("\n")}

${
  mistakes.length > 0
    ? `Notes written about their actual wrong answers, most frequent first:
${mistakes
  .slice(0, MAX_MISTAKES_SENT)
  .map(
    (m) =>
      `- [${m.topicTitle}]${m.count > 1 ? ` (made ${m.count} times)` : ""} ${m.note}`
  )
  .join("\n")}`
    : "No per-mistake notes are available yet."
}`;
}

async function generate(snapshot: StatsSnapshot): Promise<CoachRead | null> {
  return callStructured({
    models: CHECKER_MODELS,
    system: COACH_SYSTEM_PROMPT,
    prompt: buildPrompt(snapshot),
    schema: CoachReadSchema,
    maxOutputTokens: 4000,
    thinking: "low",
    budgetMs: 45_000,
  });
}

/**
 * `callStructured` throws when every model in the chain is rate-limited or
 * overloaded, on the grounds that a student waiting on a set deserves to hear
 * it. This caller is the exception: the read is commentary on numbers the page
 * has already computed, and a targeted build's config stands on the computed
 * directives alone. Neither should die because the free tier is busy.
 */
async function generateOrNull(snapshot: StatsSnapshot): Promise<CoachRead | null> {
  try {
    return await generate(snapshot);
  } catch {
    return null;
  }
}

/**
 * A read for this snapshot, from cache when the student hasn't practised since
 * it was written.
 *
 * Below a handful of graded attempts there is no pattern to find and the model
 * will invent one, so don't ask.
 */
export async function loadCoachRead(
  userId: string,
  scope: StatsScope,
  snapshot: StatsSnapshot
): Promise<CoachRead | null> {
  if (snapshot.totals.answered < 4) return null;

  const db = createServiceClient();
  const signature = coachSignature(snapshot);

  // A cache lookup that fails just means writing the read again.
  let cached: { signature: string; read: CoachRead } | undefined;
  try {
    const { data } = await db
      .from("coach_reads")
      .select("signature, read")
      .eq("user_id", userId)
      .eq("scope", scope)
      .limit(1);
    cached = (data as { signature: string; read: CoachRead }[] | null)?.[0];
  } catch {
    cached = undefined;
  }
  if (cached?.signature === signature) return cached.read;

  const read = await generateOrNull(snapshot);
  if (!read) return null;

  // A failed write costs a regeneration next time, nothing more.
  try {
    await db
      .from("coach_reads")
      .upsert(
        { user_id: userId, scope, signature, read, updated_at: new Date().toISOString() },
        { onConflict: "user_id,scope" }
      );
  } catch {
    // Ignored deliberately — the read itself is still good.
  }

  return read;
}
