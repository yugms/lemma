import { createServiceClient } from "@/lib/supabase/service";
import { capFor, startOfToday } from "@/lib/limits";
import { ITEM_SELECT, sanitizeItems, type SetConfig, type SetMeta } from "@/lib/sets";
import { newShareCode, normalizeShareCode } from "@/lib/share-code";
import type { SanitizedProblem } from "@/lib/ai/schemas";

/**
 * Sharing a set by link.
 *
 * A share link grants a *copy*, not access. Opening one shows the problems and
 * offers to add them to your own library, which mints a set you own — so the
 * ownership check in `/api/check` is untouched, your answers never touch the
 * sharer's score, and the two of you can work the same problems independently.
 * Widening that check to "or you know the code" would have been the smaller
 * diff and the much larger security surface.
 */

export type SharedSet = {
  set: Pick<SetMeta, "id" | "title" | "created_at"> & { config: SetConfig };
  problems: SanitizedProblem[];
  ownerId: string;
};

/**
 * Resolve a share code with no owner check — that is the point of a link.
 *
 * Returns sanitized problems only. Answers live in columns this never selects,
 * and a viewer who has not copied the set owns no `problem_set_items` row for
 * these problems, so `/api/check` still refuses to grade or disclose for them.
 */
export async function loadSharedSet(code: string): Promise<SharedSet | null> {
  // Reject anything malformed before it reaches the database, so a share URL
  // can't be used to probe with arbitrary strings.
  const normalized = normalizeShareCode(code);
  if (!normalized) return null;

  const db = createServiceClient();
  const { data: set } = await db
    .from("problem_sets")
    .select("id, title, config, created_at, owner_id")
    .eq("share_code", normalized)
    .maybeSingle();
  if (!set) return null;

  const { data: items } = await db
    .from("problem_set_items")
    .select(ITEM_SELECT)
    .eq("set_id", set.id)
    .order("position");

  return {
    set: {
      id: set.id,
      title: set.title,
      config: set.config as SetConfig,
      created_at: set.created_at,
    },
    problems: sanitizeItems(items),
    ownerId: set.owner_id,
  };
}

/**
 * Add a shared set to your own library.
 *
 * The copy points at the same `problems` rows — they are pooled and immutable,
 * so duplicating them would only bloat the table and break the dedup that pool
 * reuse depends on. What is copied is the *set*: a new id, a new owner, and its
 * own empty progress.
 */
export async function copySharedSet(
  userId: string,
  code: string
): Promise<{ setId: string } | { error: string }> {
  const shared = await loadSharedSet(code);
  if (!shared) return { error: "That link doesn't point to a set." };
  if (shared.problems.length === 0) return { error: "That set has no problems in it." };
  if (shared.ownerId === userId) return { setId: shared.set.id };

  const db = createServiceClient();

  const { count } = await db
    .from("problem_sets")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId)
    .not("config->>copiedFrom", "is", null)
    .gte("created_at", startOfToday().toISOString());
  // Copies cost nothing to make, so they are bounded on their own terms.
  const copyCap = capFor("sharedCopies", false);
  if ((count ?? 0) >= copyCap) {
    return { error: `That's ${copyCap} shared sets today — work through one first.` };
  }

  const { data: created, error: setErr } = await db
    .from("problem_sets")
    .insert({
      owner_id: userId,
      title: shared.set.title,
      share_code: newShareCode(),
      // `copiedFrom` keeps these out of the daily generation cap for the same
      // reason review sets are: no model call was made to produce them.
      config: { ...shared.set.config, copiedFrom: shared.set.id },
    })
    .select("id")
    .single();
  if (setErr || !created) return { error: "Couldn't add that set to your library." };

  const { error: itemsErr } = await db.from("problem_set_items").insert(
    shared.problems.map((p, i) => ({
      set_id: created.id,
      problem_id: p.id,
      position: i + 1,
    }))
  );
  if (itemsErr) {
    // Leave no half-built set in the library.
    await db.from("problem_sets").delete().eq("id", created.id);
    return { error: "Couldn't add that set to your library." };
  }

  return { setId: created.id };
}
