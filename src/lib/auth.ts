"use client";

import { createClient } from "@/lib/supabase/client";

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

/** Sign in with Google. Anonymous users are upgraded in place (history kept). */
export async function signInWithGoogle() {
  const supabase = createClient();
  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(window.location.pathname)}`;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.is_anonymous) {
    const { error } = await supabase.auth.linkIdentity({
      provider: "google",
      options: { redirectTo },
    });
    if (error) throw error;
    return;
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  if (error) throw error;
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  window.location.href = "/";
}
