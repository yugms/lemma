"use client";

import { useState } from "react";
import { Loader2, LogOut } from "lucide-react";
import type { HeaderUser } from "@/lib/auth-server";

/**
 * Presentational only. The session is resolved on the server and handed down,
 * and the Supabase browser client is imported lazily on click — so the auth
 * SDK never lands in the initial JavaScript for any route.
 */
export function AuthButton({ user }: { user: HeaderUser }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  // Both paths navigate away on success, so `busy` is only ever cleared on
  // failure — but it has to be, or one flaky request leaves the button spinning
  // with no way back except a reload.
  async function handleSignIn() {
    setBusy(true);
    setError(false);
    try {
      const { signInWithGoogle } = await import("@/lib/auth");
      await signInWithGoogle();
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setBusy(true);
    try {
      const { signOut } = await import("@/lib/auth");
      await signOut();
    } catch {
      setBusy(false);
    }
  }

  if (user && !user.isGuest) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden max-w-36 truncate text-sm text-muted sm:block">
          {user.name}
        </span>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={busy}
          aria-label="Sign out"
          title="Sign out"
          className="btn btn-ghost btn-icon"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <LogOut className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5">
      {/* Beside the button, never instead of it — a popup that failed once
          shouldn't remove the only way to sign in. */}
      {error && (
        <span className="hidden max-w-44 text-xs leading-tight text-faint sm:block">
          Sign-in didn&apos;t go through — continue as a guest or try again.
        </span>
      )}
      {user?.isGuest && !error && (
        <span className="badge hidden sm:inline-flex">Guest</span>
      )}
      <button
        type="button"
        onClick={handleSignIn}
        disabled={busy}
        className="btn btn-outline btn-sm"
      >
        {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
        {error ? "Retry" : "Sign in"}
      </button>
    </div>
  );
}
