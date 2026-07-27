import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only client using the secret API key (`sb_secret_...`), the
 * replacement for the legacy `service_role` JWT. Bypasses RLS — never import
 * from client code.
 */
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
