/**
 * Every environment variable the app reads, resolved in one place.
 *
 * Previously each consumer wrote `process.env.X!`, so a missing value surfaced
 * as `supabaseUrl is required` thrown from inside a vendor module — true, but it
 * names neither the variable nor where to set it. These helpers fail with the
 * variable name and the fix.
 *
 * `NEXT_PUBLIC_*` values are substituted by the bundler at build time, and that
 * only happens for a *literal* `process.env.NAME` expression. A dynamic lookup
 * (`process.env[name]`) compiles to an undefined read in the browser, so the
 * public reads below are spelled out rather than driven from a list.
 */

function required(name: string, value: string | undefined, hint: string): string {
  if (!value) throw new Error(`${name} is not set. ${hint}`);
  return value;
}

const SUPABASE_HINT =
  "Find it in the Supabase dashboard under Project Settings > API, and add it to .env.local (locally) or the Vercel project's environment variables (deployed).";

export function supabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_HINT);
}

export function supabasePublishableKey(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_HINT
  );
}

/** Server only — bypasses RLS. Never reached from a client component. */
export function supabaseSecretKey(): string {
  return required(
    "SUPABASE_SECRET_KEY",
    process.env.SUPABASE_SECRET_KEY,
    'Create one under Project Settings > API > "Secret keys". It bypasses RLS, so it must never be exposed to the browser.'
  );
}

export function geminiApiKey(): string {
  return required(
    "GEMINI_API_KEY",
    process.env.GEMINI_API_KEY,
    "Create a free key at https://aistudio.google.com/apikey (no card required)."
  );
}

/**
 * The canonical origin, without a trailing slash.
 *
 * Order matters, and the reason is a bug this replaced: the old fallback was a
 * hardcoded `https://lemma.app`, a domain the project does not own, so an unset
 * variable shipped a `robots.txt` advertising someone else's sitemap and OG
 * tags pointing off-site. Nothing here can produce a host we do not serve.
 *
 * Vercel sets `VERCEL_PROJECT_PRODUCTION_URL` to the project's production
 * domain and `VERCEL_URL` to this specific deployment, so on the platform this
 * app actually runs on the answer is always available even with nothing
 * configured.
 *
 * The last resort is localhost and a warning rather than a throw. Throwing was
 * tried and it fails a plain `npm run build` on a developer's machine, which is
 * too routine a command to break; and an obviously-wrong `http://localhost:3000`
 * in a stray robots.txt is a far smaller problem than confidently naming a
 * domain someone else owns, which is the bug this replaced.
 *
 * Server-only: `VERCEL_*` are not `NEXT_PUBLIC_`, so this must not be called
 * from a client component.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return withoutTrailingSlash(explicit);

  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (productionHost) return `https://${productionHost}`;

  // A preview deployment describes itself; a preview must not claim to be the
  // production origin, or its metadata competes with the real site's.
  const deploymentHost = process.env.VERCEL_URL;
  if (deploymentHost) return `https://${deploymentHost}`;

  if (process.env.NODE_ENV === "production") warnOnce();
  return "http://localhost:3000";
}

let warned = false;
function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn(
    "[lemma] NEXT_PUBLIC_SITE_URL is not set and no Vercel host was found, so canonical URLs, Open Graph tags, robots.txt and sitemap.xml will all say http://localhost:3000. Set it to the origin this deployment is served from."
  );
}

function withoutTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
