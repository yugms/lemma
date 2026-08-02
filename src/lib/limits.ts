import { createServiceClient } from "@/lib/supabase/service";

/**
 * Every daily bound in one table.
 *
 * These exist to keep one user from spending the shared model quota. The app
 * runs on a free Gemini key, so "uncapped" is not a generous default — it is a
 * single motivated visitor taking the service down for everyone else.
 *
 * Anonymous sign-in is issued by Supabase straight to the browser, so nothing
 * here ever sees it: a determined abuser can mint fresh guest sessions and get
 * a fresh allowance each time. Per-user caps bound accidental and casual
 * overuse, which is most of it. The actual defence against farming is Supabase's
 * own auth rate limiting, which is a dashboard setting and not in this repo.
 */
export const DAILY_LIMITS = {
  /** Sets that cost model calls. Review sets and copies are counted separately. */
  generatedSets: { guest: 5, member: 20 },
  /** Assembled from problems already earned — two inserts, no model call. */
  reviewSets: { guest: 10, member: 10 },
  /** Copies of a shared set. Free to make, bounded on their own terms. */
  sharedCopies: { guest: 10, member: 10 },
  /** Worksheet scans. Each one is a multi-image vision call — the priciest thing here. */
  scans: { guest: 5, member: 20 },
  /**
   * Model calls made while grading: the misconception diagnosis on a wrong
   * answer, and the equivalence check on an answer local comparison can't
   * settle.
   *
   * Set high enough that ordinary practice never reaches it — a long session is
   * tens of problems, not hundreds — because being over this budget degrades
   * what a student gets back.
   */
  aiGrading: { guest: 60, member: 200 },
} as const;

export type LimitKind = keyof typeof DAILY_LIMITS;

export function capFor(kind: LimitKind, isAnonymous: boolean): number {
  const limit = DAILY_LIMITS[kind];
  return isAnonymous ? limit.guest : limit.member;
}

/** Local midnight — the boundary every cap here counts from. */
export function startOfToday(): Date {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  return since;
}

/**
 * Whether a scan may proceed.
 *
 * Counts every upload row, including ones that failed to grade: a failed scan
 * still spent the vision call, so charging only for successes would make
 * failures the cheapest way to burn the quota.
 */
export async function scanAllowance(
  userId: string,
  isAnonymous: boolean
): Promise<{ ok: true } | { ok: false; message: string }> {
  const db = createServiceClient();
  const { count } = await db
    .from("worksheet_uploads")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startOfToday().toISOString());

  const cap = capFor("scans", isAnonymous);
  if ((count ?? 0) < cap) return { ok: true };
  return {
    ok: false,
    message: isAnonymous
      ? `Daily limit reached for guests (${cap} scans). Sign in with Google for a higher limit.`
      : `Daily limit reached (${cap} scans). Try again tomorrow.`,
  };
}

/**
 * Whether grading may still spend model calls for this user today.
 *
 * Counted from attempts that carry a stored diagnosis, which is the number of
 * feedback calls actually made. Equivalence checks are gated by the same budget
 * without being counted by it — they are rare next to feedback, and a user who
 * has already spent a full day's feedback allowance is not the case this is
 * trying to be precise about.
 *
 * Returning false must never cost a student their grade. Callers fall back to
 * the local `normalizeMath` verdict, which is what already happens whenever the
 * provider is down, and skip the diagnosis — losing the explanation, not the
 * mark.
 */
export async function aiGradingAllowed(
  userId: string,
  isAnonymous: boolean
): Promise<boolean> {
  const db = createServiceClient();
  const { count, error } = await db
    .from("attempts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .not("ai_feedback", "is", null)
    .gte("created_at", startOfToday().toISOString());

  // A failed count must not silently switch grading into its degraded mode —
  // that would quietly change what every student gets back for the rest of the
  // day. Spending the call is the recoverable direction.
  if (error) return true;
  return (count ?? 0) < capFor("aiGrading", isAnonymous);
}
