import { afterEach, describe, expect, it, vi } from "vitest";
import { contentSecurityPolicy, newNonce } from "../csp";
import { authCookieOptions } from "../supabase/cookie-options";
import nextConfig from "../../../next.config";

/**
 * What the browser is told about this origin: the CSP, the session cookie's
 * attributes, and the static headers a CSP cannot express.
 *
 * All of it fails quietly. A CSP that drops a directive still returns 200, a
 * cookie missing `Secure` is still set, and a missing `no-store` on /api only
 * shows up as one account seeing another's grade out of a shared cache.
 */

describe("content security policy", () => {
  const build = (isDev: boolean) =>
    contentSecurityPolicy({
      nonce: "TESTNONCE",
      supabaseOrigin: "https://example.supabase.co",
      isDev,
    });

  it("carries the nonce and never falls back to unsafe-inline for scripts", () => {
    const csp = build(false);
    expect(csp).toContain("'nonce-TESTNONCE'");
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    // The whole point of the nonce plumbing. 'unsafe-inline' here would make it
    // decorative, and would do so silently.
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("allows inline styles deliberately", () => {
    // A nonce in style-src would *disable* 'unsafe-inline' rather than add to
    // it, breaking progress meters and next/font. See the note in csp.ts.
    const styleSrc = build(false).split("; ").find((d) => d.startsWith("style-src"))!;
    expect(styleSrc).toContain("'unsafe-inline'");
    expect(styleSrc).not.toContain("nonce");
  });

  it("reaches Supabase and nothing else", () => {
    const connect = build(false).split("; ").find((d) => d.startsWith("connect-src"))!;
    expect(connect).toContain("https://example.supabase.co");
    expect(connect).toContain("'self'");
  });

  it("locks down framing, objects and the base tag", () => {
    const csp = build(false);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it("confines the development-only allowances to development", () => {
    const prod = build(false);
    expect(prod).not.toContain("unsafe-eval");
    expect(prod).not.toContain("ws:");
    expect(prod).toContain("upgrade-insecure-requests");

    const dev = build(true);
    // React uses eval in dev to rebuild server stacks, and HMR needs a socket.
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain("ws:");
    // Would break plain-http localhost, and there is nothing to upgrade there.
    expect(dev).not.toContain("upgrade-insecure-requests");
  });

  it("lets the Turnstile challenge actually render", () => {
    const csp = build(false);
    const directive = (name: string) =>
      csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

    // The challenge is an iframe. With no frame-src at all it falls back to
    // `default-src 'self'` and is blocked — which would break guest sign-in
    // outright, and only in production, since nothing else on the site frames
    // anything.
    expect(directive("frame-src")).toContain("https://challenges.cloudflare.com");
    expect(directive("connect-src")).toContain("https://challenges.cloudflare.com");
    // Redundant under strict-dynamic, but browsers predating it ignore
    // strict-dynamic and fall back to the allowlist.
    expect(directive("script-src")).toContain("https://challenges.cloudflare.com");
  });

  it("still frames nothing itself", () => {
    // Allowing Cloudflare to be framed by us must not become us being frameable.
    expect(build(false)).toContain("frame-ancestors 'none'");
  });

  it("mints a different nonce every time", () => {
    const nonces = new Set(Array.from({ length: 50 }, newNonce));
    expect(nonces.size).toBe(50);
    // Must survive a CSP header parser unquoted.
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

describe("session cookie attributes", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is marked Secure in production", () => {
    // @supabase/ssr's DEFAULT_COOKIE_OPTIONS has no `secure` key at all, so
    // omitting cookieOptions ships the session without the attribute.
    vi.stubEnv("NODE_ENV", "production");
    expect(authCookieOptions().secure).toBe(true);
  });

  it("is not Secure outside production", () => {
    // A production build served over plain http from a LAN address — testing
    // the phone camera against `npm start` — would otherwise have every cookie
    // write silently dropped.
    vi.stubEnv("NODE_ENV", "development");
    expect(authCookieOptions().secure).toBe(false);
  });

  it("keeps the three attributes that are load-bearing elsewhere", () => {
    const options = authCookieOptions();
    // Not `strict`: Google returns through a cross-site top-level navigation,
    // and `strict` withholds the cookie on exactly that, so the PKCE verifier
    // would be missing and every sign-in would fail.
    expect(options.sameSite).toBe("lax");
    // Cannot be true — the browser client reads the session from
    // document.cookie, and an HttpOnly cookie breaks that silently.
    expect(options.httpOnly).toBe(false);
    // Deliberately long. A guest's identity lives only here, so an expiry is
    // not a shorter attack window, it is permanent loss of their work.
    expect(options.maxAge).toBeGreaterThan(300 * 24 * 60 * 60);
  });
});

describe("static security headers", () => {
  it("sets the ones a CSP cannot express", async () => {
    const headers = (await nextConfig.headers!()).find((h) => h.source === "/:path*")!.headers;
    const value = (key: string) => headers.find((h) => h.key === key)?.value ?? "";

    expect(value("Strict-Transport-Security")).toContain("max-age=");
    expect(value("X-Content-Type-Options")).toBe("nosniff");
    expect(value("X-Frame-Options")).toBe("DENY");
    expect(value("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    // Safe only while Google sign-in is a full-page redirect. Adding
    // `skipBrowserRedirect` would make it a popup and this would break it.
    expect(value("Cross-Origin-Opener-Policy")).toBe("same-origin");
  });

  it("keeps per-user API responses out of shared caches", async () => {
    // Every route under /api returns something belonging to one account — a
    // grade, a set, a scan result — and none of them said so themselves.
    const api = (await nextConfig.headers!()).find((h) => h.source === "/api/:path*")!;
    expect(api.headers.find((h) => h.key === "Cache-Control")?.value).toBe("no-store");
  });
});
