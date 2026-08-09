import { createBrowserClient } from "@supabase/ssr";
import { supabasePublishableKey, supabaseUrl } from "@/lib/env";
import { authCookieOptions } from "@/lib/supabase/cookie-options";

export function createClient() {
  return createBrowserClient(supabaseUrl(), supabasePublishableKey(), {
    cookieOptions: authCookieOptions(),
  });
}
