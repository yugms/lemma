/**
 * Sign-in failure codes turned into copy a student can act on.
 *
 * Shared by the browser (`signInWithGoogle` throws these) and the OAuth
 * callback route (which can only pass a code through a redirect), so this
 * module carries no "use client" directive and imports nothing.
 *
 * The auth server's own messages are written for whoever configured the
 * project, not for the person staring at the button — so the operator hint
 * stays in parentheses rather than replacing the sentence, matching the
 * anonymous-sign-in message in `auth.ts`.
 */

/** Codes are Supabase Auth's `error_code`; anything unlisted uses the fallback. */
const MESSAGES: Record<string, string> = {
  manual_linking_disabled:
    "Your guest progress can't be attached to a Google account, because identity linking is switched off for this project. (If you run this project: turn on “Allow manual linking” under Authentication → Sign In / Providers in Supabase.)",
  provider_disabled:
    "Google sign-in isn't switched on for this project. (If you run this project: enable the Google provider under Authentication → Sign In / Providers in Supabase.)",
  validation_failed:
    "The sign-in request was rejected before it reached Google. (If you run this project: check the Google provider's client ID, secret and redirect URL in Supabase.)",
  bad_oauth_state:
    "Google sent back a response this app couldn't read. Try signing in again.",
  bad_oauth_callback:
    "Google sent back an incomplete response. Try signing in again.",
  bad_code_verifier:
    "This browser couldn't finish the sign-in it started — usually the tab was reloaded, or cookies were cleared partway through. Try again in this tab.",
  flow_state_expired:
    "The sign-in attempt sat unfinished for too long and expired. Try again.",
  identity_already_exists:
    "That Google account is already attached to a different lemma account. Sign out of this guest session first, then sign in with Google.",
  over_request_rate_limit:
    "Too many sign-in attempts from this network. Wait a few minutes and try again.",
  request_timeout: "The sign-in service took too long to answer. Try again.",
  unexpected_failure:
    "The sign-in service is having trouble right now. Your guest progress is safe — try again in a few minutes.",
};

export const SIGN_IN_FALLBACK =
  "Sign-in didn't go through. Your guest progress is safe — you can keep working and try again.";

/** Never returns empty: an unmapped or missing code still gets a sentence. */
export function describeSignInError(code?: string | null): string {
  return (code && MESSAGES[code]) || SIGN_IN_FALLBACK;
}
