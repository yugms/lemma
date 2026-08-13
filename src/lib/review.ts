import { createServiceClient } from "@/lib/supabase/service";
import { SCORED_MODES, staleBefore } from "@/lib/attempt-state";
import { capFor, CAP_CHECK_FAILED, startOfToday } from "@/lib/limits";
import { newShareCode } from "@/lib/share-code";
import type { ProblemFormat } from "@/lib/ai/schemas";
import type { SetConfig } from "@/lib/sets";

/**
 * The review queue: the problems a student actually got wrong.
 *
 * Retrieval practice on a problem you missed is worth more than a fresh problem
 * on the same topic, and it costs nothing — these problems already exist, are
 * already verified, and the student has already been served them.
 *
 * Building a review set makes a *new* `problem_sets` row. That matters: every
 * outcome is scoped to a set, so the old attempt is neither replayed nor
 * overwritten and the student answers with a clean slate.
 */

export const REVIEW_SET_MAX = 12;

/**
 * Review sets are cheap but not free — each one is two writes and a row in the
 * library. This bounds repeat clicks; it is deliberately separate from the
 * generation cap, which exists to bound model spend. The number itself lives in
 * `limits.ts` with every other daily bound.
 */

export type MissedProblem = {
  problemId: string;
  statementLatex: string;
  topicTitle: string;
  courseTitle: string;
  difficulty: number;
  format: ProblemFormat;
  /** How many times the first attempt on this problem went wrong. */
  misses: number;
  /** True when it was only ever revealed, never actually answered wrong. */
  revealedOnly: boolean;
  /** Later put right on a second attempt — still worth revisiting, but less. */
  recovered: boolean;
  lastAt: string;
};

export type MissRow = {
  problem_id: string;
  is_correct: boolean | null;
  created_at: string;
  problems: {
    difficulty: number;
    format: ProblemFormat;
    content: { statement_latex?: string } | null;
    topics: {
      title: string;
      units: { courses: { title: string } | null } | null;
    } | null;
  } | null;
};

/**
 * Everything the student has missed and not yet put right, worst first.
 *
 * Ranked by miss count, then by age: a problem missed three times outranks one
 * missed yesterday, and among equals the stalest comes first because that is
 * the one closest to being forgotten outright. Problems already put right on a
 * retry sink below the rest — the student has shown they can do those.
 *
 * A problem leaves the queue once the *most recent* first attempt on it was
 * correct. This is the whole point of the page: "Practise these 4" builds a
 * fresh set of exactly these problems, and until this rule existed, getting
 * them all right left the queue saying four. The loop had no exit, and the
 * remedy the page offers could never be seen to work.
 *
 * Most-recent rather than ever-correct, because the evidence expires: someone
 * who answered it right in March and wrong last week has an open gap again.
 */
