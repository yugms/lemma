import { createServiceClient } from "@/lib/supabase/service";
import { SCAN_BUCKET } from "@/lib/worksheets";

/**
 * Destroying a student's own data, on their own instruction.
 *
 * Everything here takes a `userId` the caller resolved server-side — never one
 * off the wire. The service client is used deliberately: `attempts`,
 * `study_sessions` and `coach_reads` carry read-only policies because outcomes
 * are written server-side, so an RLS-scoped delete would match no rows and
 * silently report success.
 *
 * Ordering matters. Storage is cleared before the account, because deleting the
 * auth user cascades every Postgres row — including the `worksheet_uploads`
 * records that say which files exist — and orphaned objects in a private bucket
 * cannot be found again afterwards.
 */

export type AccountSummary = {
  sets: number;
  attempts: number;
  sessions: number;
  scans: number;
  /** Whether a coach read is cached. Not user-authored, but it is their data. */
  hasCoachRead: boolean;
};

export async function loadAccountSummary(userId: string): Promise<AccountSummary> {
  const db = createServiceClient();
  /**
   * Throws rather than falling back to zero.
   *
   * These numbers are the last thing a student reads before deleting something
   * permanently, and "0" is the one wrong answer that changes their mind: a
   * failed query would render as "nothing to lose" and disable the very
   * safeguard that says otherwise. Failing the page is the safe direction.
   */
  const count = async (table: string, column: string) => {
    const { count: n, error } = await db
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq(column, userId);
    if (error || n === null) {
      throw new Error(`Could not count ${table}: ${error?.message ?? "no count returned"}`);
    }
    return n;
  };
  const [sets, attempts, sessions, scans, coach] = await Promise.all([
    count("problem_sets", "owner_id"),
    count("attempts", "user_id"),
    count("study_sessions", "user_id"),
    count("worksheet_uploads", "user_id"),
    count("coach_reads", "user_id"),
  ]);
  return { sets, attempts, sessions, scans, hasCoachRead: coach > 0 };
}

/**
 * Every stored scan for one user.
 *
 * Listed from the bucket rather than read out of `worksheet_uploads`, so a file
 * whose upload row was already removed is still found. Supabase refuses
 * `delete from storage.objects` precisely to stop that orphan case, so this is
 * the only route that actually frees them.
 */
async function scanPathsFor(userId: string): Promise<string[]> {
  const db = createServiceClient();
  const { data: folders } = await db.storage.from(SCAN_BUCKET).list(userId);
  const paths: string[] = [];
  for (const folder of folders ?? []) {
    // A page sits at `${userId}/${uploadId}/${n}.png`; anything with an id is a
    // file at this level rather than a folder, so take it as it comes.
    if (folder.id) {
      paths.push(`${userId}/${folder.name}`);
      continue;
    }
    const { data: files } = await db.storage.from(SCAN_BUCKET).list(`${userId}/${folder.name}`);
    for (const file of files ?? []) paths.push(`${userId}/${folder.name}/${file.name}`);
  }
  return paths;
}

async function clearScans(userId: string): Promise<void> {
  const db = createServiceClient();
  const paths = await scanPathsFor(userId);
  if (paths.length > 0) await db.storage.from(SCAN_BUCKET).remove(paths);
  await db.from("worksheet_uploads").delete().eq("user_id", userId);
}

/**
 * Wipe practice history, keeping the sets themselves.
 *
 * Sets are the expensive half — each one cost model calls and a slot against a
 * daily cap — so "start this again" should not mean "generate it all again".
 * Everything derived from working through them goes.
 */
export async function clearHistory(userId: string): Promise<void> {
  const db = createServiceClient();
  await clearScans(userId);
  await Promise.all([
    db.from("attempts").delete().eq("user_id", userId),
    db.from("study_sessions").delete().eq("user_id", userId),
    db.from("coach_reads").delete().eq("user_id", userId),
  ]);
}

/** History plus the sets. The account survives; nothing in it does. */
export async function deleteAllData(userId: string): Promise<void> {
  const db = createServiceClient();
  await clearHistory(userId);
  // `problem_set_items` cascades from the set; `attempts.set_id` is ON DELETE
  // SET NULL, but history is already gone by this point.
  await db.from("problem_sets").delete().eq("owner_id", userId);
}

/**
 * Delete the account itself.
 *
 * Every user-owned table has `ON DELETE CASCADE` from `auth.users`, so the row
 * removal takes the data with it — but storage has no such link, hence the
 * explicit sweep first.
 */
export async function deleteAccount(userId: string): Promise<{ error?: string }> {
  const db = createServiceClient();
  await clearScans(userId);
  const { error } = await db.auth.admin.deleteUser(userId);
  return error ? { error: error.message } : {};
}
