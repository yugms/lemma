"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { SIGN_IN_FALLBACK } from "@/lib/auth-errors";

/**
 * The sign-in button and everything that can go wrong with it, in one place.
 *
 * The header used to own both, which left a failure nowhere to go but a caption
 * beside a 2rem button — so the reason got compressed to "didn't go through"
 * and the actual cause was discarded. Here there is room to say what broke.
 *
 * `@/lib/auth` is still imported at click time: a route whose whole job is to
 * offer sign-in is exactly the one that must not ship the Supabase SDK to
 * everyone who lands on it.
 */
export function SignInPanel({
  next,
  initialError,
}: {
  /** Where the OAuth callback returns on success. */
  next: string;
  /** Set when the callback bounced back here carrying a failure code. */
  initialError: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);

  // Success navigates away to Google, so `busy` is only ever cleared on
  // failure — but it has to be, or one flaky request leaves the button
  // spinning with no way back except a reload.
  async function handleSignIn() {
    setBusy(true);
    setError(null);
    try {
      const { signInWithGoogle } = await import("@/lib/auth");
      await signInWithGoogle(next);
    } catch (e) {
      // `signInWithGoogle` already phrased this for a reader; the raw error
      // rides along as `cause` for anyone with the console open.
      setError(e instanceof Error ? e.message : SIGN_IN_FALLBACK);
      setBusy(false);
    }
  }

  return (
    <div>
      {error && (
        <div
          role="alert"
          className="aside-rule mb-8 border-bad py-1.5 text-sm leading-relaxed text-bad"
        >
          {/* Never colour alone — the icon and the word carry it too. */}
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Sign-in failed
          </p>
          <p className="mt-1.5">{error}</p>
        </div>
      )}

      <button
        type="button"
        onClick={handleSignIn}
        disabled={busy}
        className="btn btn-accent btn-lg w-full sm:w-auto"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {busy ? "Opening Google…" : error ? "Try again" : "Continue with Google"}
      </button>
    </div>
  );
}
