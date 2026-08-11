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

# Live tests self-skip without their key, so `npm run test` stays offline.
# Run them with env loaded — live-provider needs GEMINI_API_KEY,
# live-account needs SUPABASE_SECRET_KEY:
node --env-file=.env.local ./node_modules/vitest/vitest.mjs run src/lib/__tests__/live-provider.test.ts
```

Vitest resolves `@/*` → `src/*` via `vitest.config.ts` (mirrors `tsconfig.json`), so tests import app modules directly.

`npm run lint` extends `eslint-config-next/core-web-vitals`, which turns on the React Compiler rules. Three of them reject code that is idiomatic elsewhere, so expect them:

- **`react-hooks/purity`** — no `Date.now()` or `Math.random()` during render, and that includes `useRef(Date.now())` and Server Component bodies. Move the call into an effect, an event handler, or a module-scope helper.
- **`react-hooks/set-state-in-effect`** — an effect may not call `setState` synchronously. The fix is usually to trigger the work from the event handler that caused it rather than reacting to the state change afterwards.
- **`react-hooks/immutability`** — don't mutate values the component didn't create (`document.documentElement.dataset.x = …`). Wrap the mutation in a module-scope function.

There is no local database. Schema lives in the Supabase project's migration history, not in this repo — inspect and change it through the Supabase MCP server (`.mcp.json`), not files.

## Git and GitHub

**Use git the way a developer on this repo would, without being asked each time.** Fetch, branch, commit, push and open PRs as ordinary parts of doing the work. Standing authorization — don't stop to ask permission for any of the below.

- **Start from the remote, not from whatever is checked out.** `git fetch origin` first, and branch off `origin/main`. A branch cut from a stale local `main`, or from a feature branch that has already been merged, silently rebases the diff onto the wrong base — check `git log --oneline -1 origin/main` before branching rather than trusting the working copy. Fast-forward local `main` while you are there.
- **Never commit to `main`.** Branch first, always: `feat/…`, `fix/…`, `perf/…`, `prod/…`, matching what is already in the history.
- **Commit as the feature takes shape, not once at the end.** A commit per coherent change, made when that change is finished and green. Uncommitted work is invisible to `git diff`, unreviewable, and impossible to revert in pieces; a single 3,000-line commit spanning five features is only marginally better. If a session has produced several unrelated things, split them before committing.
- **Every commit typechecks and passes `npm run test` on its own.** The stack has to be bisectable, so a commit that only compiles once a later one lands is a commit in the wrong order. When a file legitimately spans two concerns, prefer assigning it whole to the commit its dominant change belongs to over hunk surgery that leaves an intermediate commit broken — an unrelated rider in the right commit costs less than an unbuildable tree.
- **Push the branch and open a PR** when the work is complete. Body says what changed and why, in the same register as the commit messages.
- **Commit messages match the existing history**: an imperative sentence saying what changed and, in the body, *why* — the failure it prevents, the thing that looked sufficient and wasn't. `git log` here is the record of decisions this file summarizes, so "Add materials feature" is a worse message than "Don't let one unreachable checker discard the whole set". No Conventional Commits prefixes; nothing in the log uses them.

Two things still warrant asking first, because neither is recoverable from the reflog by the person who has to notice it went wrong: force-pushing a branch someone else may have pulled, and merging a PR.

**The DB is not in the repo, so a migration cannot ride along in a commit.** A schema change is applied to the live Supabase project via MCP and is live the moment it is applied — before the code that needs it is written, let alone merged. Migrations therefore have to be additive and safe against the currently deployed code: `problems.status` shipped with `DEFAULT 'active'` precisely so the deployed build, which knew nothing about the column, kept inserting successfully. Name the applied migrations in the commit message of the code that depends on them, since nothing else connects the two.

## Architecture

### The generation pipeline is the core of the app

`src/lib/sets.ts` → `buildProblemSet()` is an async generator that yields `BuildEvent`s; `POST /api/sets` (`maxDuration = 300`) serializes them as SSE and `builder-form.tsx` consumes them for live progress. Sets are filled in cost order:

1. **Pool reuse** — verified `problems` rows matching topic/style/format/difficulty, excluding anything the user attempted in the last 30 days, ordered by `times_served` ascending, then bumped via the `bump_times_served` RPC. Capped at `POOL_FRACTION` (half) of the set.
2. **Templates** — deterministic, free, instant (see below). Takes at most half the remaining slots when non-drill styles were also requested.
3. **AI generate → verify → repair** — batched authoring and per-problem verification, overlapped. At most two rounds (`regenAttempted`).

Two budgets exist because delivering a short set beats delivering nothing: `buildDeadline` (230s) stops *starting* new AI rounds before the route's 300s limit, and generation capacity failures break out of the loop with whatever was already gathered instead of throwing.

**Step 3 is where the wall clock goes, and it is one pipeline, not two phases.** Authoring is by far the most expensive thing the app does — a batch runs 30-60s against a ~1s independent solve — so every authoring call for a set is in flight at once (`generateProblems` fans out over generation kinds and `PROBLEMS_PER_CALL` chunks), and `onBatch` starts verifying each batch the moment it lands rather than waiting for the slowest kind. Three consequences worth knowing before touching it:

- **Authoring and verification share one `createCallPool(AI_CONCURRENCY)`**, created once per build in `buildProblemSet`. A limit each would burst to the sum of the two and spend the difference in 429 backoff, which costs more than the concurrency buys.
- **Concurrent batches cannot see each other's output**, so the sequential `avoid`-list accumulation that used to prevent repeats is gone. `statementKey` dedup in `generateProblems` replaces it; it is whitespace-and-case only, because it only has to catch the model landing on the same problem twice.
- **A capacity failure is per-call.** `generateProblems` collects with `allSettled` and rethrows only when nothing at all was produced, so one exhausted model chain no longer discards the batches that landed beside it.

`PROBLEMS_PER_CALL` looks like a latency dial and is not one. Measured, twelve problems took 58s at six per call and 66s at three: a call spends 3.5-7k thinking tokens planning the batch almost regardless of its size, so splitting further just multiplies that overhead and doubles the burst the free tier answers with 503s.

Progress is emitted from inside those parallel callbacks through `asyncQueue` (`src/lib/async-queue.ts`), because an async generator cannot `yield` from a callback. Without it the meter can only move between phases — which is exactly the stretch where it used to read `0/8` for minutes on a targeted build that skips both the pool and templates.

**Nothing on the route's path to `buildProblemSet` may call a model.** `BUILD_BUDGET_MS` is counted from `requestStartedAt`, so a call made in the preamble is subtracted from generation twice over — once in wall clock, once in budget. This is why the targeted branch takes `cachedCoachRead` rather than `loadCoachRead`: the read only ever contributes `generator_directives`, which sharpen the computed directives rather than replacing them, and generating it cost a measured 2s warm but 24s on a request's cold first call. `/stats` is where targeted builds start from and it generates the read in a Suspense boundary on the same render, so the cache is warm by the time a card is clicked; a student who beats it gets computed directives only, which is the fallback those exist for. `cachedCoachRead` also ignores the cache signature and needs no snapshot, which is what lets it run in `Promise.all` with `loadStatsSnapshot` instead of behind it.

### Every model call goes through one function

`src/lib/ai/provider.ts` → `callStructured()`. Nothing else may talk to the SDK. Its contract shapes every caller:

- **Returns `null`** when a model produces unusable output (unparseable, schema mismatch, non-retryable error). Callers must have a discard path — a short set is acceptable, a crash is not.
- **Throws** only when the entire model chain is rate-limited/overloaded/timed out, which is worth surfacing to the student.
- Models are preference-ordered chains (`GENERATOR_MODELS`, `CHECKER_MODELS`), env-overridable. Free-tier Flash models return 503 in bursts, so each role falls through to an older sibling. Retryability is classified by `isRetryable()`; only capacity errors fall through to the next model.
- Gemini 3.x takes `thinkingLevel`, 2.5 takes `thinkingBudget` — `thinkingConfigFor()` sends only what a given model understands.
- **Every call traces one line** — `[lemma/ai] label=author:mcq model=… ms=… result=ok in=… out=… think=…`, plus `[lemma/build] phase=…` per build phase. This is the only place that sees the SDK, so it is the only place that has to be instrumented to see all of it. `label` is what makes a trace readable; set it on any new call site. Nothing else records model latency, so a slow build and a stalled one are indistinguishable without this. The separator is a slash, and must stay one: a bracketed `name:value` is Tailwind's arbitrary-property syntax, and its scanner reads every file in the repo — including this one — so the earlier colon form was emitted as an invalid CSS declaration into the stylesheet every visitor downloads. `@source not` did not exclude it under Turbopack.
- **The per-attempt timeout is derived from `budgetMs`, not fixed** (`attemptCap`, floored at `MIN_ATTEMPT_MS`). A flat 60s ceiling under the generator's 150s budget aborted batches that were still being written; an abort is classified retryable, so the call then spent its whole budget on retries that were always going to be cut off at the same point. Any new caller with a generous budget inherits the derivation — don't reintroduce a constant.
- Optional `images` make the call multimodal (`contents` becomes a parts array). Every model in both chains already reads images, so scanning needs no separate chain — and the one-choke-point rule is why image support lives here rather than in the scanning code. `ImagePart` is mime-agnostic (it is Gemini's `inlineData` verbatim), which is what lets study materials send PDFs through the same plumbing.
- Optional `safety` sets content thresholds **for one call**. There is no default, deliberately: the authoring and grading chains work on maths the app produced or a student typed, where tightening buys nothing and a word problem about triage or debt is a plausible false positive. Only the study-material call, whose input is a file somebody chose, sets `STRICT_SAFETY`.
- **A refusal and a sulk both arrive as no text**, and they are traced apart because otherwise the one call with untrusted input is the one you cannot debug. `promptFeedback.blockReason` is the input-side block — it produces no candidates at all, so `finishReason` never sees it — and `finishReason` covers the output side. Traced, not branched on: unusable output still returns `null`.

**Gemini JSON Schema constraint:** `$ref` is only supported in non-required properties, so every schema must be fully inlined (`z.toJSONSchema(..., { reused: "inline" })`). A regression here fails at request time with an opaque 400, so `provider-schema.test.ts` asserts no `$ref`/`$defs`/`$schema` in any schema sent to a model. This is also why generation requests one *generation kind* at a time with a flat schema (`batchSchemaFor`, `repairSchemaFor`) rather than the discriminated union.

**Gemini does not enforce `const`.** `format` and `response_kind` are decided by *which schema was requested*, so `stamped()` in `schemas.ts` writes them in before validation rather than trusting the model. This is not defensive padding: shown "Format: graph_points", the model wrote that string into both literal fields, and a completely correct problem — right plot, right integer answer points — was discarded by zod. Anything fully determined by the request should be stamped, not asked for.

It does not reliably enforce `.max()` either, and the cost of that depends on what a rejection loses. `CoachReadSchema` bounds its arrays in the schema and can afford to — a discarded coach read costs commentary. `MaterialDigestSchema` carries **no** `.max()`, `.min()` or `.int()` at all, because a discarded digest costs the student their upload *and* a daily slot over a model writing one character too many; every bound it documents is applied afterwards by `normalizeDigest`, which truncates. Same lesson as `stamped()`: what the server can fix, it fixes rather than asking for and then validating.

### Generation kinds vs. DB formats

`ProblemFormat` is the `problems.format` DB enum. `GenerationKind` is what one authoring call asks for, and the two differ in exactly one place: `graph` is three unrelated tasks (`graph_value`, `graph_points`, `graph_sketch`) sharing a format. `kindsForFormat()` expands a request, `formatForKind()` collapses it back, and `kindOf()` recovers the kind from an authored problem so it can be repaired with the schema that produced it. `splitAcrossKinds()` divides *after* expanding, so asking for six graph problems yields two of each rather than six of one.

### `src/lib/ai/schemas.ts` is the single source of truth

One set of zod schemas defines model structured outputs, the `problems` jsonb column shapes, and UI types. `splitProblem()` is the security boundary: it partitions an authored problem into `content` (statement, choices, hint — safe-ish), `answer` (correct choice, canonical answers, distractor rationales — secret), and `explanation` (worked steps — secret until an attempt). `SanitizedProblem` is what the client is ever allowed to see.

`TaggedProblem` adds `topic_index` because a mis-attributed problem gets served forever to students studying the wrong topic; a bogus index is clamped, not discarded.

`assertNeverFormat()` is the guide rail for adding a format: every format-dependent branch ends in it, so a new entry in `PROBLEM_FORMATS` turns each unhandled site into a compile error rather than a silent wrong answer. `assertNeverGraphResponse()` does the same one level down. Adding a format is therefore "add it, then fix what the compiler lists" — plus a fixture in `formats.test.ts`, which is keyed off `PROBLEM_FORMATS` so a format without one fails the suite.

### Verification and grading are separate ladders

**Verification** (`src/lib/ai/verify.ts`, generation time): `structuralCheck()` (free — KaTeX renders every math segment, MCQ ids unique and non-duplicate by normalized value, fill-blank placeholders all answered) → `solveIndependently()` with the checker model on the statement *only* (no answer leakage) → `solverAgrees()` → on disagreement, one `repairProblem()` pass adjudicated by a re-solve. Difficulty more than 1.5 off the request also fails.

**Grading** (`src/lib/answers.ts` + `src/lib/ai/check-answer.ts`, submission time): local `normalizeMath()` comparison first — LaTeX → canonical ASCII, then exact match, acceptable forms, numeric parse, multiset compare for multi-valued answers. Only a `"uncertain"` result escalates to an AI equivalence call. `normalizeMath` is shared by both ladders, so changes to it affect verification and grading together — `core.test.ts` covers it.

### Two modules own things that were previously scattered

**`src/lib/env.ts` is the only place `process.env` is read** (outside the model-chain overrides in `provider.ts`). It replaced eight `process.env.X!` assertions whose failure mode was `supabaseUrl is required` thrown from inside a vendor module — true, but naming neither the variable nor where to set it.

`siteUrl()` is the important one, and its fallback order is load-bearing: explicit `NEXT_PUBLIC_SITE_URL`, then Vercel's `VERCEL_PROJECT_PRODUCTION_URL`, then `VERCEL_URL`, then localhost with a warning. It previously fell back to a hardcoded `https://lemma.app` — a domain the project does not own — so production served a `robots.txt` advertising someone else's sitemap and OG tags pointing off-site. **Nothing in that chain may ever produce a host the deployment does not serve.** It does not throw on the last step, because throwing fails a plain `npm run build`; `production.test.ts` pins the order.

Note that `NEXT_PUBLIC_*` inlining only works for a *literal* `process.env.NAME` expression. A dynamic lookup compiles to an undefined read in the browser, which is why those reads are spelled out rather than driven from a list.

**`src/lib/limits.ts` holds every daily cap in one table.** Adding a spend path means adding a row there, not a new bespoke count. Two of the six behave differently on refusal and the difference is deliberate: a refused scan returns a message, but exhausted AI grading must fall back to the local verdict and skip the diagnosis — a student mid-set loses the explanation, never the mark. `checkSubmission(..., { allowAi: false })` is how, and it resolves an inconclusive answer to incorrect, which is already what happens when the provider is unreachable.

`aiGradingAllowed` returns `true` when its own count query fails. Guessing permissively costs one model call; guessing the other way silently switches every student into degraded grading for the rest of the day.

### Supabase: three clients, pick deliberately

| File | Key | Use |
|---|---|---|
| `src/lib/supabase/client.ts` | publishable | browser components |
| `src/lib/supabase/server.ts` | publishable + cookie session | Server Components, route handlers — RLS applies as the signed-in user |
| `src/lib/supabase/service.ts` | `SUPABASE_SECRET_KEY` | server only, **bypasses RLS** — never import from client code |

`problems` has RLS enabled with **no policies** (deny-all) because it holds the answer key. Answers reach the client only through `/api/check`, which first proves the problem appears in a set the caller owns — problems are pooled across users, so checking `setId` alone (or skipping the check when it is null) would leak arbitrary answer keys. Grading outcomes are written server-side only, so practice history can't be fabricated.

Auth is anonymous-by-default: `ensureUser()` calls `signInAnonymously()`, and Google sign-in uses `linkIdentity()` for anonymous users so the user id — and therefore all history — survives the upgrade. Daily set caps live in `buildProblemSet` (5 guest / 20 signed-in). A guest's identity lives only in their session cookie, so clearing it orphans their sets permanently — don't clear cookies to test the signed-out state; fetch with `credentials: "omit"` instead.

**Sign-in depends on three dashboard settings, and none of them are in this repo.** Anonymous sign-ins, the Google provider (client ID/secret, with the redirect URI pointing at `<project>.supabase.co/auth/v1/callback` — *not* at the app), and **Allow manual linking**, which `linkIdentity()` requires and which is off by default. With it off every guest sign-in returns `404 manual_linking_disabled`; with the provider off, `400 validation_failed / "provider is not enabled"`. Both are invisible from the code, so when sign-in fails read `error_code` in the Supabase auth logs before touching anything — `src/lib/auth-errors.ts` maps those codes to the copy shown on `/signin`, and the callback forwards the real code rather than a generic flag precisely so the page can name the cause. The MCP server cannot read or write auth config; these are dashboard-only.

Server Actions (`src/app/sets/actions.ts`) use the RLS-scoped server client deliberately: the `delete own sets` policy *is* the authorization check, so a forged id matches no rows. At the DB level `problem_set_items.set_id` cascades, but `attempts.set_id` is `ON DELETE SET NULL` — practice history outlives the set it was earned in, which is why deleting a set can't fail on a foreign key.

### Worksheet scanning

`src/app/set/[id]/scan` → the browser uploads photos straight into the private `worksheet-scans` bucket under `${userId}/...` (which is what the storage policies key on, and keeps megabytes of photo out of the serverless request body), then `POST /api/scan` marks them.

`grade-scan.ts` asks the model for two separable things and the schema keeps them apart: *transcribing* the handwriting and *judging* the maths. `confidence` scores the transcription only. Anything below `SCAN_CONFIDENCE_THRESHOLD` is withheld from `attempts` and returned as `needs_confirmation` for the student to confirm — a confident misread would otherwise become permanent wrong history, which is the one failure mode that makes scanning worse than not having it.

**Confidence is not the only such gate.** `wasAttempted()` is the other, and it exists because the first one did not cover the case that actually happened: a page numbered "6)" with nothing after it came back `found: true, read_answer: "", correct: false, confidence: 1`, sailed through the threshold — the model was *correctly* certain it had read a blank — and was recorded as a miss. Confidence guards misreading; "not attempted" is a different failure and needs its own rule. A blank is therefore decided server-side, never recorded and never offered for confirmation, and the results view scores out of what was attempted so a half-finished page reads 3/3 rather than 3/6. The general lesson: each new way of being wrong needs its own gate, not a wider threshold on an existing one.

Scanned marks are written as `attempts` rows with `mode: "scan"` (`scored`, no retry — the paper is already written), so they feed Review, Stats and the coach like typed practice. Rows are inserted one at a time because `attempts_one_per_attempt` makes duplicates *expected* — the student may have typed some problems already — and a batch insert would lose every mark to one collision. A conflict skips that problem and leaves the earlier outcome standing.

`worksheet_uploads` has INSERT/SELECT policies but no UPDATE, which is correct: `status` and `grading` are written by the service client after marking, and a client that could write them could mark its own work.

### Study materials

`/materials` → the browser uploads photos or a PDF into the private `study-materials` bucket (same prefix convention as scans), or just pastes text, then `POST /api/materials` reads it once and stores a **digest**. `/materials/[id]` shows what was found, lets the student adjust it, and builds through the `mode: "material"` branch of `POST /api/sets`.

**The digest is the containment boundary, and it is a bottleneck rather than a sanitizer.** Uploaded pages are chosen by whoever is holding the browser, so the question is not whether they can be hostile but where they stop. `MaterialDigestSchema` is where: closed enums plus short capped strings, produced by one model call told the input is data, and nothing else from an upload reaches the authoring prompt. That is the same argument `callStructured` makes everywhere — a hijacked call still has to emit schema-valid JSON — and it beats escaping, because an escape list is a list of the tricks somebody already thought of. `tidyText` is an *allowlist* on top, deliberately unlike `quoteNote` in `coach-plan.ts`, which guards text that is only student-influenced.

Three consequences worth knowing before touching it:

- **The student's note is interpreted at ingest, never passed through.** It reaches `requested_shift` / `requested_styles` / `requested_emphasis` and the raw sentence is stored only so an abusive upload can be understood later. That is what makes each injection attempt cost a `materials` slot and a 40s round trip rather than a keystroke — the property that matters, since injection is found by iteration.
- **`SetConfig.material` obeys the same rule as `focus`, drawn one notch differently.** The rule was never "the client writes nothing" — `ManualSchema` has always taken client-chosen topics, level, styles and formats. It is *the client may write closed vocabularies and never prose*. So the review step sends back those four (with `topicIds` subset-checked against the digest's own) and `concepts`/`archetypes`/`emphasis` are read server-side from the stored digest.
- **No model call on the way to `buildProblemSet`.** Analysis is its own endpoint precisely so the build reads a stored digest for free, the same reasoning as `cachedCoachRead`.

**Material problems are `unlisted` *and* hash-namespaced, and the second half is not optional.** `insertProblems` upserts on `(topic_id, content_hash)`, which PostgREST compiles to `ON CONFLICT DO UPDATE SET` every column in the payload — so a collision overwrites rather than skips, and `status` is the first column where two rows sharing a hash legitimately disagree. Adding `status` alone runs the overwrite both ways: a material build demotes a shared pool problem to `unlisted` for everyone, and a later ordinary build promotes a material problem to `active` and serves somebody's homework to strangers. Both silent, and no query the app makes would show either. `contentHashFor` prefixes `material:${id}::`, which leaves the only possible collision the useful one — the same material asked twice. `problems_pick` is a partial index over `status = 'active'`, so the exclusion itself is free — and that same partiality is why `problems_status_check` pins the column to those two values in the DB: an unrecognised status raises nothing, it just drops the row out of the index and out of the pool for good. Adding a third status means a migration, not only a change to `ProblemStatus`. `status` also has to be on *every* row: supabase-js sends an array insert with one shared column list, so a key present on some rows only arrives as NULL on the rest, and the column is NOT NULL.

`normalizeDigest` **filters** a bad `topic_index` where `generateProblems` **clamps** one — the same input, two failures. There a wrong number mis-tags one otherwise-fine problem; here it chooses what a whole set is about, so clamping to topic 0 would anchor everything to whatever happened to be first. An empty list after filtering means `failed`, never `ready`: a `ready` digest with no topics passes every check and then dies inside `buildProblemSet` at "Selected topics not found", two clicks from anything that explains it. That is the same lesson as `wasAttempted` above — each new way of being wrong needs its own gate.

The verdict is a closed enum so **the rejection copy can be ours**. A model that has just read attacker-chosen content, rendered under our own heading, is a phishing surface even though React escapes it; `MATERIAL_REJECTION` maps the enum to text we wrote.

Originals are swept in a `finally`, so a failed reading leaves nothing behind — the privacy policy says the file is not kept, and the failure path is exactly what would quietly make that untrue. `clearMaterials` in `account.ts` is the backstop for a tab closed between the storage write and the POST.

`safetySettings` is per-call (`STRICT_SAFETY`) and set only here. The authoring chain wants looser thresholds — maths word problems get false-positived — and it is a *content-policy* gate, not an injection defence: anyone weakening the digest because the filter exists has traded a wall for a filter.

### Printing, and the loop it closes

`src/app/set/[id]/print` is the other half of scanning: nothing produced the paper that scanning assumes. It renders through `prepareProblem()` unchanged, so KaTeX and plots stay in Node.

Two rules. The answer key is behind `?key=1` and `loadAnswerKey()` **re-proves ownership** rather than trusting the page above it — it reads the `answer` column, so it gets its own check, on the same reasoning as `/api/check`. And the `@media print` block in `globals.css` forces the light palette over both the media query and an explicit `[data-theme]`: a plot drawn in dark mode is light strokes on a dark fill, which prints as an unreadable black rectangle, so a student practising at night would otherwise print an unusable sheet.

Both the key renderer (`print-key.ts`) and the on-paper answer space (`components/print/answer-space.tsx`) end in `assertNeverFormat`, so adding a format is a compile error here too — the failure they prevent is a question printed with nowhere to answer it, which is only discovered once the sheet is handed out.

### Guest sign-up has a CAPTCHA, and it is two coupled switches

`src/lib/captcha.ts` solves a Cloudflare Turnstile challenge inside `ensureUser()`, only on the path that creates a *new* anonymous user — so once per browser, not per action. All four `ensureUser()` call sites are unchanged.

**It is off unless `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set**, and that is load-bearing: with no key nothing is loaded and Cloudflare is never contacted, so the code can ship independently of the dashboard change. Enabling CAPTCHA in Supabase *without* the key set breaks every guest session — the default path through the entire app — so the key always goes first.

Two things that will bite anyone touching this:

- **`frame-src` is required.** Turnstile renders in an iframe, and with no `frame-src` the directive falls back to `default-src 'self'` and the challenge is blocked. The host is also in `script-src` purely for browsers that ignore `strict-dynamic`; under `strict-dynamic` the injected script inherits trust already.
- **The privacy policy names Cloudflare as a processor.** It previously said "that is the complete list" of three. Any new third party the app contacts has to be added there in the same change, or the policy becomes false.

### Security headers and the CSP nonce

Static headers live in `next.config.ts`; the CSP is built per request in `src/proxy.ts` because it carries a nonce. The proxy sets it on the *request* as well as the response — Next parses the request's CSP header during render and stamps the nonce onto every script it emits. Anything the app injects itself needs the nonce by hand, which today is the theme script in `layout.tsx` (blocked → a flash of the wrong theme on every load).

`style-src` deliberately keeps `'unsafe-inline'` and takes no nonce: a nonce there would *disable* `'unsafe-inline'` rather than add to it, breaking progress meters and `next/font`. Scripts get the nonce; styles do not.

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

### Four invariants keep the client bundle small

All four are easy to undo by accident and none of them fail loudly — the app keeps working, the bundle just grows. **`client-bundle.test.ts` is what makes them fail loudly**: it walks every `"use client"` file, follows static value imports transitively, and asserts none reaches `zod`, `katex`, `@google/genai` or `@supabase/*`. Two things stop the walk, and both are real boundaries rather than exceptions — `await import(...)` (its own chunk, fetched on a click) and a `"use server"` module (replaced at the import site by an RPC stub). A `"use client"` file that nothing statically imports is not an entry either; `lib/auth.ts` is one, which is why it may import the Supabase SDK directly.

1. **KaTeX never reaches the browser.** `src/lib/math-render.ts` (`renderMath`, `renderProse`, `prepareProblem`) runs KaTeX in Node; `src/components/latex.tsx` only injects the resulting HTML and must not import `katex`. Server Components and `/api/check` pre-render every expression — which is why `CheckResponse` carries `*_html` fields rather than LaTeX. Importing `katex` from a Client Component silently adds ~275 kB. `renderProse` escapes its text segments, since it builds a string where React used to escape for us.
2. **The Supabase browser SDK is lazily imported.** Auth is resolved server-side by `getCurrentUser()` in `src/lib/auth-server.ts` (wrapped in React `cache`, so the root layout and the page share one round-trip) and handed to `AuthButton` as a plain prop. `@/lib/auth` is `await import(...)`-ed at the point of a click or a submit. A top-level import from any client component puts ~64 kB gzipped back on every route.
3. **Plots are drawn in Node too.** `src/lib/plot.ts` renders a declarative spec (window, curves, marks, grid) to an SVG string; `prepareProblem()` calls it and ships `plot_svg`. Same reasoning as KaTeX — the plot is a fixed stimulus that never animates or re-fits, so it does not justify a charting library in the bundle. Colours are CSS custom properties, so plots follow the theme without this module knowing which one is active. The geometry half (`plotGeometry`, `curveFromHandles`) is pure arithmetic and *is* imported by the interactive overlays, so the drawn axes and the click targets agree by construction rather than by two copies of the same transform. `describePlot()` derives the accessible name from the same spec — the plot *is* the question on a read-a-value problem, and a constant "Coordinate plot" told a screen-reader user only that a picture existed.
4. **The problem vocabulary lives apart from the schemas.** `src/lib/ai/kinds.ts` holds the format and style lists, the generation kinds and the exhaustiveness guards, with no zod in it; `schemas.ts` re-exports all of it, so it is still the one file to open. Client components import values from `kinds`, never from `schemas`. This is not hypothetical tidiness: `schemas.ts` defines 36 top-level schemas, and four components importing a *value* from it — a format list, `assertNeverFormat` — put 283 kB of zod on seven routes including the landing page. The same rule covers `wasAttempted`, which lives in `src/lib/scan-marks.ts` and is re-exported from `grade-scan.ts`.

### Practice progress is derived, not stored

`src/lib/progress.ts` reconstructs state from `attempts` rows — no extra column and no migration. `is_correct` carries the whole tri-state: `true`, `false`, or `null` for "revealed"; a problem with no row is unattempted. This is also why the client can't fabricate a score. `POST /api/check` has a third action, `recall`, which replays an outcome the student already earned without writing a new attempt — it 404s when no prior attempt exists, so it can't be used to read an answer key early.

### Design system

`src/app/globals.css` holds the whole vocabulary: tokens (light, `prefers-color-scheme` dark, and an explicit `[data-theme]` override that wins over both), `@theme inline` mappings, then `.btn` / `.chip` / `.field` / `.panel` / `.badge` / `.meter` / `.eyebrow` component classes. Prefer composing those over inventing new ad-hoc utility stacks.

Two rules the palette depends on:

- **The accent is oxblood and "incorrect" is a red.** They are separated by lightness, hue, and containment — the accent never appears inside a graded answer region. Introducing accent-coloured UI next to correct/incorrect markers is the one reliable way to make this palette fail.
- **Correctness is never colour alone.** Every ok/bad state pairs the colour with an icon and a word.

Toggle state lives on `aria-pressed`, which is also the styling hook, so the visuals and the accessibility tree can't drift apart.
