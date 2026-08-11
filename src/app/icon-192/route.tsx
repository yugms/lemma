import { appIcon } from "@/lib/app-icon";

/**
 * Named `icon-192` rather than sitting under Next's `icon` convention because
 * `icon.svg` already owns that slot, and because the manifest has to name a
 * stable URL. The `icon` entry in the proxy matcher already excludes this by
 * prefix — `mobile.test.ts` pins that, since otherwise every icon fetch drags
 * a Supabase session refresh behind it.
 */
export function GET() {
  return appIcon(192);
}
