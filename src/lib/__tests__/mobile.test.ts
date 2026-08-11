import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { describe, expect, it } from "vitest";
import manifest from "../../app/manifest";
import { config as proxyConfig } from "../../proxy";
import { hidesTabBar, NAV } from "../nav";
import { THEME_COLORS } from "../theme-color";

/**
 * The mobile invariants, all four of which fail silently.
 *
 * That is the whole reason this file exists. A CSS override defeated by layer
 * order still compiles; a route added to the wrong list still renders; a
 * manifest missing an icon size still installs, just badly. None of it throws,
 * none of it shows in a diff, and all of it is only visible on a device the
 * person making the change is probably not holding.
 */

const SRC = resolve(__dirname, "../..");
const GLOBALS = readFileSync(join(SRC, "app/globals.css"), "utf8");
/** Read as source, not imported: `layout.tsx` pulls in `next/font/google`,
 *  which only resolves inside a Next build. */
const LAYOUT = readFileSync(join(SRC, "app/layout.tsx"), "utf8");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      out.push(...walk(full));
    } else if (/\.tsx$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("inputs stay at 16px on a phone", () => {
  /**
   * Under 16px, iOS Safari zooms the viewport when an input takes focus and
   * does not zoom back out. A zoomed page puts the control that submits the
   * answer off-screen, which is the thing the sticky action row exists to
   * prevent — so this is a one-utility regression away from undoing a whole
   * commit, with no symptom anywhere but on an iPhone.
   */
  it("declares the coarse-pointer rule outside every @layer", () => {
    // `@layer components` loses to `@layer utilities`, where Tailwind puts
    // `text-sm`. The rule only wins from outside the layer stack.
    const layerBlocks = [...GLOBALS.matchAll(/@layer\s+[\w\s,]*\{/g)].map((m) => m.index!);
    const rule = GLOBALS.indexOf("@media (pointer: coarse)");
    expect(rule, "coarse-pointer block is missing from globals.css").toBeGreaterThan(-1);

    // Everything after the last `@layer ... {` opening brace that is still
    // inside it would be nested; the touch block sits after the layers close,
    // beside the print block, so assert it comes after the print-adjacent
    // marker rather than trying to brace-match in a regex.
    const fieldRule = GLOBALS.slice(rule, GLOBALS.indexOf("/* ── Print", rule));
    expect(fieldRule).toMatch(/\.field\s*\{[^}]*font-size:\s*16px/);
    expect(layerBlocks.every((i) => i < rule)).toBe(true);
  });

  it("has no .field call site setting its own unprefixed font size", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/className=\{?["`]([^"`]*\bfield\b[^"`]*)["`]/g)) {
        const classes = m[1].split(/\s+/);
        // A breakpoint-prefixed size is fine — `sm:` cannot apply on a phone.
        const bare = classes.filter((c) => /^text-(xs|sm|base|lg|\[)/.test(c));
        if (bare.length > 0) {
          offenders.push(`${file.slice(SRC.length + 1)}: ${bare.join(" ")}`);
        }
      }
    }
    expect(
      offenders,
      "prefix these with sm: — an unprefixed text size beats the coarse-pointer rule and iOS will zoom on focus"
    ).toEqual([]);
  });
});

describe("the phone tab bar", () => {
  it("never hides itself on a route it links to", () => {
    // Adding /sets to the immersive list would strand a phone with no visible
    // navigation at all, and nothing else would report it.
    for (const item of NAV) {
      expect(hidesTabBar(item.href), `${item.href} is in the immersive list`).toBe(false);
    }
    for (const href of ["/", "/account", "/materials", "/signin"]) {
      expect(hidesTabBar(href)).toBe(false);
    }
  });

  it("stands down on the routes that run their own bottom bar", () => {
    for (const tail of ["practice", "quiz", "flashcards", "scan", "print"]) {
      expect(hidesTabBar(`/set/abc123/${tail}`)).toBe(true);
    }
    // The set overview is not immersive — it is a normal page with links out.
    expect(hidesTabBar("/set/abc123")).toBe(false);
  });

  it("is hidden when printing", () => {
    // Otherwise every page sent to a printer carries a nav bar across the
    // bottom of page one, which is only ever discovered on paper.
    const printBlock = GLOBALS.slice(GLOBALS.indexOf("@media print"));
    const hideRule = printBlock.slice(0, printBlock.indexOf("display: none !important"));
    expect(hideRule).toContain(".mobile-tabs");
    expect(hideRule).toContain(".mobile-tabs-spacer");
    expect(hideRule).toContain(".site-header");
  });
});

describe("install metadata", () => {
  const m = manifest();

  it("names its own identity and scope", () => {
    // Without `id` the browser derives one from `start_url`, so moving the
    // landing route later registers a second app beside the first.
    expect(m.id).toBe("/");
    expect(m.scope).toBe("/");
    expect(m.start_url).toBe("/");
  });

  it("ships the raster sizes an install prompt needs", () => {
    const icons = m.icons ?? [];
    const sizes = icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    // A maskable icon is cropped to the platform's own shape; without one
    // Android falls back to a screenshot of the page.
    expect(icons.some((i) => i.purpose === "maskable")).toBe(true);
  });

  it("agrees with the layout about the theme colour", () => {
    // In standalone these paint adjacent surfaces — the status bar against the
    // page — and they disagreed by oxblood-versus-cream. Both now read
    // THEME_COLORS, so this asserts the wiring rather than the value.
    expect(m.theme_color).toBe(THEME_COLORS.light);
    expect(m.background_color).toBe(THEME_COLORS.light);
    expect(LAYOUT).toContain("THEME_COLORS.light");
    expect(LAYOUT).toContain("THEME_COLORS.dark");
  });

  it("declares viewport-fit, which every safe-area rule depends on", () => {
    // Without it `env(safe-area-inset-*)` resolves to 0 everywhere: the tab bar
    // sits under the home indicator and the header under the notch, with
    // nothing in the CSS to suggest why.
    expect(LAYOUT).toMatch(/viewportFit:\s*"cover"/);
    expect(GLOBALS).toContain("env(safe-area-inset-bottom");
  });

  it("keeps the icon routes off the session-refresh path", () => {
    // The proxy runs a Supabase getUser() on everything it matches; dragging
    // that round-trip behind an icon fetch is pure cost.
    // Anchored, the way Next applies a matcher — unanchored it would match a
    // substring and report the opposite of the truth.
    const matcher = new RegExp(`^${proxyConfig.matcher[0]}$`);
    for (const icon of manifest().icons ?? []) {
      expect(matcher.test(icon.src), `${icon.src} is matched by the proxy`).toBe(false);
    }
  });
});
