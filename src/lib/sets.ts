import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { newShareCode } from "@/lib/share-code";
import {
  problemHashInput,
  splitProblem,
  type AuthoredPlot,
  type GeneratedProblem,
  type GraphResponseKind,
  type ProblemFormat,
  type ProblemStyle,
  type SanitizedProblem,
  type TaggedProblem,
} from "@/lib/ai/schemas";
import { generateProblems, repairProblem, type TopicInfo } from "@/lib/ai/generate";
import { solveIndependently, solverAgrees, verifyProblem } from "@/lib/ai/verify";
import { AI_CONCURRENCY, createCallPool } from "@/lib/ai/provider";
import { asyncQueue } from "@/lib/async-queue";
import { instantiate, templatesFor } from "@/lib/templates";
import { capFor, CAP_CHECK_FAILED, startOfToday } from "@/lib/limits";


export type SetConfig = {
  topicIds: string[];
  count: number;
  difficulty: number;
  styles: ProblemStyle[];
  formats: ProblemFormat[];
  title?: string;
  /**
   * A set built against this student's own practice record. Derived server-side
   * from their `attempts` and never accepted from a request body — `directives`
   * lands verbatim in the authoring prompt, so the route may only ever take a
   * plan id and rebuild this itself.
   */
  focus?: { label: string; directives: string[] };
};

export type BuildEvent =
  | { type: "status"; message: string }
  | { type: "progress"; done: number; total: number }
  | { type: "complete"; setId: string }
  | { type: "error"; message: string };

const POOL_FRACTION = 0.5;
const MAX_COUNT = 15;
/** Headroom under the route's 300s `maxDuration`, counted from the request. */
export const BUILD_BUDGET_MS = 230_000;

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

type VerifiedProblem = { problem: TaggedProblem; verification: unknown };

/**
 * Verify one authored problem, with a single repair attempt when the solver
 * disagreed. Returns null for anything that should be discarded.
 *
 * Up to three model calls, and it deliberately holds one pool slot for all of
 * them: a repair is the tail of one verification, not a new piece of work
 * entitled to its own share of the RPM budget.
 */
