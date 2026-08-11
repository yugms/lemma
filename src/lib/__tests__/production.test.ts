import { afterEach, describe, expect, it, vi } from "vitest";
import { contentSecurityPolicy, newNonce } from "../csp";
import { siteUrl, turnstileSiteKey } from "../env";
import type { AccountSummary } from "../account";
import {
  capFor,
  clientIp,
  DAILY_LIMITS,
  IP_LIMITS,
  startOfToday,
  type LimitKind,
} from "../limits";
import { authCookieOptions } from "../supabase/cookie-options";
import {
  affirmationRecord,
  MIN_AGE,
  MIN_AGE_STRICT,
  parseStoredAffirmation,
} from "../age-gate";
import { describeSignInError, SIGN_IN_FALLBACK } from "../auth-errors";
import { newShareCode, normalizeShareCode, SHARE_CODE_ALPHABET } from "../share-code";
import robots, { AI_AGENTS } from "../../app/robots";
import nextConfig from "../../../next.config";

/**
 * The pieces that only matter once real people are using this: the security
 * header, the spend caps, the sign-in copy, and the public share-link guard.
 *
 * All four are things that fail quietly. A CSP that drops a directive still
 * returns 200; a cap with the wrong sign lets everything through; an unmapped
 * error code shows a blank sentence; a loose share-code regex sends arbitrary
 * strings to the database.
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

describe("canonical site URL", () => {
  const HOST_VARS = [
    "NEXT_PUBLIC_SITE_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
    "VERCEL_URL",
    // Decides whether a deployment is allowed to answer with its own host, so
    // it has to be cleared between cases like the rest.
    "VERCEL_ENV",
  ] as const;
  const saved = Object.fromEntries(HOST_VARS.map((k) => [k, process.env[k]]));

  afterEach(() => {
    for (const key of HOST_VARS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  const clear = () => HOST_VARS.forEach((k) => delete process.env[k]);

  it("prefers explicit configuration", () => {
    clear();
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "ignored.vercel.app";
    process.env.NEXT_PUBLIC_SITE_URL = "https://lemma.example";
    expect(siteUrl()).toBe("https://lemma.example");
  });

  it("strips a trailing slash so concatenation does not double it", () => {
    // sitemap.ts builds `${base}/build`; a trailing slash there yields `//build`.
    clear();
    process.env.NEXT_PUBLIC_SITE_URL = "https://lemma.example/";
    expect(siteUrl()).toBe("https://lemma.example");
  });

  it("falls back to the Vercel production host before the deployment host", () => {
    clear();
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "lemma.vercel.app";
    process.env.VERCEL_URL = "lemma-abc123.vercel.app";
    // A preview must not claim the production origin, and production must not
    // advertise a per-deployment URL that changes on every push.
    expect(siteUrl()).toBe("https://lemma.vercel.app");
  });

  it("lets a preview deployment describe itself", () => {
    clear();
    process.env.VERCEL_URL = "lemma-abc123.vercel.app";
    expect(siteUrl()).toBe("https://lemma-abc123.vercel.app");
  });

  it("lets a preview describe itself even when a site URL is configured", () => {
    // The case the ordering used to get wrong. NEXT_PUBLIC_SITE_URL is set once
    // per Vercel project and applies to every environment, so with the explicit
    // value checked first every preview answered with the production origin —
    // a robots.txt pointing at the real sitemap, canonicals claiming the real
    // pages, and a link to the preview unfurling as the live site.
    clear();
    process.env.VERCEL_ENV = "preview";
    process.env.NEXT_PUBLIC_SITE_URL = "https://lemma.example";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "lemma.vercel.app";
    process.env.VERCEL_URL = "lemma-abc123.vercel.app";
    expect(siteUrl()).toBe("https://lemma-abc123.vercel.app");
  });

  it("still prefers the configured site URL in production", () => {
    // Only `VERCEL_ENV` separates the two — both host variables are set on a
    // preview build as well, so the branch above must not catch production.
    clear();
    process.env.VERCEL_ENV = "production";
    process.env.NEXT_PUBLIC_SITE_URL = "https://lemma.example";
    process.env.VERCEL_URL = "lemma-abc123.vercel.app";
    expect(siteUrl()).toBe("https://lemma.example");
  });

  it("never invents a host it does not serve", () => {
    // The bug this replaced: an unset variable fell back to a hardcoded
    // https://lemma.app, so production served a robots.txt advertising a
    // sitemap on a domain the project does not own.
    clear();
    expect(siteUrl()).toBe("http://localhost:3000");
    expect(siteUrl()).not.toContain("lemma.app");
  });
});

describe("captcha is off unless configured", () => {
  const saved = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    else process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = saved;
  });

  it("reports no site key when unset or blank", () => {
    // The safety property the whole feature rests on: with no key, captcha.ts
    // loads no script, contacts Cloudflare not at all, and guest sign-in is
    // byte-for-byte the behaviour that shipped before it. Shipping the code and
    // enabling the check are therefore separate, reversible steps.
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    expect(turnstileSiteKey()).toBeNull();

    // An empty string is what a half-filled Vercel env var looks like, and it
    // must read as "off" rather than as a key that will fail every challenge.
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "";
    expect(turnstileSiteKey()).toBeNull();
  });

  it("reports the key when set", () => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "0x4AAAAAAATest";
    expect(turnstileSiteKey()).toBe("0x4AAAAAAATest");
  });
});

describe("daily limits", () => {
  const kinds = Object.keys(DAILY_LIMITS) as LimitKind[];

  it("is never more generous to a guest than to a signed-in user", () => {
    for (const kind of kinds) {
      const { guest, member } = DAILY_LIMITS[kind];
      expect(guest, `${kind} guest cap`).toBeGreaterThan(0);
      expect(member, `${kind} member cap`).toBeGreaterThanOrEqual(guest);
    }
  });

  it("picks the cap by account type", () => {
    for (const kind of kinds) {
      expect(capFor(kind, true)).toBe(DAILY_LIMITS[kind].guest);
      expect(capFor(kind, false)).toBe(DAILY_LIMITS[kind].member);
    }
  });

  it("gives grading a budget far above ordinary practice", () => {
    // Being over this one degrades what a student gets back, unlike the others
    // which simply refuse. A long session is tens of problems, not hundreds —
    // if this ever drops near that range, the degradation stops being rare.
    expect(DAILY_LIMITS.aiGrading.guest).toBeGreaterThanOrEqual(50);
    expect(DAILY_LIMITS.aiGrading.member).toBeGreaterThanOrEqual(150);
  });

  it("counts from local midnight", () => {
    const since = startOfToday();
    expect([since.getHours(), since.getMinutes(), since.getSeconds()]).toEqual([0, 0, 0]);
    expect(since.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("robots.txt", () => {
  const rules = () => {
    const result = robots().rules;
    return Array.isArray(result) ? result : [result];
  };

  it("keeps the private paths out of every group that is allowed in", () => {
    // Named user-agent groups replace the wildcard group rather than adding to
    // it, so a crawler matching one of these never reads the `*` rule. Listing
    // an agent by name to grant it access therefore also grants it everything
    // the wildcard rule was holding back, unless the disallows are repeated.
    for (const rule of rules()) {
      if (rule.disallow === "/") continue;
      expect(rule.disallow, `${String(rule.userAgent)} is allowed in`).toEqual(
        AI_AGENTS.privatePaths
      );
    }
  });

  it("puts each AI agent in exactly one group", () => {
    // A user-agent named twice is resolved by the crawler, not by us, and the
    // two vendors' search and training bots have confusingly similar names —
    // `ClaudeBot` trains, `Claude-SearchBot` searches.
    const all = [...AI_AGENTS.search, ...AI_AGENTS.training];
    expect(new Set(all.map((a) => a.toLowerCase())).size).toBe(all.length);
  });

  it("blocks the training crawlers outright", () => {
    const blocked = rules().find((r) => r.disallow === "/");
    expect(blocked?.userAgent).toEqual(AI_AGENTS.training);
    for (const agent of ["GPTBot", "ClaudeBot", "CCBot", "Google-Extended"]) {
      expect(AI_AGENTS.training).toContain(agent);
      expect(AI_AGENTS.search).not.toContain(agent);
    }
  });

  it("still points at the sitemap", () => {
    expect(robots().sitemap).toBe(`${siteUrl()}/sitemap.xml`);
  });
});

describe("per-network limits", () => {
  it("measures every bucket against a per-user cap that exists", () => {
    // The check below indexes DAILY_LIMITS by an IP_LIMITS key through a cast,
    // so a bucket with no matching daily cap reads `undefined.member` and takes
    // the whole suite down with a TypeError rather than naming what is missing.
    for (const kind of Object.keys(IP_LIMITS)) {
      expect(DAILY_LIMITS[kind as LimitKind], `${kind} has no per-user cap`).toBeDefined();
    }
  });

  it("leaves room for a shared network on every bucket", () => {
    // The failure mode these are tuned against is a classroom or a library
    // behind one address, where thirty students look like one caller. A burst
    // allowance at or below the per-user daily cap lets one student spend the
    // whole room's, and to everyone else the site just appears broken — which
    // gets reported as a bug rather than as a limit, if it gets reported at all.
    for (const [kind, limit] of Object.entries(IP_LIMITS)) {
      const perUserDaily = DAILY_LIMITS[kind as keyof typeof IP_LIMITS].member;
      expect(limit.burst.max, `${kind} burst`).toBeGreaterThanOrEqual(perUserDaily * 1.5);
      expect(limit.day.max, `${kind} day`).toBeGreaterThan(limit.burst.max);
      expect(limit.burst.seconds, `${kind} burst window`).toBeLessThan(limit.day.seconds);
    }
  });

  it("reads the edge-set header in preference to the client-set one", () => {
    // `x-forwarded-for` is whatever the caller sent until a proxy overwrites
    // it; `x-vercel-forwarded-for` is stamped at the edge. Preferring the
    // wrong one would let a caller pick its own bucket, and therefore a fresh
    // allowance per request.
    const headers = new Headers({
      "x-vercel-forwarded-for": "203.0.113.7",
      "x-forwarded-for": "198.51.100.1",
    });
    expect(clientIp(headers)).toBe("203.0.113.7");
  });

  it("takes only the first hop, and nothing when there is no header", () => {
    // The tail of an XFF chain is proxies, not callers — counting a proxy as
    // its own subject would give every request through it a clean slate.
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18" }))).toBe(
      "203.0.113.7"
    );
    expect(clientIp(new Headers({ "x-forwarded-for": "  203.0.113.7  " }))).toBe("203.0.113.7");
    // Local development has neither header; `ipAllowance` reads null as "skip".
    expect(clientIp(new Headers())).toBeNull();
    expect(clientIp(new Headers({ "x-forwarded-for": "" }))).toBeNull();
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

describe("age declaration", () => {
  it("accepts only a record it wrote itself", () => {
    // localStorage is writable by anything on the origin and outlives deploys,
    // so anything unrecognised has to mean "ask again" rather than "assume yes".
    expect(parseStoredAffirmation(JSON.stringify({ at: "2026-08-04T10:00:00.000Z" }))).toBe(true);
    expect(parseStoredAffirmation(null)).toBe(false);
    expect(parseStoredAffirmation("")).toBe(false);
    expect(parseStoredAffirmation("true")).toBe(false);
    expect(parseStoredAffirmation("{not json")).toBe(false);
    expect(parseStoredAffirmation(JSON.stringify({ at: "yesterday" }))).toBe(false);
    expect(parseStoredAffirmation(JSON.stringify({ at: 1754300000000 }))).toBe(false);
    expect(parseStoredAffirmation(JSON.stringify({}))).toBe(false);
  });

  it("records when it was given, and no date of birth", () => {
    const record = affirmationRecord(new Date("2026-08-04T10:00:00.000Z"));
    expect(record.age_affirmed_at).toBe("2026-08-04T10:00:00.000Z");
    expect(record.age_minimum_declared).toBe(MIN_AGE);
    // The privacy policy says a birth date is neither asked for nor stored, so
    // this object is what has to stay true to that.
    expect(Object.keys(record).sort()).toEqual(["age_affirmed_at", "age_minimum_declared"]);
  });

  it("states a minimum that matches the published policy", () => {
    expect(MIN_AGE).toBe(13);
    expect(MIN_AGE_STRICT).toBe(16);
  });
});

describe("account summary counts", () => {
  /**
   * The type is the contract here, so this is a type-level guard plus the two
   * rules that depend on it. `loadAccountSummary` itself hits the database and
   * is covered by `live-account.test.ts`.
   *
   * Background: this originally threw when a count failed, on the reasoning
   * that "0" is the one wrong answer before a permanent deletion. That was the
   * wrong fix — one flaky count then 500'd the page, and the page is the only
   * route to the deletion controls, so someone trying to erase their data found
   * the controls gone. It happened in production. `null` now means "unknown".
   */
  const unknown: AccountSummary = {
    sets: null,
    attempts: null,
    sessions: null,
    scans: null,
    materials: null,
    hasCoachRead: false,
  };

  const isEmpty = (n: number | null) => n === 0;

  it("never treats an unknown count as empty", () => {
    // Disabling a delete button on an unknown count tells someone there is
    // nothing to remove when there may well be.
    expect(isEmpty(unknown.attempts)).toBe(false);
    expect(isEmpty(unknown.sets)).toBe(false);
    expect(isEmpty(unknown.materials)).toBe(false);
    expect(isEmpty(0)).toBe(true);
  });

  it("distinguishes unknown from zero at the type level", () => {
    const empty: AccountSummary = {
      ...unknown,
      sets: 0,
      attempts: 0,
      sessions: 0,
      scans: 0,
      materials: 0,
    };
    expect(empty.sets).toBe(0);
    expect(unknown.sets).toBeNull();
    // A renderer showing `value ?? "—"` must produce a dash, not a zero.
    expect(unknown.sets ?? "—").toBe("—");
    expect(empty.sets ?? "—").toBe(0);
  });
});

