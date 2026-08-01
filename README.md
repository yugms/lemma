# lemma

Math practice, generated for you. Build custom problem sets by course → unit → topic with chosen difficulty, problem style (drill, word, conceptual, proof, error analysis), and question format (multiple choice, open answer, fill-in-the-blank). Every AI-generated problem is independently re-solved and verified before it reaches you; every problem carries a step-by-step solution, and wrong answers get an AI diagnosis of what likely went wrong.

## Stack

- **Next.js 16** (App Router, TypeScript) on Vercel
- **Supabase** — Postgres (catalog, verified problem pool, sets, attempts), Auth (anonymous guests + Google), Storage (worksheet scans, phase 3)
- **Google Gemini (free tier)** — a Flash model writes problems (JSON-schema structured outputs), a Flash-Lite model verifies each one by solving it independently, checks answer equivalence, and writes misconception feedback. Each role takes a preference-ordered chain of model ids (`GEMINI_GENERATOR_MODELS` / `GEMINI_CHECKER_MODELS`, see below), and all model access is funnelled through `src/lib/ai/provider.ts` so swapping providers is one file.
- **KaTeX** for math rendering — run entirely on the server, so the browser receives HTML and never downloads the ~275 kB math engine
- Deterministic **template engine** for instant drill problems
- **Tailwind v4** (CSS-first, no config file) over a token-based design system in `src/app/globals.css`

## How generation works

`POST /api/sets` fills a set in cost order, streaming SSE progress:

