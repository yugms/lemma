/**
 * Content Security Policy, built per request.
 *
 * Scripts are nonce-based rather than `'unsafe-inline'`, which is worth the
 * plumbing here: Next reads the nonce out of the request's CSP header and
 * stamps it onto every script it emits, and `'strict-dynamic'` then lets those
 * scripts load their own chunks without the policy having to enumerate them.
 * The usual objection — that nonces force dynamic rendering — costs nothing in
 * this app, because every page already sets `dynamic = "force-dynamic"` and the
 * proxy already runs on every request.
 *
 * Styles are the deliberate exception. A nonce in `style-src` would *disable*
 * `'unsafe-inline'` (CSP ignores it once a nonce or hash is present), and the
 * app emits inline style attributes in ordinary places — progress meters set
 * `style={{ width }}`, and `next/font` injects a `@font-face` block. Blocking
 * those breaks visible UI to defend against a far smaller risk than script
 * injection, so `style-src` stays permissive while `script-src` does not.
 */
/**
 * Cloudflare Turnstile, which guards anonymous sign-up.
 *
 * Listed unconditionally rather than only when a site key is set: the CSP is
 * built in the proxy, which is a different environment from the browser bundle,
 * and a policy that silently differs between the two is exactly the kind of
 * thing that passes every local check and then blocks a challenge in
 * production. Naming a host the app may not contact costs nothing.
 */
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

export function contentSecurityPolicy({
  nonce,
  supabaseOrigin,
  isDev,
}: {
  nonce: string;
  /** Where the browser Supabase client sends auth and data requests. */
  supabaseOrigin: string;
  isDev: boolean;
}): string {
  const directives = [
    `default-src 'self'`,
    // React uses eval in development to rebuild server stacks in the browser.
    // It does not in production, so the allowance is scoped to dev.
    //
    // The Turnstile host is redundant under `strict-dynamic` — the script is
    // injected by app code, which already inherits trust — but browsers that
    // predate `strict-dynamic` ignore it and fall back to this allowlist.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${TURNSTILE_ORIGIN}${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    // `data:` covers the generated icon and OG routes; `blob:` covers the
    // object URLs the scan uploader makes to preview a photo before sending it.
    `img-src 'self' data: blob:`,
    // next/font self-hosts at build time, so nothing external is ever fetched.
    `font-src 'self'`,
    // Dev needs the websocket for hot reload; production talks only to itself,
    // to Supabase, and to Turnstile when a guest session is being created.
    `connect-src 'self' ${supabaseOrigin} ${TURNSTILE_ORIGIN}${isDev ? " ws: wss:" : ""}`,
    // Turnstile renders its challenge in an iframe. Without this the directive
    // falls back to `default-src 'self'` and the challenge is blocked — which
    // would break guest sign-in outright, so it is not optional.
    `frame-src ${TURNSTILE_ORIGIN}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    // The app is never legitimately framed, and this is what actually stops
    // clickjacking — X-Frame-Options is the legacy half of the same rule.
    `frame-ancestors 'none'`,
  ];
  // Would break plain-http localhost, and there is nothing to upgrade there.
  if (!isDev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/**
 * A fresh, unpredictable nonce per request.
 *
 * Base64 of a UUID rather than the raw UUID: `-` is legal in a CSP nonce but
 * the extra encoding keeps it to the alphabet every parser agrees on.
 */
export function newNonce(): string {
  return btoa(crypto.randomUUID());
}
