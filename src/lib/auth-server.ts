import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in user, resolved once per request.
 *
 * `getUser()` validates the JWT against the auth server, so the layout and
 * the page must not each pay for it — React's `cache` dedupes them into a
 * single round-trip. Resolving auth here rather than in the browser is also
 * what keeps `@supabase/supabase-js` (~64 kB gzipped) out of the initial
 * bundle of every route.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export type HeaderUser = { name: string | null; isGuest: boolean } | null;

/** Only what the header needs — no tokens or claims cross to the client. */
export function toHeaderUser(user: User | null): HeaderUser {
  if (!user) return null;
  return {
    name: (user.user_metadata?.name as string | undefined) ?? user.email ?? null,
    isGuest: Boolean(user.is_anonymous),
  };
}
