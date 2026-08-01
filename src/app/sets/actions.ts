"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Delete a set. Deliberately uses the RLS-scoped client rather than the
 * service client: the "delete own sets" policy is the authorization check,
 * so a forged id simply matches no rows.
 *
 * The FK from `attempts` is ON DELETE SET NULL, so practice history survives
 * the set it was earned in.
 */
export async function deleteSet(setId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase.from("problem_sets").delete().eq("id", setId);
  if (error) return { error: "Could not delete that set." };

  revalidatePath("/sets");
  revalidatePath("/");
  return {};
}
