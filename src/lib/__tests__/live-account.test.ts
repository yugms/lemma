import { describe, expect, it } from "vitest";
import { createServiceClient } from "../supabase/service";
import { clearHistory, deleteAllData, deleteAccount, loadAccountSummary } from "../account";

/**
 * Live test of the destructive account actions.
 *
 * Self-skips without `SUPABASE_SECRET_KEY`, like `live-provider.test.ts`, so
 * `npm run test` stays offline. Run it with:
 *
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run \
 *     src/lib/__tests__/live-account.test.ts
 *
 * Every row it touches belongs to a throwaway anonymous user it creates and
 * then deletes. These functions cannot be tested against a real account for the
 * obvious reason, and they are the last code anyone would want to discover is
 * broken — a half-completed delete leaves a student with data they asked to be
 * rid of, and no way to try again.
 */
describe.skipIf(!process.env.SUPABASE_SECRET_KEY)("account deletion", () => {
  /**
   * Built on first use, not in the describe body.
   *
   * `skipIf` skips the *tests*; the callback itself still runs at collection
   * time, so a client constructed here was constructed even with no key set —
   * which threw `supabaseUrl is required` and failed `npm run test` offline,
   * the one thing this suite's skip exists to prevent.
   */
  let client: ReturnType<typeof createServiceClient> | null = null;
  const database = () => (client ??= createServiceClient());

  /** A user with one set, one item and one attempt against it. */
  async function seed() {
    const db = database();
    // `.invalid` is reserved by RFC 2606 and can never resolve, so a stray
    // confirmation mail has nowhere to go even if one were ever sent.
    const { data, error } = await db.auth.admin.createUser({
      email: `lemma-test-${crypto.randomUUID()}@test.invalid`,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    const userId = data.user.id;

    const { data: set } = await db
      .from("problem_sets")
      .insert({
        owner_id: userId,
        title: "throwaway",
        share_code: `test-${userId.slice(0, 8)}`,
        config: {},
      })
      .select("id")
      .single();

    // Any existing problem will do — this is about ownership, not content.
    const { data: problem } = await db.from("problems").select("id").limit(1).single();

    await db
      .from("problem_set_items")
      .insert({ set_id: set!.id, problem_id: problem!.id, position: 1 });
    await db.from("attempts").insert({
      user_id: userId,
      set_id: set!.id,
      problem_id: problem!.id,
      mode: "practice",
      answer: "x" as never,
      is_correct: true,
    });
    await db.from("study_sessions").insert({ user_id: userId });

    return { userId, setId: set!.id as string };
  }

  it("clears history but keeps the sets", async () => {
    const { userId } = await seed();
    try {
      expect(await loadAccountSummary(userId)).toMatchObject({
        sets: 1,
        attempts: 1,
        sessions: 1,
      });

      await clearHistory(userId);

      // The expensive half survives: sets cost model calls and a daily slot, so
      // "start over" must not mean "generate it all again".
      expect(await loadAccountSummary(userId)).toMatchObject({
        sets: 1,
        attempts: 0,
        sessions: 0,
      });
    } finally {
      await deleteAccount(userId);
    }
  }, 60_000);

  it("deletes every set as well, keeping the account", async () => {
    const { userId } = await seed();
    try {
      await deleteAllData(userId);
      expect(await loadAccountSummary(userId)).toMatchObject({ sets: 0, attempts: 0 });

      const { data } = await database().auth.admin.getUserById(userId);
      expect(data.user, "the account itself must survive").not.toBeNull();
    } finally {
      await deleteAccount(userId);
    }
  }, 60_000);

  it("deletes the account and everything cascading off it", async () => {
    const { userId, setId } = await seed();

    const result = await deleteAccount(userId);
    expect(result.error).toBeUndefined();

    const { data } = await database().auth.admin.getUserById(userId);
    expect(data.user).toBeNull();

    // Every user-owned table is ON DELETE CASCADE from auth.users. If that ever
    // stops being true, the delete would fail on a foreign key instead — and
    // this is where it should be caught.
    for (const [table, column] of [
      ["problem_sets", "owner_id"],
      ["attempts", "user_id"],
      ["study_sessions", "user_id"],
      ["coach_reads", "user_id"],
      ["worksheet_uploads", "user_id"],
    ] as const) {
      const { count } = await database()
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq(column, userId);
      expect(count, `${table} still holds rows for a deleted user`).toBe(0);
    }

    // The set's items go with the set, not with the user, so check the chain.
    const { count: items } = await database()
      .from("problem_set_items")
      .select("*", { count: "exact", head: true })
      .eq("set_id", setId);
    expect(items, "problem_set_items orphaned").toBe(0);
  }, 60_000);
});
