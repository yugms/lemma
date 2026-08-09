import type { CookieOptionsWithName } from "@supabase/ssr";
import { isProduction } from "@/lib/env";

/**
 * Attributes for the Supabase session cookie, shared by all three clients.
 *
 * `@supabase/ssr` applies its own `DEFAULT_COOKIE_OPTIONS` when this is not
 * supplied, and that default has **no `secure` key at all** — so the session
 * cookie shipped without the attribute. HSTS and `upgrade-insecure-requests`
 * already meant nothing traversed plain HTTP, but neither of those is the
 * cookie's own instruction to the browser, and the first request from a client
 * that has never seen the HSTS header is exactly the case the attribute covers.
 *
 * Three of the four values below are the library's defaults, restated because a
 * partial `cookieOptions` object replaces the defaults wholesale rather than
 * merging with them — omitting one here would silently drop it.
 */
export function authCookieOptions(): CookieOptionsWithName {
  return {
    path: "/",

    /**
     * Must stay `lax`, not `strict`.
     *
     * Google sign-in returns through a cross-site top-level navigation to
     * `/auth/callback`, and `strict` withholds cookies on exactly that, so the
     * PKCE verifier would be missing at the one moment it is needed and every
     * sign-in would fail with a code-verifier error.
     */
    sameSite: "lax",

    /**
     * Cannot be `true`. The browser client reads the session back out of
     * `document.cookie` (`client.ts`), so an HttpOnly cookie would break every
     * client-side auth path — silently, since the read just returns nothing.
     * The compensating control is the nonce + `strict-dynamic` `script-src` in
     * `csp.ts`, which is what keeps foreign script off the origin in the first
     * place.
     */
    httpOnly: false,

    /**
     * The library default of 400 days, restated so it is a decision rather than
     * an inheritance.
     *
     * Shortening this looks like hardening and is actually data loss: a guest's
     * identity lives *only* in this cookie, so an expiry orphans their sets and
     * their whole practice history permanently, with no way to recover it. The
     * session is not a bearer credential to somebody else's account here — for
     * most users it is the account.
     */
    maxAge: 400 * 24 * 60 * 60,

    /**
     * Skipped outside production because a production build served over plain
     * HTTP from a LAN address — testing the phone camera against `npm start`,
     * say — would have its cookie writes silently dropped. `localhost` counts
     * as a trustworthy origin in current browsers, so `npm start` locally is
     * unaffected either way.
     */
    secure: isProduction(),
  };
}