export async function loadMissed(userId: string, limit = 40): Promise<MissedProblem[]> {
  const db = createServiceClient();

  const [{ data }, { data: retries }] = await Promise.all([
    db
      .from("attempts")
      // Correct rows come back too — they are what closes a problem out, and
      // without them the newest outcome per problem cannot be known.
      .select(
        "problem_id, is_correct, created_at, problems!inner(difficulty, format, content, topics!inner(title, units!inner(courses!inner(title))))"
      )
      .eq("user_id", userId)
      .eq("attempt_no", 1)
      .in("mode", SCORED_MODES)
      .order("created_at", { ascending: false })
      .limit(1000),
    db
      .from("attempts")
      .select("problem_id")
      .eq("user_id", userId)
      .eq("attempt_no", 2)
      .eq("is_correct", true)
      // Ordered so the cap drops the oldest history, not an arbitrary slice.
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  return outstandingMisses(
    (data ?? []) as unknown as MissRow[],
    new Set(((retries ?? []) as { problem_id: string }[]).map((r) => r.problem_id)),
    limit
  );
}

/**
 * The queue rule itself, separated from the query so it can be tested against
 * the orderings that matter — missed then put right, right then missed again,
 * missed twice, revealed only.
 *
 * `rows` must be newest first: that ordering is what makes the first row seen
 * for a problem its deciding outcome.
 */
export function outstandingMisses(
  rows: MissRow[],
  recoveredIds: Set<string>,
  limit = 40
): MissedProblem[] {
  // Problems whose newest first attempt was correct — the gap closed.
  const closed = new Set<string>();
  const decided = new Set<string>();
  for (const row of rows) {
    if (!row.problems?.topics || decided.has(row.problem_id)) continue;
    decided.add(row.problem_id);
    if (row.is_correct === true) closed.add(row.problem_id);
  }

  const byProblem = new Map<string, MissedProblem>();
  for (const row of rows) {
    const p = row.problems;
    if (!p?.topics) continue;
    if (closed.has(row.problem_id)) continue;
    // An older correct answer on a problem that has since been missed again.
    // It is not a miss, and it is no longer evidence of anything.
    if (row.is_correct === true) continue;

    const existing = byProblem.get(row.problem_id);
    if (existing) {
      existing.misses++;
      if (row.is_correct === false) existing.revealedOnly = false;
      if (row.created_at > existing.lastAt) existing.lastAt = row.created_at;
      continue;
    }
    byProblem.set(row.problem_id, {
      problemId: row.problem_id,
      statementLatex: p.content?.statement_latex ?? "",
      topicTitle: p.topics.title,
      courseTitle: p.topics.units?.courses?.title ?? "",
      difficulty: p.difficulty,
      format: p.format,
      misses: 1,
      revealedOnly: row.is_correct === null,
      recovered: recoveredIds.has(row.problem_id),
      lastAt: row.created_at,
    });
  }

  return [...byProblem.values()]
    .sort(
      (a, b) =>
        Number(a.recovered) - Number(b.recovered) ||
        b.misses - a.misses ||
        a.lastAt.localeCompare(b.lastAt)
    )
    .slice(0, limit);
}

export type DueTopic = {
  topicId: string;
  title: string;
  courseTitle: string;
  attempted: number;
  correct: number;
  difficulty: number;
  lastAt: string;
};

const DUE_ROW_LIMIT = 2000;

/**
 * Topics practised before but not lately, and how many misses were later put
 * right.
 *
 * Deliberately not `loadStatsSnapshot`: that pulls 5000 attempts through a
 * four-level join, runs a second query for retries, then computes streaks,
 * a dense activity window, four slice breakdowns and a deduplicated mistake
 * log — of which this page would use exactly two values.
 */
export async function loadDueTopics(
  userId: string
): Promise<{ due: DueTopic[]; recovered: number }> {
  // Read here rather than taking it as an argument: a Server Component body is
  // render, and `react-hooks/purity` rejects a clock read there.
  const now = Date.now();
  const db = createServiceClient();

  const [{ data }, { count }] = await Promise.all([
    db
      .from("attempts")
      .select(
        "is_correct, created_at, problems!inner(difficulty, topics!inner(id, title, units!inner(courses!inner(title))))"
      )
      .eq("user_id", userId)
      .eq("attempt_no", 1)
      // Same reason as the queue: a flashcard rep is not evidence, so it must
      // not make a topic look recently practised either.
      .in("mode", SCORED_MODES)
      .order("created_at", { ascending: false })
      .limit(DUE_ROW_LIMIT),
    db
      .from("attempts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("attempt_no", 2)
      .eq("is_correct", true),
  ]);

  type Row = {
    is_correct: boolean | null;
    created_at: string;
    problems: {
      difficulty: number;
      topics: { id: string; title: string; units: { courses: { title: string } | null } | null } | null;
    } | null;
  };

  const byTopic = new Map<string, DueTopic & { levels: number[] }>();
  for (const r of (data ?? []) as unknown as Row[]) {
    const t = r.problems?.topics;
    if (!t) continue;
    let acc = byTopic.get(t.id);
    if (!acc) {
      acc = {
        topicId: t.id,
        title: t.title,
        courseTitle: t.units?.courses?.title ?? "",
        attempted: 0,
        correct: 0,
        difficulty: 0,
        lastAt: r.created_at,
        levels: [],
      };
      byTopic.set(t.id, acc);
    }
    if (r.is_correct !== null) {
      acc.attempted++;
      if (r.is_correct) acc.correct++;
    }
    acc.levels.push(r.problems!.difficulty);
    if (r.created_at > acc.lastAt) acc.lastAt = r.created_at;
  }

  const cutoff = staleBefore(now);
  const due = [...byTopic.values()]
    .filter((t) => new Date(t.lastAt).getTime() < cutoff)
    .map(({ levels, ...t }) => ({
      ...t,
      // The level they mostly worked it at, so "practise again" resumes there.
      difficulty: levels.sort((a, b) => a - b)[Math.floor(levels.length / 2)] ?? 1,
    }))
    .sort((a, b) => a.lastAt.localeCompare(b.lastAt))
    .slice(0, 6);

  return { due, recovered: count ?? 0 };
}

/**
 * Assemble a set from problems the caller has already missed.
 *
 * No AI, no streaming, no wait — and deliberately outside `buildProblemSet`'s
 * daily cap, which exists to bound generation cost. This costs two inserts.
 *
 * Safe by construction: the problem ids come from the caller's own attempts, so
 * every one is a problem they were already entitled to see.
 */
export async function createReviewSet(
  userId: string,
  problemIds: string[]
): Promise<{ setId: string } | { error: string }> {
  const ids = problemIds.slice(0, REVIEW_SET_MAX);
  if (ids.length === 0) return { error: "Nothing to review yet." };

  const db = createServiceClient();

  const { count: todayCount, error: countErr } = await db
    .from("problem_sets")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId)
    .not("config->>review", "is", null)
    .gte("created_at", startOfToday().toISOString());
  if (countErr) return { error: CAP_CHECK_FAILED };
  // Not `isAnonymous`, because a guest cannot get here: `buildReviewSet` turns
  // them away before this runs, since review needs a practice history that only
  // survives sign-in. The two caps are equal anyway — this stays hardcoded so
  // that a future split of the guest and member numbers does not read as a
  // decision that was made here.
  const reviewCap = capFor("reviewSets", false);
  if ((todayCount ?? 0) >= reviewCap) {
    return { error: `That's ${reviewCap} review sets today — practise one of them first.` };
  }

  // Re-derive entitlement rather than trusting the ids: this is the only place
  // a client-supplied problem id reaches a set the client will then be allowed
  // to read answers from.
  const { data: owned } = await db
    .from("attempts")
    .select("problem_id")
    .eq("user_id", userId)
    .in("problem_id", ids);
  const allowed = new Set(((owned ?? []) as { problem_id: string }[]).map((r) => r.problem_id));
  const verified = ids.filter((id) => allowed.has(id));
  if (verified.length === 0) return { error: "Nothing to review yet." };

  const { data: set, error: setErr } = await db
    .from("problem_sets")
    .insert({
      owner_id: userId,
      title: `Review — ${verified.length} problem${verified.length === 1 ? "" : "s"} you missed`,
      share_code: newShareCode(),
      config: {
        topicIds: [],
        count: verified.length,
        difficulty: 0,
        styles: [],
        formats: [],
        review: true,
      } satisfies SetConfig & { review: true },
    })
    .select("id")
    .single();
  if (setErr || !set) return { error: "Couldn't build the review set." };

  const { error: itemsErr } = await db.from("problem_set_items").insert(
    verified.map((problemId, i) => ({
      set_id: set.id,
      problem_id: problemId,
      position: i + 1,
    }))
  );
  if (itemsErr) return { error: "Couldn't build the review set." };

  return { setId: set.id };
}
