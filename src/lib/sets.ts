import { createHash } from "crypto";
import { customAlphabet } from "nanoid";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import {
  problemHashInput,
  splitProblem,
  type GeneratedProblem,
  type ProblemFormat,
  type ProblemStyle,
  type SanitizedProblem,
  type TaggedProblem,
} from "@/lib/ai/schemas";
import { generateProblems, repairProblem, type TopicInfo } from "@/lib/ai/generate";
import { mapConcurrent, solveIndependently, solverAgrees, verifyProblem } from "@/lib/ai/verify";
import { AI_CONCURRENCY } from "@/lib/ai/provider";
import { instantiate, templatesFor } from "@/lib/templates";

const shareCode = customAlphabet("ABCDEFGHJKMNPQRSTUVWXYZ23456789", 8);

export type SetConfig = {
  topicIds: string[];
  count: number;
  difficulty: number;
  styles: ProblemStyle[];
  formats: ProblemFormat[];
  title?: string;
};

export type BuildEvent =
  | { type: "status"; message: string }
  | { type: "progress"; done: number; total: number }
  | { type: "complete"; setId: string }
  | { type: "error"; message: string };

const POOL_FRACTION = 0.5;
const MAX_COUNT = 15;

type NewProblemRow = {
  topic_id: string;
  style: ProblemStyle;
  format: ProblemFormat;
  difficulty: number;
  content: unknown;
  answer: unknown;
  explanation: unknown;
  source: "template" | "ai";
  template_id: string | null;
  content_hash: string;
  verification: unknown;
};

