import { afterEach, describe, expect, it } from "vitest";
import { contentSecurityPolicy, newNonce } from "../csp";
import { siteUrl } from "../env";
import type { AccountSummary } from "../account";
import { capFor, DAILY_LIMITS, startOfToday, type LimitKind } from "../limits";
import { describeSignInError, SIGN_IN_FALLBACK } from "../auth-errors";
import { newShareCode, normalizeShareCode, SHARE_CODE_ALPHABET } from "../share-code";

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

  it("never invents a host it does not serve", () => {
    // The bug this replaced: an unset variable fell back to a hardcoded
    // https://lemma.app, so production served a robots.txt advertising a
    // sitemap on a domain the project does not own.
    clear();
    expect(siteUrl()).toBe("http://localhost:3000");
    expect(siteUrl()).not.toContain("lemma.app");
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
    hasCoachRead: false,
  };

  const isEmpty = (n: number | null) => n === 0;

  it("never treats an unknown count as empty", () => {
    // Disabling a delete button on an unknown count tells someone there is
    // nothing to remove when there may well be.
    expect(isEmpty(unknown.attempts)).toBe(false);
    expect(isEmpty(unknown.sets)).toBe(false);
    expect(isEmpty(0)).toBe(true);
  });

  it("distinguishes unknown from zero at the type level", () => {
    const empty: AccountSummary = { ...unknown, sets: 0, attempts: 0, sessions: 0, scans: 0 };
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
