"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth-server";
import { copySharedSet } from "@/lib/share";

/**
 * Add a shared set to the caller's library and send them into it.
 *
 * The caller is whoever the cookie says — including a guest, since the client
 * calls `ensureUser()` before this runs. A share link is meant to work without
 * an account; requiring one here would make the link useless to most of the
 * people it gets sent to.
 */
export async function addSharedSet(code: string): Promise<{ error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Couldn't start a session — reload and try again." };

  const result = await copySharedSet(user.id, code);
  if ("error" in result) return result;

  revalidatePath("/sets");
  // Throws to unwind, so it must sit outside any try/catch.
  redirect(`/set/${result.setId}`);
}
