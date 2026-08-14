import { createHash } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { supabaseSecretKey } from "@/lib/env";

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
 * overuse, which is most of it.
 *
 * Farming past them needs a second key, which is `IP_LIMITS` below — a per-user
 * number cannot bound someone who can make users, and signing up with a fresh
 * Google account is *better* than a guest session for that, since it lands on
 * the higher member allowance.
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
   * Study materials analysed. One multimodal call over up to four files, so the
   * spend is the same order as a scan — but this is also the only place a
   * student's own free text is interpreted, which makes the cap the thing that
   * decides how fast someone can iterate on a prompt-injection attempt. Set low
   * for that reason as much as for the money.
   *
   * Analysing a material and then building from it are separate spends: a set
   * built this way also counts against `generatedSets`.
   */
  materials: { guest: 3, member: 10 },
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

/**
 * The second key: what one network may spend, whoever it signs in as.
 *
 * Only the two routes that actually cost money are covered. The numbers are set
 * by a constraint that pulls the opposite way from the usual one — a class or a
 * library shares a single address, so a bound tight enough to be interesting
 * against a script is also tight enough to lock out thirty students at once.
 * The burst window is what does the real work: farming means many requests in a
 * few minutes, while a shared network spreads the same volume across a day. The
 * daily figure is only a backstop against a slow, patient loop.
 *
 * Erring generous is deliberate. A false positive here looks to a student like
 * the site is broken, and they have no way to tell it isn't; every refusal is
 * logged so a real one shows up before anybody has to report it.
 *
 * One rule holds the burst numbers up, and `limits.test.ts` pins it: each
 * must sit comfortably above the *per-user* daily cap for the same thing. Below
 * that line, one student working hard on a school connection spends the whole
 * network's allowance and locks out the room — which is the same outcome as an
 * attack and would be reported as a bug, not as a limit.
 *
 * The daily figures are the honest spend bound and the place to tune. They
 * cannot be set to satisfy everyone at once: a number that fits thirty students
 * on one address also fits one person with thirty accounts, and no amount of
 * arithmetic resolves that — it is the reason the per-user caps exist as well.
 * Raise them if the warnings turn out to be real students.
 */
export const IP_LIMITS = {
  generatedSets: {
    burst: { seconds: 10 * 60, max: 40 },
    day: { seconds: 24 * 3600, max: 120 },
  },
  scans: {
    burst: { seconds: 10 * 60, max: 30 },
    day: { seconds: 24 * 3600, max: 100 },
  },
  materials: {
    burst: { seconds: 10 * 60, max: 20 },
    day: { seconds: 24 * 3600, max: 60 },
  },
} as const;

export type IpLimitKind = keyof typeof IP_LIMITS;

/**
 * Shown when the count behind a cap could not be read.
 *
 * Every cap below used to discard the query's `error` and read the count as
 * `null`, which `(count ?? 0) >= cap` then resolved to *under* the limit — so a
 * database hiccup did not degrade the caps, it removed them, silently and for
 * as long as the hiccup lasted. These now refuse instead.
 *
 * Refusing is the right direction here and not elsewhere: what is on the other
 * side of these particular caps is unbounded model spend, and the honest answer
 * to "I can't tell how much you've used" is to ask for a retry. `aiGradingAllowed`
 * deliberately keeps the opposite rule, for reasons given at its own call.
 */
export const CAP_CHECK_FAILED = "Couldn't check today's limit just now — try again in a moment.";

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
  const { count, error } = await db
    .from("worksheet_uploads")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startOfToday().toISOString());

  if (error) return { ok: false, message: CAP_CHECK_FAILED };

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
 * Whether a study material may be analysed.
 *
 * Counts every row for the same reason `scanAllowance` does: a material that
 * came back `not_math` still spent the call that decided so, and charging only
 * for the usable ones would make an unusable upload the cheapest way to spend
 * somebody else's quota — which, for the one endpoint that reads a file chosen
 * by whoever is asking, is the wrong incentive to hand out.
 */
export async function materialAllowance(
  userId: string,
  isAnonymous: boolean
): Promise<{ ok: true } | { ok: false; message: string }> {
  const db = createServiceClient();
  const { count, error } = await db
    .from("study_materials")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startOfToday().toISOString());

  if (error) return { ok: false, message: CAP_CHECK_FAILED };

  const cap = capFor("materials", isAnonymous);
  if ((count ?? 0) < cap) return { ok: true };
  return {
    ok: false,
    message: isAnonymous
      ? `Daily limit reached for guests (${cap} uploads). Sign in with Google for a higher limit.`
      : `Daily limit reached (${cap} uploads). Try again tomorrow.`,
  };
}

/**
 * The address this request came from, or `null` when it cannot be established.
 *
 * `x-vercel-forwarded-for` is stamped at the edge and overwrites whatever the
 * client sent, so it is the only one of the two that a caller cannot choose for
 * itself; `x-forwarded-for` is the fallback for other hosts, and only its first
 * hop is the client — the rest are proxies that would otherwise be countable as
 * separate subjects.
 */
export function clientIp(headers: Headers): string | null {
  const vercel = headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0]!.trim() || null;

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim() || null;

  return null;
}

/**
 * A stable, non-reversible name for an address.
 *
 * Salted because an unsalted hash of an IPv4 address is not anonymous in any
 * useful sense — the whole space is four billion entries, so a table mapping
 * every hash back to its address is an afternoon's work. The salt is derived
 * from the service key rather than being its own variable so that there is no
 * way to deploy this correctly-but-unsalted, which is the failure a separate
 * optional secret invites. Rotating that key only resets the counters.
 */
function subjectFor(ip: string): string {
  return createHash("sha256").update(`lemma-rate-limit|${supabaseSecretKey()}|${ip}`).digest("hex");
}

/**
 * Whether this network may spend on `kind` right now.
 *
 * **Fails open, unlike the per-user caps above, and the asymmetry is the point.**
 * A per-user cap is the only thing standing between one account and unbounded
 * spend, so being unable to evaluate it leaves nothing — it has to refuse. This
 * one sits *behind* a per-user cap that is itself now fail-closed, so an
 * unreachable counter still leaves a working bound, and refusing here would
 * instead make every set in the app depend on one more table being healthy.
 */
export async function ipAllowance(
  kind: IpLimitKind,
  headers: Headers
): Promise<{ ok: true } | { ok: false; message: string }> {
  const ip = clientIp(headers);
  // No header at all is the local-development case; on Vercel the edge always
  // sets one, and a client cannot strip it.
  if (!ip) return { ok: true };

  const limit = IP_LIMITS[kind];
  const db = createServiceClient();
  const { data, error } = await db.rpc("rate_check", {
    p_bucket: kind,
    p_subject: subjectFor(ip),
    p_burst_seconds: limit.burst.seconds,
    p_burst_limit: limit.burst.max,
    p_day_seconds: limit.day.seconds,
    p_day_limit: limit.day.max,
  });

  if (error) {
    console.error(`[lemma] IP rate check failed for ${kind}; allowing.`, error.message);
    return { ok: true };
  }
  if (data === "ok") return { ok: true };

  // Logged because the numbers above are a guess about real traffic, and a
  // shared network tripping them is indistinguishable, from the student's side,
  // from the site being broken.
  console.warn(`[lemma] IP rate limit hit: kind=${kind} window=${data}`);
  return {
    ok: false,
    message:
      data === "burst"
        ? "Too many requests from this network in the last few minutes. Wait a moment and try again."
        : "This network has reached today's limit. Try again tomorrow.",
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