1. **Pool reuse** — verified problems already in the DB matching topic/style/format/difficulty (excluding ones you've seen recently)
2. **Templates** — seeded-RNG parametrized generators with computed answers and authored explanations (free, instant)
3. **AI generation** — batched call to the generator model (one call per format) → each problem is structurally validated (KaTeX renders, MCQ integrity), independently solved by the checker model, compared against the stored answer, repaired once on mismatch, or discarded

## Practice, progress and review

Practice state is **derived from the `attempts` table**, not stored separately — there is no progress column and no extra table. Every graded submission and every reveal already writes an attempt row, and `is_correct` carries the whole state: `true`, `false`, or `null` for "gave up and read the solution". A problem with no row is unattempted.

That gives three behaviours for free:

- **Resume.** Reload or come back tomorrow and the set opens on the first problem you haven't attempted, with everything you'd already done still marked.
- **Review.** Move backwards, or jump to any problem from the progress ribbon. Revisiting a finished problem replays the answer you actually submitted along with its verdict and worked solution, via a `recall` action that reads history without writing a new attempt.
- **Scores that can't be faked.** Outcomes are only ever written server-side by `/api/check`, so the library meters, the set-level summary and the dashboard stats all reconstruct from data the client can't author.

## Interface

Both themes ship: the palette follows the OS by default, and a System / Light / Dark control in the header overrides it. Colour is load-bearing but never load-bearing *alone* — correct and incorrect states always pair the colour with an icon and a word, and all text meets WCAG AA contrast in both themes.

Route changes animate directionally (forward slides left, back slides right) through React's `<ViewTransition>`, and reveals, the theme wipe and the build progress meter are all CSS. No animation library is used, and everything is disabled under `prefers-reduced-motion`.

## Local setup

1. `npm install`
2. Copy `.env.example` → `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — Supabase dashboard → Project Settings → API Keys
   - `SUPABASE_SECRET_KEY` — same page, "Secret keys" → create one (server-only, bypasses RLS). These are the current API keys; the legacy `anon` / `service_role` JWTs are deprecated.
   - `GEMINI_API_KEY` — free key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey), no card required

   Optional overrides (comma-separated, preference-ordered — later entries are tried only when earlier ones are rate-limited or overloaded):

   | Variable | Default |
   |---|---|
   | `GEMINI_GENERATOR_MODELS` | `gemini-3.5-flash,gemini-3.6-flash,gemini-2.5-flash` |
   | `GEMINI_CHECKER_MODELS` | `gemini-3.5-flash-lite,gemini-2.5-flash-lite,gemini-2.5-flash` |
   | `GEMINI_CONCURRENCY` | `3` |

   `NEXT_PUBLIC_SITE_URL` is optional and defaults to `https://lemma.app`. It sets the metadata base for canonical/OG URLs and is the host written into `robots.txt` and `sitemap.xml`, so set it in production. Auth does **not** use it — sign-in derives its redirect from `window.location.origin`.

   > `.env.example` still lists the model variables in the singular (`GEMINI_GENERATOR_MODEL`). The table above is authoritative.
3. In the Supabase dashboard: **Authentication → Sign In / Providers → enable "Anonymous sign-ins"** (required for guest mode). Optionally configure the Google provider (client ID/secret from Google Cloud Console) for sign-in.
4. `npm run dev`

Database schema lives in the Supabase project's migration history (`catalog`, `problems`, `sets_attempts_uploads`, `rls_and_storage`, `seed_catalog`, `bump_times_served_fn`, `harden_rls_client_read_only`).

## Security model

- `problems` has RLS enabled with **no policies** — deny-all. Answers and worked solutions are only ever read server-side with the secret key, and `loadSetForUser()` strips them into a `SanitizedProblem` before anything renders or responds.
- `/api/check` is the only path that returns an answer key, and it first proves the problem belongs to a set the caller owns. Its `recall` action, which replays a past outcome, additionally requires that an attempt already exists — so it can't be used to read an answer early.
- Browser sessions get read-only access to their own `problem_sets`, `problem_set_items`, and `attempts` (plus delete on their own sets). Grading outcomes are written exclusively by `/api/check`, so a client can't fabricate its own practice history — which is what makes the derived progress and stats trustworthy.
- Deleting a set relies on the `delete own sets` policy as its authorization check rather than an application-level test. `problem_set_items` cascades; `attempts.set_id` is `ON DELETE SET NULL`, so practice history survives the set it was earned in.
- The catalog (`courses` / `units` / `topics`) is public-read.
- `worksheet-scans` is a private bucket with per-user folder policies.
- Guests are Supabase anonymous users, so they carry the `authenticated` role and every owner-scoped policy applies to them unchanged. Signing in with Google uses `linkIdentity`, which keeps the same user id and therefore the same history.

### Accepted advisor findings

Two Supabase advisor items are expected here rather than bugs:

- **`rls_enabled_no_policy` on `problems` (INFO)** — deliberate. No policy means deny-all, which is exactly what a table holding answer keys should be.
- **`auth_allow_anonymous_sign_ins` (WARN) on `attempts`, `problem_sets`, `problem_set_items`, `worksheet_uploads`, `storage.objects`** — flagged because anonymous sign-ins are enabled, so `authenticated`-role policies also cover guests. That is the point: guest practice is a product requirement. Every one of these policies is still scoped to `auth.uid()`, so a guest reaches only their own rows.

Still open: **leaked-password protection** is off. It doesn't apply today (auth is anonymous + Google only, no passwords), but turn it on before adding email/password sign-in.

## Tests

```bash
npm run test        # vitest run — offline tests only
npx tsc --noEmit    # typecheck
npm run lint
```

`core.test.ts` covers answer normalization/comparison and structurally validates every template across seeds, difficulties, and formats. `provider-schema.test.ts` asserts that no schema sent to a model contains `$ref`/`$defs`/`$schema`, which Gemini rejects with an opaque 400. `live-provider.test.ts` hits the real API and self-skips without `GEMINI_API_KEY`:

```bash
node --env-file=.env.local ./node_modules/vitest/vitest.mjs run src/lib/__tests__/live-provider.test.ts
```

## Roadmap

- **Phase 2:** printable worksheets + answer keys (QR/share codes), flashcard mode, timed quizzes, multi-part problems
- **Phase 3:** scan your completed worksheet for AI grading, graph-based questions, matching format
- **Phase 4:** problem quality loop, spaced review of missed problems. *(Progress and stats shipped: per-set completion, accuracy and activity on the home dashboard, and resume/review during practice — all derived from `attempts`.)*
