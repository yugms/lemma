"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, LogOut } from "lucide-react";
import type { HeaderUser } from "@/lib/auth-server";

/**
 * Presentational only. The session is resolved on the server and handed down,
 * and the Supabase browser client is imported lazily on click — so the auth
 * SDK never lands in the initial JavaScript for any route.
 *
 * Signing in is a link, not a button: the flow can fail for reasons that need
 * a sentence or two to explain (a provider switched off, a stale PKCE state),
 * and there is no room for that beside a 2rem control in a sticky header.
 * /signin owns the attempt and its failures.
 */
export function AuthButton({
  user,
  next,
}: {
  user: HeaderUser;
  /** Where /signin should return to once Google comes back. */
  next?: string;
}) {
  const [busy, setBusy] = useState(false);

  // Sign-out navigates away on success, so `busy` is only ever cleared on
  // failure — but it has to be, or one flaky request leaves the button
  // spinning with no way back except a reload.
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
      {user?.isGuest && <span className="badge hidden sm:inline-flex">Guest</span>}
      <Link
        href={next && next !== "/" ? `/signin?next=${encodeURIComponent(next)}` : "/signin"}
        transitionTypes={["nav-lateral"]}
        className="btn btn-outline btn-sm"
      >
        Sign in
      </Link>
    </div>
  );
}
