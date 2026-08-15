# Architecture

How a set gets built, where the code lives, and what the tests pin. See the [README](../README.md) for the short version.

## The build pipeline

`POST /api/sets` (`maxDuration = 300`) fills a set in cost order and streams progress as SSE.

1. **Pool reuse** — already-verified problems matching the request, excluding anything the student attempted in the last 30 days, least-served first. Capped at half the set.
2. **Templates** — seeded-RNG parametrized generators. The answer is computed, not claimed, so they skip verification entirely.
3. **AI generation** — the requested mix of formats packed into as few authoring calls as it fits in, with verification of each batch starting the moment that batch lands. Authoring and verification share one concurrency budget.

The packing is the whole ballgame on a free tier that meters *requests per day* rather than tokens: a call costs about the same whatever it carries, so the number of calls a set makes is what decides how many sets a day exist. Splitting per format instead made a six-problem set cost twelve requests; it now costs three.

Two budgets exist because a short set beats no set: a 230s build deadline stops *starting* new rounds inside the route's 300s limit, and capacity failures break out of the loop with whatever was already gathered rather than throwing.

### The three branches

**Manual** takes the builder form's settings. **Targeted** takes a plan id and rebuilds the config from the student's own practice record. **Material** takes the id of something they uploaded and reads its stored digest. The last two skip steps 1 and 2 entirely — a set sold as written for you cannot be filled from a pool authored for whoever asked first — and both rebuild everything that reaches a prompt server-side, because a client that could write those strings could write the authoring instructions.

> [!NOTE]
> Every model call in the app goes through one function, `callStructured()` in `src/lib/ai/provider.ts`. It returns `null` for unusable output (callers must degrade) and throws only when the entire model chain is rate-limited. Swapping providers is a change to that one file.

## Project structure

```
src/
├── app/                 # routes — every page is a Server Component
│   ├── api/sets/        # SSE set builder (maxDuration 300)
│   ├── api/check/       # the only path that ever returns an answer key
│   ├── api/scan/        # marks a photographed worksheet
│   ├── build/ sets/     # builder + library
│   ├── set/[id]/        # practice · quiz · flashcards · scan · print
│   ├── review/ stats/   # missed-problem queue · analytics + prescriptions
│   ├── account/         # clear history · delete data · delete account
│   ├── privacy/ terms/  # the legal pages
│   ├── signin/          # owns the sign-in attempt and names its failures
│   └── s/[code]/        # shared-set landing
├── components/          # client components; practice engines, inputs, design bits
├── lib/
│   ├── ai/              # provider, schemas, generation, verification, grading, coach
│   ├── templates/       # deterministic parametrized generators
│   ├── supabase/        # three clients: browser · server (RLS) · service (bypasses RLS)
│   ├── sets.ts          # the build pipeline
│   ├── answers.ts       # normalizeMath and the local grading ladder
│   ├── analytics.ts     # stats derived from attempts
│   ├── limits.ts        # every daily cap, in one table
│   ├── env.ts           # every environment variable, read in one place
│   ├── csp.ts           # the per-request Content-Security-Policy
│   ├── plot.ts          # declarative plot spec → SVG, server-side only
│   ├── print-key.ts     # answer keys for printed worksheets
│   ├── worksheets.ts    # scan uploads and their grading
│   ├── account.ts       # the three levels of data deletion
│   └── math-render.ts   # KaTeX, server-side only
├── tools/seed-pool/     # `npm run seed` — stock the pool offline, no provider call
└── proxy.ts             # Next 16's renamed middleware — session refresh + CSP nonce
```

## Testing

```bash
npm run test                                    # everything offline
npx vitest run src/lib/__tests__/core.test.ts   # one file
npx vitest run -t "normalizeMath"               # one test by name
```

