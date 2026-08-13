import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname, resolve } from "path";
import { describe, expect, it } from "vitest";

/**
 * What the browser is allowed to download.
 *
 * CLAUDE.md states three invariants that keep the client bundle small — KaTeX
 * renders in Node, the Supabase SDK is imported at click time, plots are drawn
 * server-side — and until this file, nothing enforced any of them. All three
 * are one stray `import` from being undone, and none of them fails loudly: the
 * app keeps working, the bundle just quietly grows by a few hundred kilobytes.
 *
 * That is not hypothetical. `src/lib/ai/schemas.ts` defines 36 top-level zod
 * schemas, and four client components imported a *value* from it — a format
 * list, an exhaustiveness helper — which put 283 kB of zod on seven routes
 * including the landing page. Nobody noticed, because there was nothing to
 * notice it.
 *
 * Two things stop the walk, and both are real boundaries rather than
 * conveniences. `await import(...)` gets its own chunk fetched on a click,
 * which is how `@/lib/auth` reaches the browser without costing anything up
 * front. And a `"use server"` module is replaced at the import site by an RPC
 * stub, so a Server Action can pull in the whole server without the caller
 * paying for it — `add-shared-set.tsx` imports one that transitively reaches
 * KaTeX, and none of it ships.
 */

const SRC = resolve(__dirname, "../..");

/** Packages that must never be reachable from a client component. */
const FORBIDDEN: { module: string; why: string }[] = [
  { module: "zod", why: "283 kB of schema runtime; import the vocabulary from @/lib/ai/kinds" },
  { module: "katex", why: "~275 kB; math is rendered in Node by @/lib/math-render" },
  { module: "@google/genai", why: "the model SDK is server-only" },
  { module: "@supabase/supabase-js", why: "~64 kB gzipped; reach it via await import()" },
  { module: "@supabase/ssr", why: "~64 kB gzipped; reach it via await import()" },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const ALL_FILES = walk(SRC);

/** `import ... from "x"` and bare `import "x"`, but never `await import("x")`. */
function staticImports(source: string): string[] {
  // Strip dynamic imports first so the specifier inside one is never matched.
  const withoutDynamic = source.replace(/\bimport\s*\(/g, "importCall(");
  const specifiers: string[] = [];
  const pattern = /^\s*import\s+(?:[\s\S]*?\sfrom\s+)?["']([^"']+)["']/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(withoutDynamic)) !== null) specifiers.push(match[1]!);
  return specifiers;
}

/** Type-only imports are erased by the compiler and cost the browser nothing. */
function valueImports(source: string): string[] {
  const withoutTypeOnly = source.replace(/^\s*import\s+type\s[\s\S]*?["'][^"']+["'];?/gm, "");
  return staticImports(withoutTypeOnly);
}

function resolveLocal(specifier: string, fromFile: string): string | null {
  const base = specifier.startsWith("@/")
    ? join(SRC, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(fromFile), specifier)
      : null;
  if (!base) return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (ALL_FILES.includes(candidate)) return candidate;
  }
  return null;
}

const isServerAction = (source: string) => /^\s*["']use server["']/.test(source);

/** Every package a client entry can reach through static value imports. */
function reachablePackages(entry: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const seen = new Set<string>();
  const queue: { file: string; trail: string[] }[] = [{ file: entry, trail: [entry] }];

  while (queue.length > 0) {
    const { file, trail } = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const source = readFileSync(file, "utf8");
    // The import site becomes an RPC stub, so nothing past here is bundled.
    if (file !== entry && isServerAction(source)) continue;

    for (const specifier of valueImports(source)) {
      const local = resolveLocal(specifier, file);
      if (local) {
        queue.push({ file: local, trail: [...trail, local] });
      } else if (!found.has(specifier)) {
        found.set(specifier, trail);
      }
    }
  }
  return found;
}

/** Every file some other module pulls in eagerly. */
const STATICALLY_IMPORTED = new Set(
  ALL_FILES.flatMap((file) =>
    valueImports(readFileSync(file, "utf8"))
      .map((s) => resolveLocal(s, file))
      .filter((f): f is string => f !== null)
  )
);

/**
 * A client module that lands in a route's initial bundle.
 *
 * Being `"use client"` is not enough on its own. `lib/auth.ts` carries the
 * directive and statically imports the Supabase SDK, but nothing imports *it*
 * statically — every call site does `await import("@/lib/auth")` — so it is the
 * lazy chunk, not the thing that costs. Requiring an eager importer is what
 * tells the two apart.
 */
const CLIENT_ENTRIES = ALL_FILES.filter(
  (f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")) && STATICALLY_IMPORTED.has(f)
);

const shortPath = (p: string) => p.slice(SRC.length + 1).replace(/\\/g, "/");

describe("client bundle", () => {
  it("finds the client components to check", () => {
    // A resolution bug here would make every assertion below pass vacuously.
    expect(CLIENT_ENTRIES.length).toBeGreaterThan(20);
  });

  it.each(FORBIDDEN)("never reaches $module from a client component", ({ module, why }) => {
    const offenders: string[] = [];
    for (const entry of CLIENT_ENTRIES) {
      const trail = reachablePackages(entry).get(module);
      if (trail) offenders.push(trail.map(shortPath).join("\n    -> "));
    }
    expect(offenders, `${module}: ${why}\n\n  ${offenders.join("\n\n  ")}`).toEqual([]);
  });

  it("still allows the lazy escape hatch", () => {
    // The rule is about *static* imports. If this ever fails, the walker has
    // started counting `await import()` and the assertions above are wrong.
    const buildRun = readFileSync(join(SRC, "components/build-run.tsx"), "utf8");
    expect(buildRun).toContain('await import("@/lib/auth")');
    expect(valueImports(buildRun)).not.toContain("@/lib/auth");
  });
});
