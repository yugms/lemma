"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { signInWithGoogle, signOut } from "@/lib/auth";
import type { User } from "@supabase/supabase-js";

export function AuthButton() {
  const [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoaded(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  if (!loaded) return <div className="h-8 w-24" />;

  const isGuest = !user || user.is_anonymous;

  if (!isGuest) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="hidden sm:block text-zinc-500 max-w-40 truncate">
          {user!.user_metadata?.name ?? user!.email}
        </span>
        <button onClick={() => signOut()} className="text-zinc-500 hover:text-zinc-800">
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {user?.is_anonymous && <span className="hidden sm:block text-xs text-zinc-400">Guest</span>}
      <button
        onClick={async () => {
          try {
            await signInWithGoogle();
          } catch {
            setError(true);
          }
        }}
        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
      >
        Sign in with Google
      </button>
      {error && (
        <span className="text-xs text-rose-500">Google sign-in isn&apos;t set up yet — you can keep going as a guest.</span>
      )}
    </div>
  );
}