- **`core.test.ts`** — answer normalization and comparison, plus a structural validation of every template across 25 seeds × every declared difficulty and format.
- **`formats.test.ts`** — the per-format round trip: author → split into DB columns → grade → render → print. Keyed off `PROBLEM_FORMATS`, so a new format without a fixture fails here rather than in production.
- **`disclosure.test.ts`** — the rule deciding whether the answer key is in a response, stated as an invariant: across every mode and prior state, nothing both offers a retry and discloses the answer.
- **`coach-plan.test.ts`** — targeted-set configuration. A security boundary as much as a feature: `focus.directives` reaches a model prompt verbatim, so this asserts what comes out is always buildable and that mistake notes are flattened before they land inside a quoted string.
- **`security-headers.test.ts`, `env.test.ts`, `limits.test.ts`** and their smaller siblings (`robots`, `age-gate`, `account-summary`, `auth-errors`, `share-code`) — the pieces that only matter once real people are using this, each named for what it pins. They all fail quietly in production: a CSP that drops a directive still returns 200, a cap with the wrong sign lets everything through, a loose share-code regex sends arbitrary strings to the database.
- **`client-bundle.test.ts`** — that no client component can statically reach zod, KaTeX, the model SDK or the Supabase browser SDK. Four prose rules that nothing enforced until one of them broke and put 283 kB of zod on the landing page.
- **`materials.test.ts`** — what an uploaded document is allowed to become. The digest is the only route from a file to an authoring prompt, and every bound on it is applied in code rather than by the schema, so this is the thing that enforces them.
- **`material-pool.test.ts`** — that problems written from one student's upload cannot collide with the shared pool. `status` alone looks sufficient and isn't; the upsert would overwrite it in either direction.
- **`seed-pool.test.ts`** — the offline half of `npm run seed`: the gates, the cell ranking, and what the authoring subprocess is allowed to inherit.
- **`analytics.test.ts`** — streaks, smoothing and weakness ranking, run against a pure `aggregate()`.
- **`plot.test.ts`** — plot geometry and SVG output, which is a pure string.
- **`scan.test.ts`** — the "not attempted" rule that keeps a blank from being recorded as a miss.
- **`provider-schema.test.ts`** — asserts no schema sent to a model contains `$ref` / `$defs` / `$schema`. Gemini only supports `$ref` in non-required properties, and a regression fails at request time with an opaque 400.

**The six `live-*.test.ts` files** hit the real API or the real database and each self-skips without its key, which is what keeps `npm run test` offline. They cover the claims no mock can make: `live-provider` (a model answers, and in the requested shape), `live-batching` (what a set actually costs in requests — the thing the free tier meters), `live-nondrill` (the production failure where every non-drill style came back empty), `live-material` and `live-material-build` (what a model does with a hostile page, and that a material build leaves the shared pool untouched), and `live-account` (all three deletion levels, against throwaway users it creates and removes). The first five need `GEMINI_API_KEY`; `live-account` needs `SUPABASE_SECRET_KEY`:

```bash
node --env-file=.env.local ./node_modules/vitest/vitest.mjs run src/lib/__tests__/live-provider.test.ts
node --env-file=.env.local ./node_modules/vitest/vitest.mjs run src/lib/__tests__/live-account.test.ts
```

## Invariants that fail silently

The first four keep the client bundle small, and each is one stray `import` from being undone — `client-bundle.test.ts` is what turns that into a failing test rather than a few hundred quiet kilobytes:

- **KaTeX must never reach the browser.** `src/lib/math-render.ts` runs it in Node; `src/components/latex.tsx` only injects the resulting HTML. Importing `katex` from a Client Component adds ~275 kB.
- **The Supabase browser SDK is lazily imported.** Auth is resolved server-side and passed down as a plain prop; `@/lib/auth` is `await import(...)`-ed at the point of a click. A top-level import puts ~64 kB gzipped back on every route.
- **Plots are drawn in Node too.** `src/lib/plot.ts` renders a declarative spec to an SVG string. A plot is a fixed stimulus that never animates, so it doesn't justify a charting library on the client; the geometry half is pure arithmetic and *is* shared with the interactive overlays, so the drawn axes and the click targets agree by construction.
- **The problem vocabulary lives apart from the schemas.** Client components import formats, styles and the exhaustiveness guards from `src/lib/ai/kinds.ts`, never from `schemas.ts` — importing a single *value* from the latter put 283 kB of zod on seven routes, including the landing page.
- **Failure paths degrade, they don't throw** — partial sets, discarded problems, `null` returns. Keep that when adding pipeline steps.
- **Correctness is never colour alone.** Every ok/bad state pairs colour with an icon and a word, and the oxblood accent never appears inside a graded answer region.
- **This is not the Next.js you know.** Read the relevant guide in `node_modules/next/dist/docs/` before writing route code; `params` are Promises and `middleware` is now `proxy.ts`.

`CLAUDE.md` and `AGENTS.md` carry the longer version of all of this.