function hashOf(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function rowFromGenerated(
  p: GeneratedProblem,
  topicId: string,
  source: "template" | "ai",
  templateId: string | null,
  verification: unknown
): NewProblemRow {
  const { content, answer, explanation } = splitProblem(p);
  return {
    topic_id: topicId,
    style: p.style,
    format: p.format,
    difficulty: Math.min(5, Math.max(1, Math.round(p.difficulty))),
    content,
    answer,
    explanation,
    source,
    template_id: templateId,
    content_hash: hashOf(templateId ?? problemHashInput(p)),
    verification,
  };
}

/**
 * Build a problem set: pool reuse -> templates -> AI generate + verify.
 * Yields progress events; final event carries the new set id.
 */
export async function* buildProblemSet(
  userId: string,
  isAnonymous: boolean,
  config: SetConfig
): AsyncGenerator<BuildEvent> {
  const db = createServiceClient();
  const count = Math.min(Math.max(config.count, 1), MAX_COUNT);

  // --- daily cap ---
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const { count: todayCount } = await db
    .from("problem_sets")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId)
    .gte("created_at", since.toISOString());
  const cap = isAnonymous ? 5 : 20;
  if ((todayCount ?? 0) >= cap) {
    yield {
      type: "error",
      message: isAnonymous
        ? "Daily limit reached for guests (5 sets). Sign in with Google for a higher limit."
        : "Daily limit reached (20 sets). Try again tomorrow.",
    };
    return;
  }

  // --- topic info ---
  const { data: topicRows, error: topicErr } = await db
    .from("topics")
    .select("id, slug, title, description, units(title, courses(title))")
    .in("id", config.topicIds);
  if (topicErr || !topicRows || topicRows.length === 0) {
    yield { type: "error", message: "Selected topics not found." };
    return;
  }
  type TopicRow = {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    units: { title: string; courses: { title: string } | null } | null;
  };
  const topics = topicRows as unknown as TopicRow[];
  const topicInfos: TopicInfo[] = topics.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    unit_title: t.units?.title,
    course_title: t.units?.courses?.title,
  }));

  const chosen: { problemId: string; statement: string }[] = [];
  let done = 0;
  const tick = (): BuildEvent => ({ type: "progress", done, total: count });

  // --- 1. pool reuse ---
  yield { type: "status", message: "Checking the problem pool..." };
  const { data: recent } = await db
    .from("attempts")
    .select("problem_id")
    .eq("user_id", userId)
    .gte("created_at", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
    .limit(500);
  const seenIds = new Set((recent ?? []).map((r) => r.problem_id as string));

  const poolTarget = Math.floor(count * POOL_FRACTION);
  if (poolTarget > 0) {
    const { data: pool } = await db
      .from("problems")
      .select("id, content, times_served")
      .in("topic_id", config.topicIds)
      .in("style", config.styles)
      .in("format", config.formats)
      .eq("difficulty", config.difficulty)
      .eq("status", "active")
      .order("times_served", { ascending: true })
      .limit(poolTarget * 3);
    for (const row of pool ?? []) {
      if (chosen.length >= poolTarget) break;
      if (seenIds.has(row.id)) continue;
      chosen.push({
        problemId: row.id,
        statement: (row.content as { statement_latex?: string })?.statement_latex ?? "",
      });
      done++;
    }
    if (chosen.length > 0) {
      await db.rpc("bump_times_served", { ids: chosen.map((c) => c.problemId) });
      yield tick();
    }
  }

  // --- 2. templates ---
  const templateSlots = count - chosen.length;
  if (templateSlots > 0) {
    const eligible = topics.flatMap((t) =>
      templatesFor(t.slug, config.difficulty, config.styles, config.formats).map((e) => ({
        ...e,
        topicId: t.id,
      }))
    );
    if (eligible.length > 0) {
      yield { type: "status", message: "Generating drill problems..." };
      // Use templates for at most half the remaining slots when AI styles/formats
      // are also requested, else fill everything.
      const aiPossible =
        config.styles.some((s) => s !== "drill") || eligible.length === 0;
      const fillTarget = aiPossible
        ? Math.ceil(templateSlots / 2)
        : templateSlots;
      const rows: NewProblemRow[] = [];
      for (let i = 0; i < fillTarget; i++) {
        const pick = eligible[i % eligible.length];
        const inst = instantiate(pick.template, pick.format, config.difficulty);
        rows.push(
          rowFromGenerated(inst.problem, pick.topicId, "template", inst.templateId, {
            status: "verified",
            method: "computed",
          })
        );
      }
      const inserted = await insertProblems(db, rows);
      for (const row of inserted) {
        chosen.push({ problemId: row.id, statement: row.statement });
        done++;
      }
      yield tick();
    }
  }

  // --- 3. AI generation + verification ---
  // Stop starting new AI rounds once we're close to the route's maxDuration:
  // a short set that arrives beats a full one the platform kills mid-flight.
  const buildDeadline = Date.now() + 230_000;
  let aiNeeded = count - chosen.length;
  let regenAttempted = false;
  while (aiNeeded > 0 && Date.now() < buildDeadline) {
    yield {
      type: "status",
      message: regenAttempted
        ? "Regenerating a few problems that failed checks..."
        : "Writing new problems with AI...",
    };
    let generated: TaggedProblem[] = [];
    try {
      generated = await generateProblems({
        topics: topicInfos,
        count: aiNeeded,
        difficulty: config.difficulty,
        styles: config.styles,
        formats: config.formats,
        avoid: chosen.map((c) => c.statement).filter(Boolean),
      });
    } catch (err) {
      // Capacity failures are routine on a free tier. Anything already gathered
      // from the pool and templates is still good practice — deliver it rather
      // than throwing the whole set away.
      if (chosen.length > 0) {
        yield {
          type: "status",
          message: `The AI writer is busy right now, so this set has ${chosen.length} problem${
            chosen.length === 1 ? "" : "s"
          } instead of ${count}.`,
        };
        break;
      }
      yield {
        type: "error",
        message: `AI generation failed: ${err instanceof Error ? err.message : "unknown error"}`,
      };
      return;
    }

    yield { type: "status", message: "Verifying every problem independently..." };
    const verified: { problem: TaggedProblem; verification: unknown }[] = [];
    await mapConcurrent(generated, AI_CONCURRENCY, async (p) => {
      const outcome = await verifyProblem(p, config.difficulty);
      if (outcome.ok) {
        verified.push({
          problem: p,
          verification: {
            status: "verified",
            method: "independent-solve",
            solver_answer: outcome.solver?.final_answer_latex,
            difficulty_estimate: outcome.solver?.difficulty_estimate,
          },
        });
        return;
      }
      // one repair attempt when we have a solver disagreement to adjudicate
      if (outcome.solver) {
        const fixed = await repairProblem(p, outcome.solver);
        if (fixed) {
          const recheck = await solveIndependently(fixed);
          if (recheck && recheck.is_well_posed && solverAgrees(fixed, recheck)) {
            verified.push({
              // repair rewrites the problem but not what topic it belongs to
              problem: { ...fixed, topic_index: p.topic_index },
              verification: {
                status: "repaired",
                method: "independent-solve",
                original_issue: outcome.reason,
                solver_answer: recheck.final_answer_latex,
              },
            });
          }
        }
      }
    });

    const rows = verified
      .slice(0, aiNeeded)
      .map((v) =>
        rowFromGenerated(
          v.problem,
          topicInfos[v.problem.topic_index].id,
          "ai",
          null,
          v.verification
        )
      );
    const inserted = await insertProblems(db, rows);
    for (const row of inserted) {
      if (chosen.length >= count) break;
      chosen.push({ problemId: row.id, statement: row.statement });
      done++;
    }
    yield tick();

    aiNeeded = count - chosen.length;
    if (aiNeeded > 0) {
      if (regenAttempted) break; // deliver what we have
      regenAttempted = true;
    }
  }

  if (chosen.length === 0) {
    yield { type: "error", message: "Could not generate any problems that passed verification. Try different settings." };
    return;
  }

  // --- 4. create the set ---
  const title =
    config.title ??
    `${topicInfos.map((t) => t.title).slice(0, 2).join(" & ")}${topicInfos.length > 2 ? " +" : ""} — level ${config.difficulty}`;
  const { data: set, error: setErr } = await db
    .from("problem_sets")
    .insert({
      owner_id: userId,
      title,
      share_code: shareCode(),
      config: { ...config, delivered: chosen.length },
    })
    .select("id")
    .single();
  if (setErr || !set) {
    yield { type: "error", message: "Failed to save the problem set." };
    return;
  }
  const items = chosen.map((c, i) => ({
    set_id: set.id,
    problem_id: c.problemId,
    position: i + 1,
  }));
  const { error: itemsErr } = await db.from("problem_set_items").insert(items);
  if (itemsErr) {
    yield { type: "error", message: "Failed to save the problem set items." };
    return;
  }

  yield { type: "complete", setId: set.id };
}

