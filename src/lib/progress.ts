import { createServiceClient } from "@/lib/supabase/service";

/**
 * Practice progress, derived rather than stored.
 *
 * Every graded submission and every reveal already writes an `attempts` row,
 * so a set's state is recoverable from history alone — no extra column, no
 * migration, and no way for the client to fabricate a score. `is_correct`
 * carries the whole tri-state: true, false, or null for "gave up and read
 * the solution".
 *
 * Everything here reads `attempt_no = 1` only. A retry is a second row against
 * the same problem, and it is deliberately invisible to every score: the point
 * of offering one is that the student can take it without anything to lose.
 */

/** true = correct, false = wrong, null = revealed. Absent = not attempted. */
export type Outcome = boolean | null;

export type SetProgress = {
  /** Latest outcome per problem id. */
  outcomes: Record<string, Outcome>;
  attempted: number;
  correct: number;
  revealed: number;
};

const EMPTY: SetProgress = { outcomes: {}, attempted: 0, correct: 0, revealed: 0 };

function summarize(outcomes: Record<string, Outcome>): SetProgress {
  let correct = 0;
  let revealed = 0;
  for (const v of Object.values(outcomes)) {
    if (v === true) correct++;
    else if (v === null) revealed++;
  }
  return { outcomes, attempted: Object.keys(outcomes).length, correct, revealed };
}

export async function loadSetProgress(
  setId: string,
  userId: string
): Promise<SetProgress> {
  const db = createServiceClient();
  const { data } = await db
    .from("attempts")
    .select("problem_id, is_correct")
    .eq("set_id", setId)
    .eq("user_id", userId)
    .eq("attempt_no", 1)
    .order("created_at", { ascending: true });

  if (!data) return EMPTY;

  const outcomes: Record<string, Outcome> = {};
  for (const row of data as { problem_id: string; is_correct: boolean | null }[]) {
    outcomes[row.problem_id] = row.is_correct;
  }
  return summarize(outcomes);
}

export type SetTally = { attempted: number; correct: number; revealed: number };

/**
 * Progress for many sets at once — one query for a whole library page rather
 * than one per row.
 */
export async function loadProgressForSets(
  setIds: string[],
  userId: string
): Promise<Map<string, SetTally>> {
  const tallies = new Map<string, SetTally>();
  if (setIds.length === 0) return tallies;

  const db = createServiceClient();
  const { data } = await db
    .from("attempts")
    .select("set_id, problem_id, is_correct")
    .in("set_id", setIds)
    .eq("user_id", userId)
    .eq("attempt_no", 1)
    .order("created_at", { ascending: true });

  if (!data) return tallies;

  // Collapse to one outcome per (set, problem) before counting, so a problem
  // answered twice isn't tallied twice.
  const latest = new Map<string, Map<string, Outcome>>();
  for (const row of data as {
    set_id: string;
    problem_id: string;
    is_correct: boolean | null;
  }[]) {
    let perSet = latest.get(row.set_id);
    if (!perSet) latest.set(row.set_id, (perSet = new Map()));
    perSet.set(row.problem_id, row.is_correct);
  }

  for (const [setId, perSet] of latest) {
    let correct = 0;
    let revealed = 0;
    for (const v of perSet.values()) {
      if (v === true) correct++;
      else if (v === null) revealed++;
    }
    tallies.set(setId, { attempted: perSet.size, correct, revealed });
  }
  return tallies;
}

export type UserStats = {
  answered: number;
  correct: number;
  /** Percentage, rounded. Null when nothing has been graded yet. */
  accuracy: number | null;
  /** Distinct days with at least one attempt, over the last 7 days. */
  activeDays: number;
};

export async function loadUserStats(userId: string): Promise<UserStats> {
  const db = createServiceClient();
  // Ordered so the cap drops the oldest history rather than an arbitrary slice.
  // Deliberately a narrower query than `loadStatsSnapshot` — the home page
  // shouldn't pay for the catalog join to render three tiles.
  const { data } = await db
    .from("attempts")
    .select("is_correct, created_at")
    .eq("user_id", userId)
    .eq("attempt_no", 1)
    .order("created_at", { ascending: false })
    .limit(2000);

  const rows = (data ?? []) as { is_correct: boolean | null; created_at: string }[];

  let answered = 0;
  let correct = 0;
  const days = new Set<string>();
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  for (const r of rows) {
    // Reveals are practice, but they aren't answers — they'd drag accuracy
    // down in a way that reads as punishment for asking for help.
    if (r.is_correct !== null) {
      answered++;
      if (r.is_correct) correct++;
    }
    const t = new Date(r.created_at).getTime();
    if (t >= weekAgo) days.add(new Date(r.created_at).toDateString());
  }

  return {
    answered,
    correct,
    accuracy: answered > 0 ? Math.round((correct / answered) * 100) : null,
    activeDays: days.size,
  };
}
