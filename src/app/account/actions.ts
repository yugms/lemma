"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as account from "@/lib/account";

/**
 * The user id always comes from the session here, never from an argument.
 * These actions run with the service client underneath, so an id the caller
 * could name would be an id the caller could wipe.
 */
async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** Everything a reset touches, so the pages showing it aren't stale after. */
function revalidateAll() {
  for (const path of ["/", "/sets", "/stats", "/review", "/account"]) {
    revalidatePath(path);
  }
}

export async function clearHistoryAction(): Promise<{ error?: string }> {
  const userId = await currentUserId();
  if (!userId) return { error: "Not signed in" };
  try {
    await account.clearHistory(userId);
  } catch {
    return { error: "Couldn't clear your history — try again." };
  }
  revalidateAll();
  return {};
}

export async function deleteAllDataAction(): Promise<{ error?: string }> {
  const userId = await currentUserId();
  if (!userId) return { error: "Not signed in" };
  try {
    await account.deleteAllData(userId);
  } catch {
    return { error: "Couldn't delete your data — try again." };
  }
  revalidateAll();
  return {};
}

/**
 * Delete the account, then drop the session.
 *
 * Signing out second is deliberate: the cookie must not be cleared while the
 * user row might still exist, or a failed delete would leave someone locked out
 * of an account that is still there. The client navigates away once this
 * returns, since every page from here on has no user to render.
 */
export async function deleteAccountAction(): Promise<{ error?: string }> {
  const userId = await currentUserId();
  if (!userId) return { error: "Not signed in" };

  const result = await account.deleteAccount(userId);
  if (result.error) return { error: "Couldn't delete your account — try again." };

  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidateAll();
  return {};
}
