"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth-server";
import { createReviewSet, loadMissed, REVIEW_SET_MAX } from "@/lib/review";

/**
 * Build a set from the problems this student missed and send them into it.
 *
 * Deliberately a Server Action rather than a route: there is nothing to stream.
 * The whole job is two inserts, so the student gets the set immediately instead
 * of watching a progress bar for something that isn't generating anything.
 */
export async function buildReviewSet(): Promise<{ error?: string }> {
  const user = await getCurrentUser();
  if (!user || user.is_anonymous) {
    return { error: "Sign in to review your missed problems." };
  }

  const missed = await loadMissed(user.id, REVIEW_SET_MAX);
  if (missed.length === 0) return { error: "Nothing to review yet." };

  const result = await createReviewSet(
    user.id,
    missed.map((m) => m.problemId)
  );
  if ("error" in result) return result;

  revalidatePath("/review");
  revalidatePath("/sets");
  // Throws, so it must sit outside any try/catch — Next uses an exception to
  // unwind to the redirect.
  redirect(`/set/${result.setId}/practice`);
}
