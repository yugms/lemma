import { afterEach, describe, expect, it } from "vitest";
import { siteUrl, turnstileSiteKey } from "../env";

/**
 * `env.ts` is the only place `process.env` is read, so this is where the
 * answers it gives are pinned — most of all the fallback order behind
 * `siteUrl()`, where every wrong answer is a host the deployment does not
 * serve.
 */

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
