import { createServiceClient } from "@/lib/supabase/service";
import { SCAN_BUCKET } from "@/lib/worksheets";
import { MATERIAL_BUCKET, materialPathsFor } from "@/lib/materials";

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
 * auth user cascades every Postgres row — including the `worksheet_uploads` and
 * `study_materials` records that say which files exist — and orphaned objects in
 * a private bucket cannot be found again afterwards.
 */

/**
 * `null` means the count could not be determined — never that it is zero.
 *
 * Every consumer has to handle it, which is the point: see `loadAccountSummary`.
 */
export type AccountSummary = {
  sets: number | null;
  attempts: number | null;
  sessions: number | null;
  scans: number | null;
  /** Study material read. The files are long gone; the description is not. */
  materials: number | null;
  /** Whether a coach read is cached. Not user-authored, but it is their data. */
  hasCoachRead: boolean;
};

export async function loadAccountSummary(userId: string): Promise<AccountSummary> {
  const db = createServiceClient();
  /**
   * Returns `null` on failure rather than 0, and never throws.
   *
   * "0" is the one wrong answer that changes a student's mind — it reads as
   * "nothing to lose" immediately before a permanent deletion — so a failed
   * count must not become one. This originally threw for that reason, which
   * was the wrong fix: a single flaky count then took down the whole page,
   * and the page is the only route to the deletion controls. Someone trying to
   * erase their data would find the controls gone, which is worse than a wrong
   * number and much worse than an honest "—".
   *
   * Observed in production once, with an empty error message and a null count
   * on one of five concurrent HEAD requests — transient, and not reproducible
   * against the same database from elsewhere. It does not need to be diagnosed
   * to be survived.
   */
  const count = async (table: string, column: string): Promise<number | null> => {
    const { count: n, error } = await db
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq(column, userId);
    return error ? null : n;
  };
  const [sets, attempts, sessions, scans, materials, coach] = await Promise.all([
    count("problem_sets", "owner_id"),
    count("attempts", "user_id"),
    count("study_sessions", "user_id"),
    count("worksheet_uploads", "user_id"),
    count("study_materials", "user_id"),
    count("coach_reads", "user_id"),
  ]);
  // Unknown is not "no coach read", but there is nothing to show either way and
  // it never gates a control.
  return { sets, attempts, sessions, scans, materials, hasCoachRead: (coach ?? 0) > 0 };
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
 * Study material, and anything left of the files it came from.
 *
 * There should be nothing in the bucket: analysis sweeps as it finishes, on the
 * failure path too. This is the backstop for an upload that never reached the
 * route — a tab closed between the storage write and the POST leaves objects
 * with no row naming them, and this is the only thing that would ever find them
 * again.
 */
async function clearMaterials(userId: string): Promise<void> {
  const db = createServiceClient();
  const paths = await materialPathsFor(userId);
  if (paths.length > 0) await db.storage.from(MATERIAL_BUCKET).remove(paths);
  await db.from("study_materials").delete().eq("user_id", userId);
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
  // Material goes here rather than with the history above, on the same
  // reasoning that keeps sets out of `clearHistory`: reading one cost a model
  // call and a slot against a daily cap, and more sets can still be built from
  // it without re-uploading. "Start this again" should not mean "pay for it
  // again".
  await clearMaterials(userId);
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
  await Promise.all([clearScans(userId), clearMaterials(userId)]);
  const { error } = await db.auth.admin.deleteUser(userId);
  return error ? { error: error.message } : {};
}
