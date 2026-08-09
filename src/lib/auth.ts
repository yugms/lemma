"use client";

import type { AuthError, SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { describeSignInError } from "@/lib/auth-errors";
import { solveCaptcha } from "@/lib/captcha";
import { affirmationRecord, confirmAge, hasAffirmedAge } from "@/lib/age-gate";

/** Get the current session's user, creating an anonymous account if none exists. */
export async function ensureUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await backfillAffirmation(supabase, user);
    return user;
  }

  // Before the CAPTCHA, not after: someone who is too young, or who declines,
  // should not have been announced to Cloudflare on the way to being turned
  // away. This throws to abort, so nothing downstream runs.
  await confirmAge();

  // Only a brand-new guest needs a token, so this runs once per browser rather
  // than on every action. Returns null unless Turnstile is configured, in which
  // case nothing is loaded and this is the code that was here before.
  const captchaToken = await solveCaptcha();

  const { data, error } = await supabase.auth.signInAnonymously(
    captchaToken ? { options: { captchaToken } } : undefined
  );
  if (error) throw new Error(guestSessionFailure(error));
  await storeAffirmation(supabase);
  return data.user!;
}

/**
 * Move the declaration from browser storage onto the account.
 *
 * The account is the record that matters — it survives a cleared browser, and
 * it is what an actual enquiry about a specific user would be answered from.
 * `localStorage` is only the cache that stops the dialog reappearing.
 *
 * Failure is swallowed on purpose. Losing the record is bad; losing the click
 * that the student actually made — a set they were part-way through building —
 * because a metadata write failed is worse, and they have already answered.
 */
async function storeAffirmation(supabase: SupabaseClient): Promise<void> {
  try {
    await supabase.auth.updateUser({ data: affirmationRecord() });
  } catch {
    // See above.
  }
}

/**
 * Write the declaration onto an account that predates it.
 *
 * Two cases land here, and neither can write it at the moment it is given: a
 * user who signed in with Google directly is redirected away mid-flow and only
 * has a session once they are back, and everyone whose account was created
 * before this check existed has no record at all. Returns without touching the
 * network in every other case, which is almost all of them, since this sits on
 * the path of every guest action in the app.
 */
async function backfillAffirmation(supabase: SupabaseClient, user: User): Promise<void> {
  if (user.user_metadata?.age_affirmed_at) return;
  if (!hasAffirmedAge()) return;
  await storeAffirmation(supabase);
}

/**
 * Why a guest session couldn't be created.
 *
 * These were one message, which was fine when there was one cause. With a
 * CAPTCHA in play there are two, and they need opposite actions: `captcha_failed`
 * is usually the visitor's own extension or a mismatched key, while
 * `anonymous_provider_disabled` is a project setting the visitor can do nothing
 * about. Telling someone with an ad blocker to go and check Supabase settings
 * is worse than saying nothing.
 */
function guestSessionFailure(error: AuthError): string {
  if (error.code === "captcha_failed") {
    return "The anti-abuse check didn't pass, so a guest session couldn't be started. If you're using an ad blocker or strict privacy mode, allowing challenges.cloudflare.com and reloading usually fixes it. (If you run this project: check the Turnstile secret in Supabase matches NEXT_PUBLIC_TURNSTILE_SITE_KEY.)";
  }
  if (error.code === "over_request_rate_limit") {
    return "Too many new sessions from this network just now. Wait a few minutes and try again.";
  }
  return "Could not start a guest session. (If you run this project: enable anonymous sign-ins in Supabase Auth settings.)";
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

  // Only this branch asks. The one above is an existing guest upgrading in
  // place, and they answered when their session was created — putting the
  // dialog in front of them again would be asking the same person twice about
  // the same account.
  //
  // Nothing is written here because the redirect below leaves the page before
  // there is a session to write to; `backfillAffirmation` picks it up on the
  // way back.
  await confirmAge();

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