async function insertProblems(
  db: SupabaseClient,
  rows: NewProblemRow[]
): Promise<{ id: string; statement: string }[]> {
  if (rows.length === 0) return [];
  const { data, error } = await db
    .from("problems")
    .upsert(rows, { onConflict: "topic_id,content_hash" })
    .select("id, content");
  if (error) throw new Error(`insert problems failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    statement: (r.content as { statement_latex?: string })?.statement_latex ?? "",
  }));
}

/** Load a set with sanitized problems (answers stripped) after verifying ownership. */
export async function loadSetForUser(
  setId: string,
  userId: string
): Promise<{
  set: { id: string; title: string; share_code: string; config: SetConfig; created_at: string };
  problems: SanitizedProblem[];
} | null> {
  const db = createServiceClient();
  const { data: set } = await db
    .from("problem_sets")
    .select("id, title, share_code, config, created_at, owner_id")
    .eq("id", setId)
    .single();
  if (!set || set.owner_id !== userId) return null;

  const { data: items } = await db
    .from("problem_set_items")
    .select("position, problems(id, style, format, difficulty, content, topics(title))")
    .eq("set_id", setId)
    .order("position");

  type ItemRow = {
    position: number;
    problems: {
      id: string;
      style: ProblemStyle;
      format: ProblemFormat;
      difficulty: number;
      content: {
        statement_latex: string;
        hint: string | null;
        choices?: { id: string; latex: string }[];
        blanks_count?: number;
      };
      topics: { title: string } | null;
    } | null;
  };

  const problems: SanitizedProblem[] = ((items ?? []) as unknown as ItemRow[])
    .filter((i) => i.problems)
    .map((i) => ({
      id: i.problems!.id,
      position: i.position,
      style: i.problems!.style,
      format: i.problems!.format,
      difficulty: i.problems!.difficulty,
      statement_latex: i.problems!.content.statement_latex,
      hint: i.problems!.content.hint,
      choices: i.problems!.content.choices,
      blanks_count: i.problems!.content.blanks_count,
      topic_title: i.problems!.topics?.title,
    }));

  return {
    set: {
      id: set.id,
      title: set.title,
      share_code: set.share_code,
      config: set.config as SetConfig,
      created_at: set.created_at,
    },
    problems,
  };
}
