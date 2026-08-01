<div align="center">
  <img src="src/app/icon.svg" alt="" width="76" height="76">

  <h1>lemma</h1>

  <p><strong>Math practice, generated for you.</strong></p>

  <p>
    Build a problem set by course → unit → topic, at the difficulty, style and format you choose.<br>
    Every AI-written problem is re-solved by a second model before it reaches you, and every one
    arrives with a worked solution.
  </p>

  <p>
    <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white">
    <img alt="React 19" src="https://img.shields.io/badge/React-19-087ea4?logo=react&logoColor=white">
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white">
    <img alt="Supabase" src="https://img.shields.io/badge/Supabase-Postgres-3ecf8e?logo=supabase&logoColor=white">
    <img alt="Gemini" src="https://img.shields.io/badge/Gemini-free%20tier-8e75b2?logo=googlegemini&logoColor=white">
  </p>
</div>

---

Most practice apps hand you a fixed question bank. lemma writes the questions on demand — but generated math is only useful if it is *correct*, so the interesting part of this codebase is everything that happens between "the model wrote a problem" and "a student sees it": a free structural pass, an independent re-solve by a second model that never sees the answer, one repair attempt, and a discard if it still disagrees.

It runs on Google AI Studio's free tier, so the whole thing costs $0 to operate.

## Features

- **Sets built to order** — 9 courses, 47 units, 103 topics (Foundations through AP Calculus BC and competition math), 5 difficulty levels, 5 problem styles (drill, word, conceptual, proof, error analysis) and 5 formats (multiple choice, open answer, fill-in-the-blank, select-all, order-the-steps). Up to 15 problems a set.
- **Verified, not just generated** — each problem is structurally validated, then solved from the statement alone by a checker model that never sees the stored answer. Disagreement earns one repair pass, then a discard.
- **Three ways to work a set** — practice (graded, one retry, solutions on demand), quiz (nothing disclosed until you hand it in), and flashcards (unscored, infinitely repeatable).
- **Grading that understands math** — `3/4`, `0.75` and `\frac{3}{4}` are the same answer. A local normalizer settles almost everything; only genuinely ambiguous cases cost a model call. Wrong answers get a diagnosis of the specific slip, not "incorrect".
- **A practice record you can't fake** — every score, meter and stat is reconstructed from `attempts` rows written server-side. There is no progress column to forge.
- **Review queue** — the problems you actually missed, ranked worst-first, rebuilt into a fresh set for free.
- **Stats and prescriptions** — accuracy by topic, format, style and difficulty; recurring-mistake analysis; and one-click sets targeted at your weakest work, with the targeting config derived server-side from your own history.
- **Study sessions and sharing** — scope stats to a single sitting, or hand a set to someone else with a share link (which grants a *copy*, never access to your record).
- **Instant, free drills** — 16 deterministic templates with computed answers and authored explanations skip the model entirely.
- **Guest-first** — anonymous sign-in by default; linking Google keeps the same user id, so nothing you've done is lost on upgrade.

## How it works

`POST /api/sets` (`maxDuration = 300`) fills a set in cost order and streams progress as SSE:

```mermaid
flowchart LR
  R[Request] --> P["1 · Pool reuse<br/><i>free</i>"]
  P --> T["2 · Templates<br/><i>free, instant</i>"]
  T --> G["3 · AI authoring<br/><i>batched, per format</i>"]
  G --> S{"Structural check<br/>KaTeX · MCQ · blanks"}
  S -->|fail| X[Discard]
  S -->|pass| V["Independent re-solve<br/><i>statement only</i>"]
  V -->|agrees| OK[Set]
  V -->|disagrees| RP[Repair once]
  RP --> RS{Re-solve}
  RS -->|agrees| OK
  RS -->|no| X
  P --> OK
  T --> OK
```

1. **Pool reuse** — already-verified problems matching your request, excluding anything you attempted in the last 30 days, least-served first. Capped at half the set.
2. **Templates** — seeded-RNG parametrized generators. The answer is computed, not claimed, so they skip verification entirely.
3. **AI generation** — one batched authoring call per format, then verification fanned out at a bounded concurrency.

Two budgets exist because a short set beats no set: a 230s build deadline stops *starting* new rounds inside the route's 300s limit, and capacity failures break out of the loop with whatever was already gathered rather than throwing.

> [!NOTE]
> Every model call in the app goes through one function, `callStructured()` in `src/lib/ai/provider.ts`. It returns `null` for unusable output (callers must degrade) and throws only when the entire model chain is rate-limited. Swapping providers is a change to that one file.

