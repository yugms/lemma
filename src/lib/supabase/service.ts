import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseSecretKey, supabaseUrl } from "@/lib/env";

/**
 * Server-only client using the secret API key (`sb_secret_...`), the
 * replacement for the legacy `service_role` JWT. Bypasses RLS — never import
 * from client code.
 */
export function createServiceClient() {
  return createSupabaseClient(supabaseUrl(), supabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
