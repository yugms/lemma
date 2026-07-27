# lemma

Math practice, generated for you. Build custom problem sets by course → unit → topic with chosen difficulty, problem style (drill, word, conceptual, proof, error analysis), and question format (multiple choice, open answer, fill-in-the-blank). Every AI-generated problem is independently re-solved and verified before it reaches you; every problem carries a step-by-step solution, and wrong answers get an AI diagnosis of what likely went wrong.

## Stack

- **Next.js 16** (App Router, TypeScript) on Vercel
- **Supabase** — Postgres (catalog, verified problem pool, sets, attempts), Auth (anonymous guests + Google), Storage (worksheet scans, phase 3)
- **Google Gemini (free tier)** — a Flash model writes problems (JSON-schema structured outputs), a Flash-Lite model verifies each one by solving it independently, checks answer equivalence, and writes misconception feedback. Both model ids are env vars (`GEMINI_GENERATOR_MODEL` / `GEMINI_CHECKER_MODEL`), and all model access is funnelled through `src/lib/ai/provider.ts` so swapping providers is one file.
- **KaTeX** for math rendering; deterministic **template engine** for instant drill problems

## How generation works

`POST /api/sets` fills a set in cost order, streaming SSE progress:

1. **Pool reuse** — verified problems already in the DB matching topic/style/format/difficulty (excluding ones you've seen recently)
2. **Templates** — seeded-RNG parametrized generators with computed answers and authored explanations (free, instant)
3. **AI generation** — batched Opus call → each problem is structurally validated (KaTeX renders, MCQ integrity), independently solved by Haiku, compared against the stored answer, repaired once on mismatch, or discarded

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

   > `.env.example` is slightly out of date: it lists these in the singular (`GEMINI_GENERATOR_MODEL`) and includes a `NEXT_PUBLIC_SITE_URL` that nothing reads — auth derives its redirect from `window.location.origin`. The table above is authoritative.
3. In the Supabase dashboard: **Authentication → Sign In / Providers → enable "Anonymous sign-ins"** (required for guest mode). Optionally configure the Google provider (client ID/secret from Google Cloud Console) for sign-in.
4. `npm run dev`

Database schema lives in the Supabase project's migration history (`catalog`, `problems`, `sets_attempts_uploads`, `rls_and_storage`, `seed_catalog`, `bump_times_served_fn`, `harden_rls_client_read_only`).

## Security model

- `problems` has RLS enabled with **no policies** — deny-all. Answers and worked solutions are only ever read by server routes using the secret key, and `/api/sets/[id]` strips them before responding.
- Browser sessions get read-only access to their own `problem_sets`, `problem_set_items`, and `attempts` (plus delete on their own sets). Grading outcomes are written exclusively by `/api/check`, so a client can't fabricate its own practice history — which matters for the planned progress pages.
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
npx vitest run
```

Covers answer normalization/comparison and structural validation of every template across seeds, difficulties, and formats.

## Roadmap

- **Phase 2:** printable worksheets + answer keys (QR/share codes), flashcard mode, timed quizzes, multi-part problems
- **Phase 3:** scan your completed worksheet for AI grading, graph-based questions, matching format
- **Phase 4:** progress/stats pages (the `attempts` table already records everything needed), problem quality loop, spaced review of missed problems
