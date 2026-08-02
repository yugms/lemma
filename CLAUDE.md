# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev            # next dev
npm run build          # next build
npm start              # next start — serve the production build
npm run lint           # eslint
npm run test           # vitest run (offline tests only)
npx tsc --noEmit       # typecheck — there is no npm script for this

npx vitest run src/lib/__tests__/core.test.ts   # one test file
npx vitest run -t "normalizeMath"               # one test by name

# live-provider.test.ts self-skips without GEMINI_API_KEY; it needs env loaded:
node --env-file=.env.local ./node_modules/vitest/vitest.mjs run src/lib/__tests__/live-provider.test.ts
```

Vitest resolves `@/*` → `src/*` via `vitest.config.ts` (mirrors `tsconfig.json`), so tests import app modules directly.

`npm run lint` extends `eslint-config-next/core-web-vitals`, which turns on the React Compiler rules. Three of them reject code that is idiomatic elsewhere, so expect them:

- **`react-hooks/purity`** — no `Date.now()` or `Math.random()` during render, and that includes `useRef(Date.now())` and Server Component bodies. Move the call into an effect, an event handler, or a module-scope helper.
- **`react-hooks/set-state-in-effect`** — an effect may not call `setState` synchronously. The fix is usually to trigger the work from the event handler that caused it rather than reacting to the state change afterwards.
- **`react-hooks/immutability`** — don't mutate values the component didn't create (`document.documentElement.dataset.x = …`). Wrap the mutation in a module-scope function.

There is no local database. Schema lives in the Supabase project's migration history, not in this repo — inspect and change it through the Supabase MCP server (`.mcp.json`), not files.

## Architecture

### The generation pipeline is the core of the app

`src/lib/sets.ts` → `buildProblemSet()` is an async generator that yields `BuildEvent`s; `POST /api/sets` (`maxDuration = 300`) serializes them as SSE and `builder-form.tsx` consumes them for live progress. Sets are filled in cost order:

1. **Pool reuse** — verified `problems` rows matching topic/style/format/difficulty, excluding anything the user attempted in the last 30 days, ordered by `times_served` ascending, then bumped via the `bump_times_served` RPC. Capped at `POOL_FRACTION` (half) of the set.
2. **Templates** — deterministic, free, instant (see below). Takes at most half the remaining slots when non-drill styles were also requested.
3. **AI generate → verify → repair** — batched authoring, then per-problem verification at `AI_CONCURRENCY`. At most two rounds (`regenAttempted`).

Two budgets exist because delivering a short set beats delivering nothing: `buildDeadline` (230s) stops *starting* new AI rounds before the route's 300s limit, and generation capacity failures break out of the loop with whatever was already gathered instead of throwing.

### Every model call goes through one function

`src/lib/ai/provider.ts` → `callStructured()`. Nothing else may talk to the SDK. Its contract shapes every caller:

- **Returns `null`** when a model produces unusable output (unparseable, schema mismatch, non-retryable error). Callers must have a discard path — a short set is acceptable, a crash is not.
- **Throws** only when the entire model chain is rate-limited/overloaded/timed out, which is worth surfacing to the student.
- Models are preference-ordered chains (`GENERATOR_MODELS`, `CHECKER_MODELS`), env-overridable. Free-tier Flash models return 503 in bursts, so each role falls through to an older sibling. Retryability is classified by `isRetryable()`; only capacity errors fall through to the next model.
- Gemini 3.x takes `thinkingLevel`, 2.5 takes `thinkingBudget` — `thinkingConfigFor()` sends only what a given model understands.

- Optional `images` turn the call multimodal (`contents` becomes a parts array). Every model in both chains already reads images, so worksheet scanning needs no separate chain. Nothing else may talk to the SDK, which is why image support lives here rather than in the scanning code.

**Gemini JSON Schema constraint:** `$ref` is only supported in non-required properties, so every schema must be fully inlined (`z.toJSONSchema(..., { reused: "inline" })`). A regression here fails at request time with an opaque 400, so `provider-schema.test.ts` asserts no `$ref`/`$defs`/`$schema` in any schema sent to a model. This is also why generation requests one *generation kind* at a time with a flat schema (`batchSchemaFor`, `repairSchemaFor`) rather than the discriminated union.

**Gemini does not enforce `const`.** `format` and `response_kind` are decided by *which schema was requested*, so `stamped()` in `schemas.ts` writes them in before validation rather than trusting the model. This is not defensive padding: shown "Format: graph_points", the model wrote that string into both literal fields, and a completely correct problem — right plot, right integer answer points — was discarded by zod. Anything fully determined by the request should be stamped, not asked for.

### Generation kinds vs. DB formats

`ProblemFormat` is the `problems.format` DB enum. `GenerationKind` is what one authoring call asks for, and the two differ in exactly one place: `graph` is three unrelated tasks (`graph_value`, `graph_points`, `graph_sketch`) sharing a format. `kindsForFormat()` expands a request, `formatForKind()` collapses it back, and `kindOf()` recovers the kind from an authored problem so it can be repaired with the schema that produced it. `splitAcrossKinds()` divides *after* expanding, so asking for six graph problems yields two of each rather than six of one.

### `src/lib/ai/schemas.ts` is the single source of truth

One set of zod schemas defines model structured outputs, the `problems` jsonb column shapes, and UI types. `splitProblem()` is the security boundary: it partitions an authored problem into `content` (statement, choices, hint — safe-ish), `answer` (correct choice, canonical answers, distractor rationales — secret), and `explanation` (worked steps — secret until an attempt). `SanitizedProblem` is what the client is ever allowed to see.

`TaggedProblem` adds `topic_index` because a mis-attributed problem gets served forever to students studying the wrong topic; a bogus index is clamped, not discarded.

`assertNeverFormat()` is the guide rail for adding a format: every format-dependent branch ends in it, so a new entry in `PROBLEM_FORMATS` turns each unhandled site into a compile error rather than a silent wrong answer. `assertNeverGraphResponse()` does the same one level down. Adding a format is therefore "add it, then fix what the compiler lists" — plus a fixture in `formats.test.ts`, which is keyed off `PROBLEM_FORMATS` so a format without one fails the suite.

### Verification and grading are separate ladders

**Verification** (`src/lib/ai/verify.ts`, generation time): `structuralCheck()` (free — KaTeX renders every math segment, MCQ ids unique and non-duplicate by normalized value, fill-blank placeholders all answered) → `solveIndependently()` with the checker model on the statement *only* (no answer leakage) → `solverAgrees()` → on disagreement, one `repairProblem()` pass adjudicated by a re-solve. Difficulty more than 1.5 off the request also fails.

**Grading** (`src/lib/answers.ts` + `src/lib/ai/check-answer.ts`, submission time): local `normalizeMath()` comparison first — LaTeX → canonical ASCII, then exact match, acceptable forms, numeric parse, multiset compare for multi-valued answers. Only a `"uncertain"` result escalates to an AI equivalence call. `normalizeMath` is shared by both ladders, so changes to it affect verification and grading together — `core.test.ts` covers it.

### Supabase: three clients, pick deliberately

| File | Key | Use |
|---|---|---|
| `src/lib/supabase/client.ts` | publishable | browser components |
| `src/lib/supabase/server.ts` | publishable + cookie session | Server Components, route handlers — RLS applies as the signed-in user |
| `src/lib/supabase/service.ts` | `SUPABASE_SECRET_KEY` | server only, **bypasses RLS** — never import from client code |

`problems` has RLS enabled with **no policies** (deny-all) because it holds the answer key. Answers reach the client only through `/api/check`, which first proves the problem appears in a set the caller owns — problems are pooled across users, so checking `setId` alone (or skipping the check when it is null) would leak arbitrary answer keys. Grading outcomes are written server-side only, so practice history can't be fabricated.

Auth is anonymous-by-default: `ensureUser()` calls `signInAnonymously()`, and Google sign-in uses `linkIdentity()` for anonymous users so the user id — and therefore all history — survives the upgrade. Daily set caps live in `buildProblemSet` (5 guest / 20 signed-in). A guest's identity lives only in their session cookie, so clearing it orphans their sets permanently — don't clear cookies to test the signed-out state; fetch with `credentials: "omit"` instead.

Server Actions (`src/app/sets/actions.ts`) use the RLS-scoped server client deliberately: the `delete own sets` policy *is* the authorization check, so a forged id matches no rows. At the DB level `problem_set_items.set_id` cascades, but `attempts.set_id` is `ON DELETE SET NULL` — practice history outlives the set it was earned in, which is why deleting a set can't fail on a foreign key.

### Worksheet scanning

`src/app/set/[id]/scan` → the browser uploads photos straight into the private `worksheet-scans` bucket under `${userId}/...` (which is what the storage policies key on, and keeps megabytes of photo out of the serverless request body), then `POST /api/scan` marks them.

`grade-scan.ts` asks the model for two separable things and the schema keeps them apart: *transcribing* the handwriting and *judging* the maths. `confidence` scores the transcription only. Anything below `SCAN_CONFIDENCE_THRESHOLD` is withheld from `attempts` and returned as `needs_confirmation` for the student to confirm — a confident misread would otherwise become permanent wrong history, which is the one failure mode that makes scanning worse than not having it.

Scanned marks are written as `attempts` rows with `mode: "scan"` (`scored`, no retry — the paper is already written), so they feed Review, Stats and the coach like typed practice. Rows are inserted one at a time because `attempts_one_per_attempt` makes duplicates *expected* — the student may have typed some problems already — and a batch insert would lose every mark to one collision. A conflict skips that problem and leaves the earlier outcome standing.

`worksheet_uploads` has INSERT/SELECT policies but no UPDATE, which is correct: `status` and `grading` are written by the service client after marking, and a client that could write them could mark its own work.

### Deleting your own data

`src/lib/account.ts` backs `/account` with three levels: clear practice history (keeps the sets, which cost model calls and a daily slot to generate), delete all data (keeps the account), and delete the account.

Two ordering facts make it work. Every user-owned table is `ON DELETE CASCADE` from `auth.users`, so `auth.admin.deleteUser()` takes the Postgres rows with it — but **storage has no such link**, so scans are swept first; after the cascade, the `worksheet_uploads` rows naming those files are gone and the objects can never be found again. Supabase also refuses `delete from storage.objects` outright ("use the Storage API"), so the sweep lists the bucket rather than trusting the upload rows, which is what catches files whose row was already removed.

Deletes use the service client with a `userId` resolved server-side, never one passed in — `attempts`, `study_sessions` and `coach_reads` are read-only under RLS, so an RLS-scoped delete would match no rows and report success. `loadAccountSummary` throws rather than falling back to zero: those counts are the last thing read before a permanent deletion, and "0" is the one wrong answer that changes the decision.

`live-account.test.ts` exercises all three against throwaway users it creates and deletes; it self-skips without `SUPABASE_SECRET_KEY`.

### Templates

`src/lib/templates/` holds deterministic parametrized generators: seeded RNG in, a full `GeneratedProblem` (statement, computed answer, authored explanation) out, so they are free and skip AI verification entirely (`verification: { method: "computed" }`). To add one, implement `Template` and register it in the `templates` array in `index.ts`. `topicSlugs` must match `topics.slug` values in the DB catalog — a typo silently disables the template. Templates only serve the `drill` style. `core.test.ts` structurally validates every template across seeds, difficulties, and formats.

### Next.js 16 specifics in use

- `src/proxy.ts` is the renamed `middleware` convention (deprecated in 16); it refreshes the Supabase session for Server Components. It runs its own `getUser()`, so a navigation costs that round-trip plus the layout's (cached) one.
- Route and page `params` are `Promise`s — `await params` on the server. No client component unwraps them today: every route resolves its data in a Server Component and passes it down.
- Pages set `export const dynamic = "force-dynamic"`, and the root layout reads auth regardless, so nothing renders statically except the metadata routes (`icon.svg`, `apple-icon`, `opengraph-image`, `robots.txt`, `sitemap.xml`, `manifest.webmanifest`).
- `next.config.ts` enables `experimental.viewTransition`, which the `<ViewTransition>` in `layout.tsx` needs; `src/types/react-view-transition.d.ts` supplies the types `@types/react` doesn't ship yet. Drop the flag and route animations stop silently.

## Conventions

- Comments explain *why*, especially where a decision looks arbitrary (budgets, fallback ordering, clamping vs discarding). Match that when touching this code; don't add narration of what the line does.
- Failure paths degrade rather than throw: partial sets, discarded problems, `null` returns. Preserve that when adding steps to the pipeline.

## Presentation layer

### Two invariants keep the client bundle small

Both are easy to undo by accident and neither fails loudly.

0. **Plots are drawn in Node too.** `src/lib/plot.ts` renders a declarative spec (window, curves, marks, grid) to an SVG string; `prepareProblem()` calls it and ships `plot_svg`. Same reasoning as KaTeX — the plot is a fixed stimulus that never animates or re-fits, so it does not justify a charting library in the client bundle. Colours are CSS custom properties, so plots follow the theme without the module knowing which one is active. The geometry half (`plotGeometry`, `curveFromHandles`) is pure arithmetic and *is* imported by the interactive overlays, so the axes and the click targets agree by construction rather than by two copies of the same transform.

1. **KaTeX never reaches the browser.** `src/lib/math-render.ts` (`renderMath`, `renderProse`, `prepareProblem`) runs KaTeX in Node; `src/components/latex.tsx` only injects the resulting HTML and must not import `katex`. Server Components and `/api/check` pre-render every expression — which is why `CheckResponse` carries `*_html` fields rather than LaTeX. Importing `katex` from a Client Component silently adds ~275 kB. `renderProse` escapes its text segments, since it builds a string where React used to escape for us.
2. **The Supabase browser SDK is lazily imported.** Auth is resolved server-side by `getCurrentUser()` in `src/lib/auth-server.ts` (wrapped in React `cache`, so the root layout and the page share one round-trip) and handed to `AuthButton` as a plain prop. `@/lib/auth` is `await import(...)`-ed at the point of a click or a submit. A top-level import from any client component puts ~64 kB gzipped back on every route.

### Practice progress is derived, not stored

`src/lib/progress.ts` reconstructs state from `attempts` rows — no extra column and no migration. `is_correct` carries the whole tri-state: `true`, `false`, or `null` for "revealed"; a problem with no row is unattempted. This is also why the client can't fabricate a score. `POST /api/check` has a third action, `recall`, which replays an outcome the student already earned without writing a new attempt — it 404s when no prior attempt exists, so it can't be used to read an answer key early.

### Design system

`src/app/globals.css` holds the whole vocabulary: tokens (light, `prefers-color-scheme` dark, and an explicit `[data-theme]` override that wins over both), `@theme inline` mappings, then `.btn` / `.chip` / `.field` / `.panel` / `.badge` / `.meter` / `.eyebrow` component classes. Prefer composing those over inventing new ad-hoc utility stacks.

Two rules the palette depends on:

- **The accent is oxblood and "incorrect" is a red.** They are separated by lightness, hue, and containment — the accent never appears inside a graded answer region. Introducing accent-coloured UI next to correct/incorrect markers is the one reliable way to make this palette fail.
- **Correctness is never colour alone.** Every ok/bad state pairs the colour with an icon and a word.

Toggle state lives on `aria-pressed`, which is also the styling hook, so the visuals and the accessibility tree can't drift apart.
