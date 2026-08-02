"use client";

import type { AuthError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { describeSignInError } from "@/lib/auth-errors";

/** Get the current session's user, creating an anonymous account if none exists. */
export async function ensureUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) return user;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    throw new Error(
      "Could not start a guest session. (If you run this project: enable anonymous sign-ins in Supabase Auth settings.)"
    );
  }
  return data.user!;
}

/**
 * Sign in with Google. Anonymous users are upgraded in place (history kept).
 *
 * `next` is where the callback lands on success — the sign-in page passes the
 * page the student came from, since bouncing them back to /signin after a
 * successful sign-in reads as a failure.
 */
export async function signInWithGoogle(next = "/") {
  const supabase = createClient();
  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.is_anonymous) {
    const { error } = await supabase.auth.linkIdentity({
      provider: "google",
      options: { redirectTo },
    });
    // Linking is the whole point for a guest — falling back to a plain OAuth
    // sign-in here would silently strand their sets under the old user id.
    if (error) throw signInFailure(error);
    return;
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  if (error) throw signInFailure(error);
}

/**
 * Carries the readable sentence in `message` so the sign-in page can render it
 * directly. The raw error is kept as `cause` for the console — the previous
 * blanket "didn't go through" threw away the one field (`code`) that said what
 * actually broke.
 */
function signInFailure(error: AuthError) {
  return new Error(describeSignInError(error.code), { cause: error });
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  window.location.href = "/";
}