### Practice modes

Each mode is defined by three answers, which the grading route reads from one table (`src/lib/attempt-state.ts`):

| Mode | Counts toward the set | Reveals the answer | Second attempt |
|---|---|---|---|
| Practice | yes | yes | on a wrong answer |
| Quiz | yes | only after hand-in | no |
| Flashcards | no (unscoped reps) | yes | n/a — repeat freely |

## Getting started

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project (free tier)
- A [Google AI Studio](https://aistudio.google.com/apikey) API key (free, no card)

### Install

```bash
git clone <your-fork-url> lemma
cd lemma
npm install
cp .env.example .env.local   # then fill it in — see below
npm run dev
```

### Configure Supabase

1. **Authentication → Sign In / Providers → enable "Anonymous sign-ins"**. This is required — guest mode is the default path through the app.
2. Optionally configure the **Google** provider (client ID/secret from Google Cloud Console) to allow sign-in.

> [!IMPORTANT]
> There is no local database and no SQL in this repo. The schema lives in the Supabase project's migration history (`catalog`, `problems`, `sets_attempts_uploads`, `rls_and_storage`, `seed_catalog`, `bump_times_served_fn`, `lock_down_bump_times_served`, `harden_rls_client_read_only`, `study_sessions_and_coach_reads`, `add_problem_formats`, `attempt_retries`, `catalog_foundations_geometry_stats`). Inspect and change it through the Supabase MCP server configured in `.mcp.json`.

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Same page. The current key format — the legacy `anon` JWT is deprecated |
| `SUPABASE_SECRET_KEY` | yes | "Secret keys" → create one. **Server-only, bypasses RLS** |
| `GEMINI_API_KEY` | yes | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `NEXT_PUBLIC_SITE_URL` | no | Defaults to `https://lemma.app`. Sets the metadata base and the host in `robots.txt` / `sitemap.xml` — set it in production. Auth does **not** use it; sign-in derives its redirect from `window.location.origin` |
| `GEMINI_GENERATOR_MODELS` | no | `gemini-3.5-flash,gemini-3.6-flash,gemini-2.5-flash` |
| `GEMINI_CHECKER_MODELS` | no | `gemini-3.5-flash-lite,gemini-2.5-flash-lite,gemini-2.5-flash` |
| `GEMINI_CONCURRENCY` | no | `3` — free-tier limits are around 10 RPM |

The two model variables are comma-separated **preference-ordered chains**: later entries are tried only when earlier ones are rate-limited or overloaded, because free-tier Flash models return 503 in bursts.

> [!TIP]
> Only Flash and Flash-Lite tiers are free. Pointing these at a Pro model works, but stops being free.

### Commands

```bash
npm run dev            # dev server
npm run build          # production build
npm start              # serve the production build
npm run lint           # eslint (next/core-web-vitals + React Compiler rules)
npm run test           # vitest — offline tests only
npx tsc --noEmit       # typecheck (no npm script for this)
```

## Testing

```bash
npx vitest run src/lib/__tests__/core.test.ts   # one file
npx vitest run -t "normalizeMath"               # one test by name
```

- **`core.test.ts`** — answer normalization and comparison, plus a structural validation of every template across 25 seeds × every declared difficulty and format.
- **`formats.test.ts`** — the per-format round trip: author → split into DB columns → grade → render. Keyed off `PROBLEM_FORMATS`, so a new format without a fixture fails here rather than in production.
- **`analytics.test.ts`** — streaks, smoothing and weakness ranking, run against a pure `aggregate()`.
- **`provider-schema.test.ts`** — asserts no schema sent to a model contains `$ref` / `$defs` / `$schema`. Gemini only supports `$ref` in non-required properties, and a regression fails at request time with an opaque 400.
- **`live-provider.test.ts`** — hits the real API and self-skips without a key:

  ```bash
  node --env-file=.env.local ./node_modules/vitest/vitest.mjs run src/lib/__tests__/live-provider.test.ts
  ```

## Project structure

```
src/
├── app/                 # routes — every page is a Server Component
│   ├── api/sets/        # SSE set builder (maxDuration 300)
│   ├── api/check/       # the only path that ever returns an answer key
│   ├── build/ sets/     # builder + library
│   ├── set/[id]/        # practice · quiz · flashcards
│   ├── review/ stats/   # missed-problem queue · analytics + prescriptions
│   └── s/[code]/        # shared-set landing
├── components/          # client components; practice engines, inputs, design bits
├── lib/
│   ├── ai/              # provider, schemas, generation, verification, grading, coach
│   ├── templates/       # deterministic parametrized generators
│   ├── supabase/        # three clients: browser · server (RLS) · service (bypasses RLS)
│   ├── sets.ts          # the build pipeline
│   ├── answers.ts       # normalizeMath and the local grading ladder
│   ├── analytics.ts     # stats derived from attempts
│   └── math-render.ts   # KaTeX, server-side only
└── proxy.ts             # Next 16's renamed middleware — refreshes the Supabase session
```

## Security model

The `problems` table holds answer keys, so the design assumes the client is hostile.

- **`problems` has RLS enabled with no policies** — deny-all. It is read server-side only, and `loadSetForUser()` strips every row into a `SanitizedProblem` before anything renders.
- **`/api/check` is the only path that discloses an answer**, and it first proves the problem appears in a set the caller owns. Problems are pooled across users, so checking the set id alone would leak arbitrary answer keys. Its `recall` action (replaying an outcome you already earned) additionally requires that an attempt exists, so it can't read an answer early.
- **A live retry offer and the answer key are mutually exclusive** — handing over the key beside a "Try again" button would turn the second attempt into a copying exercise.
- **Outcomes are written exclusively server-side.** Clients get read-only access to their own sets, items and attempts. That is what makes the derived progress, meters and stats trustworthy.
- **Targeted sets take a plan id and nothing else.** The topics, difficulty and above all the authoring *directives* are rebuilt server-side from the caller's own history, because `focus.directives` lands verbatim in a model prompt.
- **A share link grants a copy, not access.** Opening one shows sanitized problems and offers to mint a set you own; widening the ownership check to "or you know the code" would have been the smaller diff and the much larger attack surface.
- **Deleting a set relies on the `delete own sets` RLS policy** as the authorization check, so a forged id matches no rows. `problem_set_items` cascades; `attempts.set_id` is `ON DELETE SET NULL`, so practice history outlives the set it was earned in.
- **Guests are Supabase anonymous users**, carrying the `authenticated` role, so every `auth.uid()`-scoped policy covers them unchanged. Google sign-in uses `linkIdentity()`, preserving the user id and therefore the history.

Daily bounds: 5 generated sets for guests, 20 signed-in (only sets that cost a model call count), plus 10 review sets and 10 shared-set copies.

> [!WARNING]
> A guest's identity lives only in their session cookie. Clearing it orphans their sets permanently — to test the signed-out state, fetch with `credentials: "omit"` instead.

### Accepted advisor findings

Two Supabase advisor items are expected here rather than bugs:

- **`rls_enabled_no_policy` on `problems` (INFO)** — deliberate. No policy means deny-all, which is what a table of answer keys should be.
- **`auth_allow_anonymous_sign_ins` (WARN)** — flagged because anonymous sign-ins are on, so `authenticated`-role policies also cover guests. That is the product requirement; every one of those policies is still scoped to `auth.uid()`.

Still open: leaked-password protection is off. It doesn't apply today (anonymous + Google only, no passwords), but turn it on before adding email/password sign-in.

## Notes for contributors

A few invariants here are easy to break silently and none of them fail loudly:

- **KaTeX must never reach the browser.** `src/lib/math-render.ts` runs it in Node; `src/components/latex.tsx` only injects the resulting HTML. Importing `katex` from a Client Component adds ~275 kB.
- **The Supabase browser SDK is lazily imported.** Auth is resolved server-side and passed down as a plain prop; `@/lib/auth` is `await import(...)`-ed at the point of a click. A top-level import puts ~64 kB gzipped back on every route.
- **Failure paths degrade, they don't throw** — partial sets, discarded problems, `null` returns. Keep that when adding pipeline steps.
- **Correctness is never colour alone.** Every ok/bad state pairs colour with an icon and a word, and the oxblood accent never appears inside a graded answer region.
- **This is not the Next.js you know.** Read the relevant guide in `node_modules/next/dist/docs/` before writing route code; `params` are Promises and `middleware` is now `proxy.ts`.

`CLAUDE.md` and `AGENTS.md` carry the longer version of all of this.

## Roadmap

- **Phase 3** — scan a completed worksheet for AI grading, graph-based questions, matching format, multi-part problems, printable worksheets with answer keys
- **Phase 4** — problem quality loop, spaced repetition on top of the review queue
