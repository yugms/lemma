"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { addSharedSet } from "@/app/s/[code]/actions";

/**
 * Take a copy of a shared set.
 *
 * `ensureUser()` runs first so a visitor with no account gets a guest session
 * before the action needs one — the same lazy import the builder uses, which is
 * what keeps the Supabase SDK off this route until someone actually clicks.
 */
export function AddSharedSet({ code, alreadyMine }: { code: string; alreadyMine: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const busy = pending || preparing;

  async function add() {
    setError(null);
    setPreparing(true);
    try {
      const { ensureUser } = await import("@/lib/auth");
      await ensureUser();
    } catch (e) {
      setPreparing(false);
      // The age gate throws through here too, and its message explains a choice
      // the generic line contradicts: someone who declined is not helped by
      // being told to reload. Keep the fallback for a real session failure.
      setError(
        e instanceof Error ? e.message : "Couldn't start a session — reload and try again."
      );
      return;
    }
    setPreparing(false);
    startTransition(async () => {
      const res = await addSharedSet(code);
      if (res?.error) setError(res.error);
    });
  }

  return (
    <div>
      <button type="button" disabled={busy} onClick={add} className="btn btn-accent btn-lg">
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Plus className="h-4 w-4" aria-hidden />
        )}
        {busy ? "Adding…" : alreadyMine ? "Open your copy" : "Add to my sets"}
      </button>
      <p className="mono-meta mt-3">
        {alreadyMine
          ? "You already own this set."
          : "You get your own copy — your answers stay yours, and theirs stay theirs."}
      </p>
      {error && (
        <p role="alert" className="aside-rule mt-3 border-bad py-1 text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