describe("sign-in error copy", () => {
  it("always returns a sentence", () => {
    for (const code of [undefined, null, "", "something_new_from_supabase"]) {
      expect(describeSignInError(code)).toBe(SIGN_IN_FALLBACK);
    }
    expect(SIGN_IN_FALLBACK.length).toBeGreaterThan(0);
  });

  it("names the two failures that actually happened on this project", () => {
    // Both were hit in production and cost real debugging time: manual linking
    // is off by default, and the provider has to be switched on separately.
    const linking = describeSignInError("manual_linking_disabled");
    expect(linking).not.toBe(SIGN_IN_FALLBACK);
    expect(linking).toMatch(/manual linking/i);

    const provider = describeSignInError("provider_disabled");
    expect(provider).not.toBe(SIGN_IN_FALLBACK);
    expect(provider).toMatch(/google/i);
  });

  it("reassures the student their guest work survives, where that is true", () => {
    // The failures where nothing was lost should say so — a guest who thinks
    // their sets are gone has no reason to try again.
    for (const code of ["manual_linking_disabled", "unexpected_failure"]) {
      expect(describeSignInError(code).length).toBeGreaterThan(20);
    }
    expect(SIGN_IN_FALLBACK).toMatch(/safe/i);
  });
});

describe("share codes", () => {
  it("mints codes from the read-aloud-safe alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = newShareCode();
      expect(code).toHaveLength(8);
      for (const ch of code) expect(SHARE_CODE_ALPHABET).toContain(ch);
    }
  });

  it("omits the characters that get misread", () => {
    for (const ambiguous of ["I", "O", "0", "1"]) {
      expect(SHARE_CODE_ALPHABET).not.toContain(ambiguous);
    }
  });

  it("accepts its own codes, in any case, with stray whitespace", () => {
    const code = newShareCode();
    expect(normalizeShareCode(code)).toBe(code);
    expect(normalizeShareCode(`  ${code.toLowerCase()}  `)).toBe(code);
  });

  it("rejects anything malformed before it reaches the database", () => {
    // This is what stops a share URL being used to probe with arbitrary
    // strings, so the rejections matter more than the acceptances.
    for (const bad of [
      "",
      "SHORT",
      "TOOLONGCODE",
      "ABCDEFG!",
      "ABCDEF01", // 0 and 1 are not in the alphabet
      "'; drop table problem_sets; --",
      "../../etc/passwd",
    ]) {
      expect(normalizeShareCode(bad), bad).toBeNull();
    }
  });
});
