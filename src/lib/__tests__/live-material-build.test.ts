import { describe, expect, it } from "vitest";
import { createServiceClient } from "../supabase/service";
import { buildProblemSet, type SetConfig } from "../sets";
import { analyzeMaterial, normalizeDigest } from "../ai/analyze-material";
import type { TopicInfo } from "../ai/generate";

/**
 * The whole material path, against the real database and the real model.
 *
 * It exists for one claim the offline tests cannot make: that a set built from
 * an upload writes `unlisted` problems and leaves the shared pool exactly as it
 * found it. `material-pool.test.ts` proves the hashes differ; only this proves
 * that the upsert therefore does what the hashes imply, and that is the half
 * that was wrong before `contentHashFor` existed.
 *
 * Needs both keys, so it self-skips twice over. Run it with:
 *
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run \
 *     src/lib/__tests__/live-material-build.test.ts
 */
const SKIP = !process.env.SUPABASE_SECRET_KEY || !process.env.GEMINI_API_KEY;

describe.skipIf(SKIP)("building a set from uploaded material", () => {
  let client: ReturnType<typeof createServiceClient> | null = null;
  const database = () => (client ??= createServiceClient());

  it("writes unlisted problems and leaves the pool untouched", async () => {
    const db = database();

    const { data: topicRows } = await db
      .from("topics")
      .select("id, title, description, units(title, courses(title))")
      .limit(40);
    const topics: TopicInfo[] = (topicRows ?? []).map((t) => {
      const row = t as unknown as {
        id: string;
        title: string;
        description: string | null;
        units: { title: string; courses: { title: string } | null } | null;
      };
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        unit_title: row.units?.title,
        course_title: row.units?.courses?.title,
      };
    });
    expect(topics.length).toBeGreaterThan(0);

    // Everything currently in the shared pool, so the comparison afterwards is
    // against reality rather than an assumption about what was there.
    const { data: before } = await db.from("problems").select("id, status");
    const poolBefore = new Map((before ?? []).map((p) => [p.id as string, p.status as string]));

    const raw = await analyzeMaterial({
      topics,
      parts: [],
      pastedText: `Worksheet 3 — Linear equations
1. Solve 4x + 3 = 19.
2. Solve 7 - 2x = 1.
3. Solve x/5 + 2 = 6.`,
      want: "",
    });
    expect(raw, "analysis returned nothing").not.toBeNull();

    const digest = normalizeDigest(
      raw!,
      topics.map((t) => t.id)
    );
    expect(digest.verdict).toBe("ok");
    expect(digest.topic_ids.length).toBeGreaterThan(0);

    const { data: user, error: userErr } = await db.auth.admin.createUser({
      email: `lemma-test-${crypto.randomUUID()}@test.invalid`,
      email_confirm: true,
    });
    if (userErr || !user.user) throw new Error(`createUser failed: ${userErr?.message}`);
    const userId = user.user.id;

    const { data: material } = await db
      .from("study_materials")
      .insert({
        user_id: userId,
        status: "ready",
        storage_paths: [],
        digest: digest as never,
      })
      .select("id")
      .single();
    const materialId = material!.id as string;

    const config: SetConfig = {
      topicIds: digest.topic_ids,
      count: 4,
      difficulty: digest.difficulty,
      styles: digest.styles,
      formats: digest.formats,
      material: {
        id: materialId,
        concepts: digest.concepts,
        archetypes: digest.archetypes,
        emphasis: digest.requested_emphasis,
      },
    };

    let setId: string | null = null;
    let failure: string | null = null;
    try {
      for await (const event of buildProblemSet(userId, false, config)) {
        if (event.type === "complete") setId = event.setId;
        if (event.type === "error") failure = event.message;
      }
      expect(failure, "build reported an error").toBeNull();
      expect(setId, "build produced no set").not.toBeNull();

      const { data: items } = await db
        .from("problem_set_items")
        .select("problems(id, status, source)")
        .eq("set_id", setId!);
      const problems = (items ?? []).map(
        (i) => (i as unknown as { problems: { id: string; status: string; source: string } }).problems
      );

      expect(problems.length).toBeGreaterThan(0);
      for (const p of problems) {
        // Written for this student from something only they had. The pool query
        // filters on `status`, so this is what keeps it out of a stranger's set.
        expect(p.status, `problem ${p.id}`).toBe("unlisted");
        // No pool reuse and no templates on a bespoke build, so every problem
        // in the set must be one that was just authored.
        expect(poolBefore.has(p.id), `problem ${p.id} came from the pool`).toBe(false);
      }

      // The half that `material-pool.test.ts` cannot reach: the upsert's
      // ON CONFLICT DO UPDATE writes every column in the payload, so without
      // the hash namespace a collision here would silently flip an existing
      // shared problem to `unlisted`.
      const { data: after } = await db.from("problems").select("id, status");
      for (const row of after ?? []) {
        const was = poolBefore.get(row.id as string);
        if (was) expect(row.status, `pre-existing problem ${row.id} changed status`).toBe(was);
      }
    } finally {
      if (setId) await db.from("problem_sets").delete().eq("id", setId);
      // Problems are not owned by a user, so the cascade below misses them.
      const { data: after } = await db.from("problems").select("id");
      const created = (after ?? [])
        .map((p) => p.id as string)
        .filter((id) => !poolBefore.has(id));
      if (created.length > 0) await db.from("problems").delete().in("id", created);
      await db.auth.admin.deleteUser(userId);
    }
  }, 300_000);
});