async function verifyOrRepair(
  p: TaggedProblem,
  difficulty: number
): Promise<VerifiedProblem | null> {
  const outcome = await verifyProblem(p, difficulty);
  if (outcome.ok) {
    return {
      problem: p,
      verification: {
        status: "verified",
        method: "independent-solve",
        solver_answer: outcome.solver?.final_answer_latex,
        difficulty_estimate: outcome.solver?.difficulty_estimate,
      },
    };
  }
  // a repair needs a solver disagreement to adjudicate
  if (!outcome.solver) return null;
  const fixed = await repairProblem(p, outcome.solver);
  if (!fixed) return null;
  const recheck = await solveIndependently(fixed);
  if (!recheck || !recheck.is_well_posed || !solverAgrees(fixed, recheck)) return null;
  return {
    // repair rewrites the problem but not what topic it belongs to
    problem: { ...fixed, topic_index: p.topic_index },
    verification: {
      status: "repaired",
      method: "independent-solve",
      original_issue: outcome.reason,
      solver_answer: recheck.final_answer_latex,
    },
  };
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
  config: SetConfig,
  /**
   * When the request that owns this build started. Anything the route does
   * first — a coach read on the targeted path can burn 45s — is charged to the
   * same invocation, so the budget has to be measured from there rather than
   * from whenever this generator happens to be pulled.
   */
  requestStartedAt: number = Date.now()
): AsyncGenerator<BuildEvent> {
  const db = createServiceClient();
  const count = Math.min(Math.max(config.count, 1), MAX_COUNT);

  // --- daily cap ---
  // Only sets that actually cost a model call count. Review sets and copies of
  // shared sets are assembled from problems that already exist, so counting
  // them would let a student spend their whole generation allowance on sets
  // that never used it. Both carry their own separate daily bound.
  const { count: todayCount, error: countErr } = await db
    .from("problem_sets")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId)
    .is("config->>review", null)
    .is("config->>copiedFrom", null)
    .gte("created_at", startOfToday().toISOString());
  if (countErr) {
    yield { type: "error", message: CAP_CHECK_FAILED };
    return;
  }
  const cap = capFor("generatedSets", isAnonymous);
  if ((todayCount ?? 0) >= cap) {
    yield {
      type: "error",
      message: isAnonymous
        ? `Daily limit reached for guests (${cap} sets). Sign in with Google for a higher limit.`
        : `Daily limit reached (${cap} sets). Try again tomorrow.`,
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

  /**
   * Phase timing, the other half of the per-call trace in `callStructured`.
   *
   * One tells you which model calls were slow; this tells you whether a build
   * was in model time at all, and which phase spent it. Answering "why did that
   * take two minutes" needs both — the pool and template phases are supposed to
   * be free, and the only way to notice they stopped being free is to time them.
   */
  let lastMark = Date.now();
  const mark = (phase: string, extra = "") => {
    const now = Date.now();
    console.info(`[lemma:build] phase=${phase} ms=${now - lastMark}${extra && ` ${extra}`}`);
    lastMark = now;
  };

  // --- 1. pool reuse ---
  yield { type: "status", message: "Checking the problem pool..." };
  const { data: recent } = await db
    .from("attempts")
    .select("problem_id")
    .eq("user_id", userId)
    .gte("created_at", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
    .limit(500);
  const seenIds = new Set((recent ?? []).map((r) => r.problem_id as string));

  // Pool problems are generic by construction — they were authored for whoever
  // asked first. A set advertised as designed for you has to be written for you,
  // so a targeted build skips reuse and pays the AI cost for every slot.
  const poolTarget = config.focus ? 0 : Math.floor(count * POOL_FRACTION);
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
  mark("pool", `reused=${chosen.length}`);

  // A targeted set aims at the problems this student got wrong, which is exactly
  // where the author is most likely to land on something they have already seen.
  // Their recent statements go in as negative examples.
  let seenStatements: string[] = [];
  if (config.focus && seenIds.size > 0) {
    const { data: seenRows } = await db
      .from("problems")
      .select("content")
      .in("id", [...seenIds].slice(0, 60));
    seenStatements = (seenRows ?? [])
      .map((r) => (r.content as { statement_latex?: string })?.statement_latex ?? "")
      .filter(Boolean);
  }

  // --- 2. templates ---
  // Templates are deterministic drills; they can't be aimed at a misconception,
  // so a targeted set skips them for the same reason it skips the pool.
  const templateSlots = config.focus ? 0 : count - chosen.length;
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
  mark("templates", `filled=${chosen.length}`);

  // --- 3. AI generation + verification ---
  // Stop starting new AI rounds once we're close to the route's maxDuration:
  // a short set that arrives beats a full one the platform kills mid-flight.
  const buildDeadline = requestStartedAt + BUILD_BUDGET_MS;
  // One pool for the whole build. Authoring and verification overlap and both
  // fan out, so a limit each would burst to the sum of the two — see
  // `createCallPool`.
  const pool = createCallPool(AI_CONCURRENCY);
  let aiNeeded = count - chosen.length;
  let regenAttempted = false;
  while (aiNeeded > 0 && Date.now() < buildDeadline) {
    yield {
      type: "status",
      message: regenAttempted
        ? "Regenerating a few problems that failed checks..."
        : "Writing new problems with AI...",
    };

    const events = asyncQueue<BuildEvent>();
    const verified: VerifiedProblem[] = [];
    const wanted = aiNeeded;
    let announced = false;

    // Reports a generation failure as a value rather than rejecting, so the
    // events already queued behind it still reach the student.
    const round = (async (): Promise<unknown> => {
      const checks: Promise<void>[] = [];
      let failure: unknown;
      try {
        await generateProblems(
          {
            topics: topicInfos,
            count: wanted,
            difficulty: config.difficulty,
            styles: config.styles,
            formats: config.formats,
            avoid: [...chosen.map((c) => c.statement), ...seenStatements].filter(Boolean),
            focus: config.focus?.directives,
          },
          {
            pool,
            // Check each batch the moment it lands. The two phases used to be
            // barriers, so the checker sat idle through the slowest kind's call
            // and the writer sat idle through every solve.
            onBatch: (batch) => {
              if (!announced) {
                announced = true;
                events.push({
                  type: "status",
                  message: "Verifying every problem independently...",
                });
              }
              for (const p of batch) {
                checks.push(
                  pool(() => verifyOrRepair(p, config.difficulty)).then((result) => {
                    if (!result) return;
                    verified.push(result);
                    // Counts what has passed, not what is finally stored. The
                    // meter's job is to show the build moving, and it otherwise
                    // reads zero for the whole of the longest phase.
                    events.push({
                      type: "progress",
                      done: Math.min(count, done + verified.length),
                      total: count,
                    });
                  })
                );
              }
            },
          }
        );
      } catch (err) {
        failure = err;
      }
      await Promise.all(checks);
      return failure;
    })().finally(() => events.close());

    for await (const event of events.drain()) yield event;
    const failure = await round;

    // A capacity failure now only ends the build when it took everything with
    // it; the calls that ran alongside the failed one may still have landed.
    if (failure && verified.length === 0) {
      // Anything already gathered from the pool and templates is still good
      // practice — deliver it rather than throwing the whole set away.
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
        message: `AI generation failed: ${
          failure instanceof Error ? failure.message : "unknown error"
        }`,
      };
      return;
    }

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
    mark(regenAttempted ? "ai-regen" : "ai-round", `wanted=${wanted} kept=${verified.length}`);

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
  // A bare "+" before the em dash read as a typo ("One-step equations + —
   // level 2"), so the count it stands for is spelled out.
  const named = topicInfos.map((t) => t.title);
  const extra = named.length - 2;
  const title =
    config.title ??
    `${named.slice(0, 2).join(" & ")}${extra > 0 ? ` +${extra} more` : ""} — level ${config.difficulty}`;
  const { data: set, error: setErr } = await db
    .from("problem_sets")
    .insert({
      owner_id: userId,
      title,
      share_code: newShareCode(),
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

  // Measured from the request, not from here: on a targeted build the coach
  // read runs before this generator is first pulled, and it is charged to the
  // same 300s invocation.
  mark("save");
  console.info(
    `[lemma:build] done ms=${Date.now() - requestStartedAt} delivered=${chosen.length} asked=${count}`
  );

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

export type SetMeta = {
  id: string;
  title: string;
  share_code: string;
  config: SetConfig;
  created_at: string;
};

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
      items?: { id: string; latex: string }[];
      left?: { id: string; latex: string }[];
      right?: { id: string; latex: string }[];
      parts?: { label: string; prompt_latex: string }[];
      plot?: AuthoredPlot;
      response_kind?: GraphResponseKind;
      sketch_kind?: string;
    };
    topics: { title: string } | null;
  } | null;
};

/**
 * The one place a stored problem becomes something a client may see.
 *
 * It reads only from `content`; `answer` and `explanation` are never selected,
 * so no caller can leak them by forgetting to strip a field. Shared by the
 * owner's view and the share-link preview, which is why it takes rows rather
 * than a set id — the entitlement question is the caller's to answer.
 */
export function sanitizeItems(items: unknown): SanitizedProblem[] {
  return ((items ?? []) as unknown as ItemRow[])
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
      items: i.problems!.content.items,
      left: i.problems!.content.left,
      right: i.problems!.content.right,
      parts: i.problems!.content.parts,
      plot: i.problems!.content.plot,
      response_kind: i.problems!.content.response_kind,
      sketch_kind: i.problems!.content.sketch_kind,
      topic_title: i.problems!.topics?.title,
    }));
}

export const ITEM_SELECT =
  "position, problems(id, style, format, difficulty, content, topics(title))";

/** Load a set with sanitized problems (answers stripped) after verifying ownership. */
export async function loadSetForUser(
  setId: string,
  userId: string
): Promise<{ set: SetMeta; problems: SanitizedProblem[] } | null> {
  const db = createServiceClient();
  const { data: set } = await db
    .from("problem_sets")
    .select("id, title, share_code, config, created_at, owner_id")
    .eq("id", setId)
    .single();
  if (!set || set.owner_id !== userId) return null;

  const { data: items } = await db
    .from("problem_set_items")
    .select(ITEM_SELECT)
    .eq("set_id", setId)
    .order("position");

  return {
    set: {
      id: set.id,
      title: set.title,
      share_code: set.share_code,
      config: set.config as SetConfig,
      created_at: set.created_at,
    },
    problems: sanitizeItems(items),
  };
}
