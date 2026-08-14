# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

@AGENTS.md

**README.md is the setup and product document** — install, environment variables, Supabase dashboard configuration, the CAPTCHA rollout procedure, the route map, the limits table. It is the better copy of all of that; this file does not repeat it. What follows is the reasoning a change has to survive.

## Traps

Every one of these fails *silently* — the app keeps working and something is quietly wrong. Each names the file that explains it.

| Trap | Where |
|---|---|
| A model call on the route's path to `buildProblemSet` is subtracted from the generation budget twice | `sets.ts`, `api/sets/route.ts` |
| Holding a pool slot while awaiting work that needs pool slots deadlocks the build | `sets.ts:517` |
| `$ref` in a schema sent to Gemini fails at request time with an opaque 400 | `schemas.ts`, `provider-schema.test.ts` |
| Gemini does not enforce `const`, `.max()`, `.min()` or `.int()` | `schemas.ts` (`stamped`, `normalizeDigest`) |
| A `"use client"` file statically importing `zod`/`katex`/`@supabase/*` adds hundreds of kB to every route | `client-bundle.test.ts` |
| A bracketed `name:value` anywhere in the repo is Tailwind arbitrary-property syntax and lands in the stylesheet | `provider.ts:136` |
| A template whose `topicSlugs` don't match `topics.slug` is silently never used | `templates/index.ts` |
| A `status` value outside `problems_status_check` drops the row out of `problems_pick` and out of the pool for good | `sets.ts` |
| `insertProblems` upserts, so a content-hash collision *overwrites* rather than skips | `sets.ts` (`contentHashFor`) |
| A key present on only some rows of an array insert arrives as NULL on the rest | `sets.ts` |
| `siteUrl()` must never produce a host the deployment does not serve | `env.ts:110`, `env.test.ts` |
| `NEXT_PUBLIC_*` inlining only works for a literal `process.env.NAME` expression | `env.ts` |
| Dropping `experimental.viewTransition` stops every route animation, silently | `next.config.ts` |
| A nonce on `style-src` *disables* `'unsafe-inline'` rather than adding to it | `proxy.ts` |
| Enabling CAPTCHA in the Supabase dashboard before setting the site key breaks every guest session | `captcha.ts` |
| Storage has no cascade from `auth.users`, so files must be swept *before* the row delete | `account.ts` |
| A seeded problem solved in the context that authored it is stamped `verified` having been verified by nobody | `tools/seed-pool/solve.ts` |
| A rate-limited `claude -p` waits instead of refusing, so a seeding run without a per-attempt cap spends hours looking busy | `tools/seed-pool/auto.ts` |

## Commands

```bash
npm run dev            # next dev
npm run build          # next build
npm start              # next start — serve the production build
npm run lint           # eslint
npm run test           # vitest run (offline tests only)
npm run seed           # pool-seeding CLI; `npm run seed -- --help`
npx tsc --noEmit       # typecheck — there is no npm script for this

npx vitest run src/lib/__tests__/core.test.ts   # one test file
npx vitest run -t "normalizeMath"               # one test by name

# Live tests self-skip without their key, so `npm run test` stays offline.
# Run them with env loaded — the live-provider/batching/material/nondrill files
# need GEMINI_API_KEY, live-account needs SUPABASE_SECRET_KEY:
node --env-file=.env.local ./node_modules/vitest/vitest.mjs run src/lib/__tests__/live-provider.test.ts
```

Vitest resolves `@/*` → `src/*` via `vitest.config.ts` (mirrors `tsconfig.json`), so tests import app modules directly. `.github/workflows/check.yml` runs lint, tsc and the offline suite on every push and PR.

`npm run lint` extends `eslint-config-next/core-web-vitals`, which turns on the React Compiler rules. Three reject code that is idiomatic elsewhere:

- **`react-hooks/purity`** — no `Date.now()`/`Math.random()` during render, including `useRef(Date.now())` and Server Component bodies.
- **`react-hooks/set-state-in-effect`** — an effect may not call `setState` synchronously. Trigger the work from the event handler instead.
- **`react-hooks/immutability`** — don't mutate values the component didn't create; wrap the mutation in a module-scope function.

There is no local database. Schema lives in the Supabase project's migration history, not in this repo — inspect and change it through the Supabase MCP server (`.mcp.json`), not files.

## Git and GitHub

**Use git the way a developer on this repo would, without being asked each time.** Fetch, branch, commit, push and open PRs as ordinary parts of doing the work. Standing authorization for all of it.

- **Start from the remote.** `git fetch origin` and branch off `origin/main` — check `git log --oneline -1 origin/main` rather than trusting the working copy. **Never commit to `main`**; branch first (`feat/…`, `fix/…`, `perf/…`, `prod/…`).
- **Every commit typechecks and passes `npm run test` on its own** — the stack has to be bisectable. When a file spans two concerns, assign it whole to the commit its dominant change belongs to rather than doing hunk surgery that leaves an intermediate commit broken.
- **Commit messages match the existing history**: an imperative sentence saying what changed, and a body saying *why* — the failure it prevents, the thing that looked sufficient and wasn't. No Conventional Commits prefixes. `git log` here is the record of decisions this file summarizes.

**The DB is not in the repo, so a migration cannot ride along in a commit.** A schema change is applied to the live project via MCP and is live the moment it is applied — before the code that needs it is written, let alone merged. Migrations therefore have to be additive and safe against the currently deployed code: `problems.status` shipped with `DEFAULT 'active'` precisely so the deployed build, which knew nothing about the column, kept inserting successfully. Name the applied migrations in the commit message of the code that depends on them, since nothing else connects the two.

Two things warrant asking first, because neither is recoverable from the reflog by the person who has to notice it went wrong: **force-pushing a branch someone else may have pulled**, and **merging a PR**.

## Architecture

### The generation pipeline is the core of the app

`src/lib/sets.ts` → `buildProblemSet()` is an async generator that yields `BuildEvent`s; `POST /api/sets` (`maxDuration = 300`) serializes them as SSE and `builder-form.tsx` consumes them for live progress. Sets are filled in cost order:

1. **Pool reuse** — verified `problems` rows matching topic/style/format/difficulty, excluding anything the user attempted in the last 30 days, ordered by `times_served` ascending, then bumped via the `bump_times_served` RPC. Capped at `POOL_FRACTION` (half) of the set. `bespoke()` builds — a focus or a material — skip reuse entirely and pay the AI cost for every slot.
2. **Templates** — deterministic, free, instant. At most half the remaining slots when non-drill styles were also requested.
3. **AI generate → verify → repair** — batched authoring and batched verification, overlapped. At most two rounds (`regenAttempted`).

**Two budgets exist because delivering a short set beats delivering nothing.** `buildDeadline` (230s) stops *starting* new AI rounds before the route's 300s limit, and generation capacity failures break out of the loop with whatever was already gathered instead of throwing. `saveFailed` is tracked rather than inferred from an empty return, for the same reason.

**Step 3 is where the wall clock goes, and it is one pipeline, not two phases.** Authoring is by far the most expensive thing the app does — a batch runs 30-60s against a ~1s independent solve — so every authoring call for a set is in flight at once, and `onBatch` starts verifying each batch the moment it lands. Four consequences:

- **Authoring and verification share one `createCallPool(AI_CONCURRENCY)`**, created once per build. A limit each would burst to the sum and spend the difference in 429 backoff.
- **The `onBatch` closure deliberately holds no pool slot** (`sets.ts:517`). It awaits work that itself needs slots, and holding one while doing so is how a bounded pool deadlocks. This is the sharpest trap in the concurrency code.
- **Concurrent batches cannot see each other's output**, so the sequential `avoid`-list accumulation that used to prevent repeats is gone. `statementKey` dedup in `generateProblems` replaces it; whitespace-and-case only, because it only has to catch the model landing on the same problem twice.
- **A capacity failure is per-call.** `generateProblems` collects with `allSettled` and rethrows only when nothing at all was produced.

**The free tier meters requests per day, not tokens, and that is what the call layout is for.** A call costs roughly the same whatever it carries, so the number of *calls* a set makes decides how many sets a day exist — which makes `PROBLEMS_PER_CALL` a request-count dial, not a latency one (twelve problems: 58s at six per call, 66s at three, because a call spends 3.5-7k thinking tokens planning the batch almost regardless of its size). The two halves are packed for opposite reasons:

- **Authoring packs as hard as it can.** The count is split across generation kinds first, because `graph` is three unrelated tasks, but the mix is then packed into as few calls as it fits in. That split-before-chunk ordering used to make the *number of formats* set the request count: a six-problem set cost twelve requests and now costs three.
- **Verification packs gently** (`SOLVES_PER_CALL`, 5) — a context limit, not a throughput one, because a long shared context is where a solver starts pattern-matching between problems instead of solving each. `SolvedBatchSchema` carries `problem_number` for the same reason: pairing results positionally would mis-pair the entire tail of a batch the moment a model returned four results for five problems, and a problem judged against its neighbour's solution is the worst failure available here. An unclaimed problem comes back `null` and is re-solved alone.

Progress is emitted from inside those parallel callbacks through `asyncQueue` (`src/lib/async-queue.ts`), because an async generator cannot `yield` from a callback. Without it the meter can only move between phases — exactly the stretch where it used to read `0/8` for minutes on a targeted build that skips both the pool and templates.

**Nothing on the route's path to `buildProblemSet` may call a model.** `BUILD_BUDGET_MS` counts from `requestStartedAt`, so a call made in the preamble is subtracted from generation twice over — once in wall clock, once in budget. Hence `cachedCoachRead` rather than `loadCoachRead` on the targeted branch: 2s warm but 24s cold, and it only ever sharpens directives the app computes anyway. It also ignores the cache signature and needs no snapshot, which is what lets it run inside `Promise.all` with `loadStatsSnapshot` instead of behind it. The material branch obeys the same rule: analysis is its own endpoint, so the build reads a stored digest for free.

### Every model call goes through one function

`src/lib/ai/provider.ts` → `callStructured()`. Nothing else may talk to the SDK. Its contract shapes every caller:

- **Returns `null`** when a model produces unusable output (unparseable, schema mismatch, non-retryable error). Callers must have a discard path — a short set is acceptable, a crash is not.
- **Throws** only when the entire model chain is rate-limited/overloaded/timed out, which is worth surfacing to the student.
- Models are preference-ordered chains (`GENERATOR_MODELS`, `CHECKER_MODELS`), env-overridable. Free-tier Flash models return 503 in bursts, so each role falls through to an older sibling.
- **Failures are classified three ways, not two** (`classify()`, `provider.ts:267`), and collapsing them is what broke production: `capacity` retries here then falls through, `model` skips this model and says nothing about the next, `request` stops the chain. As a boolean, a retired model answering 404 read as "not retryable" and abandoned the whole chain, so the capacity error behind it never reached the throw that says so — every caller saw an ordinary `null`, and a student was told no problem passed verification when nothing had been written to verify. `modelBlockedUntil` (`:304`) records a model as out of quota at *module scope* so it outlives one build on a warm lambda; without it, all ~100 calls of a build rediscover the same exhausted model.
- Gemini 3.x takes `thinkingLevel`, 2.5 takes `thinkingBudget` — `thinkingConfigFor()` sends only what a given model understands.
- **Every call traces one line** — `label`, `model`, `calls`, `ms`, `result`, `finish`, `in`/`out`/`think` tokens, and `skipped` on exhaustion — plus `[lemma/build] phase=…` per build phase. Nothing else records model latency, so a slow build and a stalled one are indistinguishable without it; set `label` on any new call site. **The separator is a slash and must stay one** — see the trap table.
- **The per-attempt timeout is derived from `budgetMs`, not fixed** (`attemptCap`, floored at `MIN_ATTEMPT_MS`). A flat 60s ceiling under the generator's 150s budget aborted batches that were still being written; an abort is classified retryable, so the call then spent its whole budget on retries that were always going to be cut off at the same point. Any new caller with a generous budget inherits the derivation — don't reintroduce a constant.
- Optional `images` make the call multimodal, which is why scanning needs no chain of its own. `ImagePart` is mime-agnostic (Gemini's `inlineData` verbatim), which is what lets study materials send PDFs through the same plumbing.
- Optional `safety` sets content thresholds **for one call**, with no default, deliberately: authoring and grading work on maths the app produced or a student typed, where a word problem about triage or debt is a plausible false positive. Only the study-material call, whose input is a file somebody chose, sets `STRICT_SAFETY`.
- **A refusal and a sulk both arrive as no text**, and they are traced apart because otherwise the one call with untrusted input is the one you cannot debug. `promptFeedback.blockReason` is the input-side block — it produces no candidates at all, so `finishReason` never sees it. Traced, not branched on: unusable output still returns `null`.

**Gemini JSON Schema constraint:** `$ref` is only supported in non-required properties, so every schema must be fully inlined (`z.toJSONSchema(..., { reused: "inline" })`); `provider-schema.test.ts` asserts none reaches a model. A discriminated union survives that round trip (`MixedBatchSchema` inlines to 18KB), so one call authors every format at once. `stamped()` cannot help there — it writes `format` from the request, and the point is that one request carries several — so the model self-reports, and the union makes that safe rather than hopeful: a problem whose `format` disagrees with its own shape fails to parse and is discarded. The union has to admit the permissive `GraphProblemSchema`, since a union discriminated on `format` holds only one `graph` member, and that costs nothing because `structuralCheck` already rejects a graph problem whose `response_kind` disagrees with the field it filled. Repair still asks per kind (`repairSchemaFor`): it fixes one known problem, so it knows the kind.

**Gemini does not enforce `const`.** `format` and `response_kind` are decided by *which schema was requested*, so `stamped()` writes them in before validation. Not defensive padding: shown "Format: graph_points", the model wrote that string into both literal fields and a completely correct problem was discarded by zod. Anything fully determined by the request should be stamped, not asked for.

It does not reliably enforce `.max()` either, and the cost of a rejection decides what to do about it: `CoachReadSchema` bounds its arrays in the schema because a discarded coach read only costs commentary, while `MaterialDigestSchema` carries **no** `.max()`, `.min()` or `.int()` at all — a discarded digest costs the student their upload *and* a daily slot — and `normalizeDigest` truncates afterwards instead. Same lesson as `stamped()`: what the server can fix, it fixes rather than asking for and then validating.

### Generation kinds vs. DB formats

`ProblemFormat` is the `problems.format` DB enum. `GenerationKind` is what one authoring call asks for, and the two differ in exactly one place: `graph` is three unrelated tasks (`graph_value`, `graph_points`, `graph_sketch`) sharing a format. `kindsForFormat()` expands a request, `formatForKind()` collapses it back, and `kindOf()` recovers the kind from an authored problem so it can be repaired with the schema that produced it. `splitAcrossKinds()` divides *after* expanding, so asking for six graph problems yields two of each rather than six of one.

### `src/lib/ai/schemas.ts` is the single source of truth

One set of zod schemas defines model structured outputs, the `problems` jsonb column shapes, and UI types. The zod-free halves live beside it and are re-exported, so it stays the one file to open: `kinds.ts` (the vocabulary and the exhaustiveness guards) and `problem-shapes.ts` (`SanitizedProblem`, `PreparedProblem`, `CheckResponse`, the three jsonb record types, `splitProblem`, `problemHashInput`).

`splitProblem()` is the security boundary: it partitions an authored problem into `content` (statement, choices, hint — safe-ish), `answer` (correct choice, canonical answers, distractor rationales — secret), and `explanation` (worked steps — secret until an attempt). `SanitizedProblem` is what the client is ever allowed to see.

`TaggedProblem` adds `topic_index` because a mis-attributed problem gets served forever to students studying the wrong topic; a bogus index is clamped, not discarded.

`assertNeverFormat()` is the guide rail for adding a format: every format-dependent branch ends in it, so a new entry in `PROBLEM_FORMATS` turns each unhandled site into a compile error rather than a silent wrong answer. `assertNeverGraphResponse()` does the same one level down. Adding a format is therefore "add it, then fix what the compiler lists" — plus a fixture in `formats.test.ts`, which is keyed off `PROBLEM_FORMATS` so a format without one fails the suite.

### Verification and grading are separate ladders

**Verification** (generation time) splits across two files by how it fails. `structural-check.ts` → `structuralCheck()` is free and synchronous — KaTeX renders every math segment, MCQ ids unique and non-duplicate by normalized value, fill-blank placeholders all answered — and is the most-tested function in the repo. `verify.ts` is the model half: normally `solveBatch()` for a whole batch at once, with `solveIndependently()` as the per-problem fallback, always on the statement *only* (no answer leakage) → `solverGates()` → on disagreement, one `repairProblem()` pass adjudicated by a re-solve.

`solverGates` is where a new gate goes. Two of the existing ones are non-obvious: `flawIsThePoint` exempts `error_analysis` from the well-posedness gate, because that style plants a deliberate mistake; and the difficulty tolerance is style-dependent (`drill ? 1.5 : 2.5`), because a flat 1.5 rejected most non-drill work at the builder's default of 2.

**Grading** (`src/lib/answers.ts` + `src/lib/ai/check-answer.ts`, submission time): local `normalizeMath()` comparison first — LaTeX → canonical ASCII, then exact match, acceptable forms, numeric parse, multiset compare for multi-valued answers. Only an `"uncertain"` result escalates to an AI equivalence call. `normalizeMath` is shared by both ladders, so changes to it affect verification and grading together — `core.test.ts` covers it.

### Two modules own things that were previously scattered

**`src/lib/env.ts` is the only place `process.env` is read** (outside the model-chain overrides in `provider.ts`). It replaced eight `process.env.X!` assertions whose failure mode was `supabaseUrl is required` thrown from inside a vendor module — true, but naming neither the variable nor where to set it.

`siteUrl()` is the important one, and its fallback order is load-bearing: **a preview deployment describing itself** (`VERCEL_ENV === "preview"` + `VERCEL_URL`), then `NEXT_PUBLIC_SITE_URL`, then `VERCEL_PROJECT_PRODUCTION_URL`, then `VERCEL_URL`, then localhost with a warning. The preview branch has to come *first*: `NEXT_PUBLIC_SITE_URL` is set once per Vercel project and applies to every environment, so with it checked first every preview answered with the production origin — robots.txt pointing at the real sitemap, canonicals claiming the real pages, and a link to a preview unfurling as the live site. Before that, an unset variable fell back to a hardcoded `https://lemma.app`, a domain the project does not own. **Nothing in that chain may ever produce a host the deployment does not serve.** It does not throw on the last step, because throwing fails a plain `npm run build`; `env.test.ts` pins the order.

Note that `NEXT_PUBLIC_*` inlining only works for a *literal* `process.env.NAME` expression. A dynamic lookup compiles to an undefined read in the browser, which is why those reads are spelled out rather than driven from a list.

**`src/lib/limits.ts` holds every spend cap in one table**, at two levels. Adding a spend path means adding a row, not a new bespoke count.

- **Per user, per day** (`DAILY_LIMITS`, `capFor`). These **fail closed**: an unreadable count returns `CAP_CHECK_FAILED` rather than passing. Reading the error as `null` and letting `(count ?? 0) >= cap` resolve to *under* the limit did not degrade the caps, it removed them, silently, for as long as the hiccup lasted.
- **Per network** (`IP_LIMITS`, `ipAllowance()` → the `rate_check` RPC over `rate_events`). This **fails open**, and the asymmetry is the point: it sits *behind* a per-user cap that is itself fail-closed, so an unreachable counter still leaves a working bound, and refusing here would make every set in the app depend on one more table being healthy. `clientIp()` prefers `x-vercel-forwarded-for` because the edge stamps it and a caller cannot choose it; `x-forwarded-for` is the fallback and only its first hop is the client. `subjectFor()` salts the hash from the service key rather than a separate variable, so there is no way to deploy this correctly-but-unsalted.
- **`aiGradingAllowed` returns `true` when its own count query fails**, which is the third direction and also deliberate: exhausted AI grading must fall back to the local verdict and skip the diagnosis, so a student mid-set loses the explanation, never the mark. `checkSubmission(..., { allowAi: false })` is how, and it resolves an inconclusive answer to incorrect — already what happens when the provider is unreachable. Guessing permissively costs one model call; guessing the other way silently switches every student into degraded grading for the rest of the day.

### Supabase: three clients, pick deliberately

| File | Key | Use |
|---|---|---|
| `src/lib/supabase/client.ts` | publishable | browser components |
| `src/lib/supabase/server.ts` | publishable + cookie session | Server Components, route handlers — RLS applies as the signed-in user |
| `src/lib/supabase/service.ts` | `SUPABASE_SECRET_KEY` | server only, **bypasses RLS** — never import from client code |

`problems` has RLS enabled with **no policies** (deny-all) because it holds the answer key. Answers reach the client only through `/api/check`, which first proves the problem appears in a set the caller owns — problems are pooled across users, so checking `setId` alone (or skipping the check when it is null) would leak arbitrary answer keys. Grading outcomes are written server-side only, so practice history can't be fabricated.

Auth is anonymous-by-default: `ensureUser()` calls `signInAnonymously()`, and Google sign-in uses `linkIdentity()` so the user id — and therefore all history — survives the upgrade. Three call sites route everything: `build-run.tsx`, `add-shared-set.tsx`, `bucket-upload.ts`. A guest's identity lives only in their session cookie, so clearing it orphans their sets permanently — don't clear cookies to test the signed-out state; fetch with `credentials: "omit"` instead.

**Sign-in depends on three dashboard settings and none are in this repo** (anonymous sign-ins, the Google provider, and **Allow manual linking**, which `linkIdentity()` requires and which is off by default). They are invisible from the code and the MCP server cannot read them, so when sign-in fails read `error_code` in the Supabase auth logs before touching anything — `auth-errors.ts` maps those codes to the copy on `/signin`, and the callback forwards the real code rather than a generic flag precisely so the page can name the cause. README documents the settings themselves.

Server Actions (`src/app/sets/actions.ts`) use the RLS-scoped server client deliberately: the `delete own sets` policy *is* the authorization check, so a forged id matches no rows. At the DB level `problem_set_items.set_id` cascades, but `attempts.set_id` is `ON DELETE SET NULL` — practice history outlives the set it was earned in, which is why deleting a set can't fail on a foreign key.

### Worksheet scanning

`src/app/set/[id]/scan` → the browser uploads photos straight into the private `worksheet-scans` bucket under `${userId}/...` (which is what the storage policies key on, and keeps megabytes of photo out of the serverless request body), then `POST /api/scan` marks them.

`grade-scan.ts` asks the model for two separable things and the schema keeps them apart: *transcribing* the handwriting and *judging* the maths. `confidence` scores the transcription only. Anything below `SCAN_CONFIDENCE_THRESHOLD` is withheld from `attempts` and returned as `needs_confirmation` — a confident misread would otherwise become permanent wrong history, the one failure mode that makes scanning worse than not having it.

**Confidence is not the only such gate**, and the second one is the general lesson. `wasAttempted()` exists because the first gate did not cover the case that actually happened: a page numbered "6)" with nothing after it came back `found: true, read_answer: "", correct: false, confidence: 1`, sailed through the threshold — the model was *correctly* certain it had read a blank — and was recorded as a miss. Confidence guards misreading; "not attempted" is a different failure and needs its own rule. A blank is decided server-side, never recorded and never offered for confirmation, and the results view scores out of what was attempted so a half-finished page reads 3/3 rather than 3/6. **Each new way of being wrong needs its own gate, not a wider threshold on an existing one.**

Scanned marks are written as `attempts` rows with `mode: "scan"` (`scored`, no retry — the paper is already written), so they feed Review, Stats and the coach like typed practice. Rows are inserted **one at a time** because `attempts_one_per_attempt` makes duplicates *expected* — the student may have typed some problems already — and a batch insert would lose every mark to one collision. A conflict skips that problem and leaves the earlier outcome standing.

`worksheet_uploads` has INSERT/SELECT policies but no UPDATE, which is correct: `status` and `grading` are written by the service client after marking, and a client that could write them could mark its own work.

### Study materials

`/materials` → the browser uploads photos or a PDF into the private `study-materials` bucket (same prefix convention as scans), or just pastes text, then `POST /api/materials` reads it once and stores a **digest**. `/materials/[id]` shows what was found, lets the student adjust it, and builds through the `mode: "material"` branch of `POST /api/sets`.

**The digest is the containment boundary, and it is a bottleneck rather than a sanitizer.** Uploaded pages are chosen by whoever is holding the browser, so the question is not whether they can be hostile but where they stop. `MaterialDigestSchema` is where: closed enums plus short capped strings, produced by one model call told the input is data, and nothing else from an upload reaches the authoring prompt. Same argument `callStructured` makes everywhere — a hijacked call still has to emit schema-valid JSON — and it beats escaping, because an escape list is a list of the tricks somebody already thought of. `tidyText` is an *allowlist* on top, deliberately unlike `quoteNote` in `coach-plan.ts`, which guards text that is only student-influenced.

- **The student's note is interpreted at ingest, never passed through.** It reaches `requested_shift` / `requested_styles` / `requested_emphasis`, and the raw sentence is stored only so an abusive upload can be understood later. That is what makes each injection attempt cost a `materials` slot and a 40s round trip rather than a keystroke — the property that matters, since injection is found by iteration.
- **`SetConfig.material` obeys the same rule as `focus`, drawn one notch differently.** The rule was never "the client writes nothing" — `ManualSchema` has always taken client-chosen topics, level, styles and formats. It is *the client may write closed vocabularies and never prose*. So the review step sends back those four (with `topicIds` subset-checked against the digest's own) and `concepts`/`archetypes`/`emphasis` are read server-side from the stored digest.
- **`STRICT_SAFETY` is set only here, and it is a content-policy gate, not an injection defence.** Anyone weakening the digest because the filter exists has traded a wall for a filter.
- **The verdict is a closed enum so the rejection copy can be ours.** A model that has just read attacker-chosen content, rendered under our own heading, is a phishing surface even though React escapes it; `MATERIAL_REJECTION` maps the enum to text we wrote.
- **Originals are swept in a `finally`**, so a failed reading leaves nothing behind — the privacy policy says the file is not kept, and the failure path is exactly what would quietly make that untrue. `clearMaterials` in `account.ts` is the backstop for a tab closed between the storage write and the POST.

**Material problems are `unlisted` *and* hash-namespaced, and the second half is not optional.** `insertProblems` upserts on `(topic_id, content_hash)`, which PostgREST compiles to `ON CONFLICT DO UPDATE SET` every column in the payload — so a collision overwrites rather than skips, and `status` is the first column where two rows sharing a hash legitimately disagree. Adding `status` alone runs the overwrite both ways: a material build demotes a shared pool problem to `unlisted` for everyone, and a later ordinary build promotes a material problem to `active` and serves somebody's homework to strangers. Both silent, and no query the app makes would show either. `contentHashFor` prefixes `material:${id}::`, which leaves the only possible collision the useful one — the same material asked twice.

Two more rules about that column. `problems_pick` is a partial index over `status = 'active'`, so the exclusion is free — and that partiality is why `problems_status_check` pins the column to those two values in the DB: an unrecognised status raises nothing, it just drops the row out of the index and out of the pool for good, so adding a third means a migration and not only a change to `ProblemStatus`. And `status` has to be on *every* row, because supabase-js sends an array insert with one shared column list: a key present on some rows only arrives as NULL on the rest, and the column is NOT NULL.

`normalizeDigest` **filters** a bad `topic_index` where `generateProblems` **clamps** one — the same input, two failures. There a wrong number mis-tags one otherwise-fine problem; here it chooses what a whole set is about, so clamping to topic 0 would anchor everything to whatever happened to be first. An empty list after filtering means `failed`, never `ready`: a `ready` digest with no topics passes every check and then dies inside `buildProblemSet` at "Selected topics not found", two clicks from anything that explains it.

### Printing, and the loop it closes

`src/app/set/[id]/print` is the other half of scanning: nothing produced the paper that scanning assumes. It renders through `prepareProblem()` unchanged, so KaTeX and plots stay in Node.

Two rules. The answer key is behind `?key=1` and `loadAnswerKey()` **re-proves ownership** rather than trusting the page above it — it reads the `answer` column, so it gets its own check, on the same reasoning as `/api/check`. And the `@media print` block in `globals.css` forces the light palette over both the media query and an explicit `[data-theme]`: a plot drawn in dark mode is light strokes on a dark fill, which prints as an unreadable black rectangle.

Both the key renderer (`print-key.ts`) and the on-paper answer space (`components/print/answer-space.tsx`) end in `assertNeverFormat`, so adding a format is a compile error here too — the failure they prevent is a question printed with nowhere to answer it, which is only discovered once the sheet is handed out.

### Guest sign-up has a CAPTCHA, and it is two coupled switches

`src/lib/captcha.ts` solves a Cloudflare Turnstile challenge inside `ensureUser()`, only on the path that creates a *new* anonymous user — so once per browser, not per action.

**It is off unless `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set**, and that is load-bearing: with no key nothing is loaded and Cloudflare is never contacted, so the code ships independently of the dashboard change. Enabling CAPTCHA in Supabase *without* the key set breaks every guest session — the default path through the entire app — so **the key always goes first**. README has the rollout procedure.

- **`frame-src` is required.** Turnstile renders in an iframe, and with no `frame-src` the directive falls back to `default-src 'self'` and the challenge is blocked. The host is also in `script-src` for browsers that ignore `strict-dynamic`.
- **The privacy policy names Cloudflare as a processor.** It previously said "that is the complete list" of three. Any new third party the app contacts has to be added there in the same change, or the policy becomes false.

### Security headers and the CSP nonce

Static headers live in `next.config.ts`; the CSP is built per request in `src/proxy.ts` because it carries a nonce. The proxy sets it on the *request* as well as the response — Next parses the request's CSP header during render and stamps the nonce onto every script it emits. Anything the app injects itself needs the nonce by hand, which today is the theme script in `layout.tsx` (blocked → a flash of the wrong theme on every load).

`style-src` deliberately keeps `'unsafe-inline'` and takes no nonce: a nonce there would *disable* `'unsafe-inline'` rather than add to it, breaking progress meters and `next/font`. Scripts get the nonce; styles do not.

### Deleting your own data

`src/lib/account.ts` backs `/account` with three levels: clear practice history (keeps the sets, which cost model calls and a daily slot to generate), delete all data (keeps the account), and delete the account. `live-account.test.ts` exercises all three against throwaway users, and self-skips without `SUPABASE_SECRET_KEY`.

Two ordering facts make it work. Every user-owned table is `ON DELETE CASCADE` from `auth.users`, so `auth.admin.deleteUser()` takes the Postgres rows with it — but **storage has no such link**, so scans are swept first; after the cascade, the `worksheet_uploads` rows naming those files are gone and the objects can never be found again. Supabase also refuses `delete from storage.objects` outright ("use the Storage API"), so the sweep lists the bucket rather than trusting the upload rows, which catches files whose row was already removed.

Deletes use the service client with a `userId` resolved server-side, never one passed in — `attempts`, `study_sessions` and `coach_reads` are read-only under RLS, so an RLS-scoped delete would match no rows and report success.

`loadAccountSummary` returns `null`, never `0`, for a count it could not read. It originally *threw*, on the reasoning that "0" is the one wrong answer before a permanent deletion — but that 500'd the page, and the page is the only route to the deletion controls, so someone trying to erase their data found the controls gone. It happened in production.

### Templates

`src/lib/templates/` holds deterministic parametrized generators: seeded RNG in, a full `GeneratedProblem` out, so they are free and skip AI verification entirely (`verification: { method: "computed" }`). To add one, implement `Template` and register it in the `templates` array in `index.ts`. `topicSlugs` must match `topics.slug` values in the DB catalog — a typo silently disables the template. Templates only serve the `drill` style. `core.test.ts` structurally validates every template across seeds, difficulties, and formats.

### Seeding the pool offline

`src/tools/seed-pool/` (`npm run seed`) is the other way to fill step 1. Templates are free because they're computed; pool problems are free because somebody already paid for them, and until now the only somebody was a build. This lets the pool be stocked deliberately, with the authoring and the checking done by whoever runs the tool.

**Nothing in it reimplements the pipeline, and that is the whole design.** The briefs come from `GENERATOR_SYSTEM_PROMPT` + `buildUserMessage` + `solverPrompt`, `ingest` calls `structuralCheck` and `solverGates`, and the write goes through `insertProblems`. Four things were exported to make that possible rather than copied — that is the trade, and it is the right one: a second authoring specification would drift, a second set of gates would be the easier one to pass, and a second writer would reimplement the `ON CONFLICT` collapse it exists to avoid.

**The three steps are separate processes because the check has to be blind.** `.seed/authored.json` holds the key, the worked solution and the distractor rationales; `solve` writes out the statements alone and needs no database and no key, precisely so it can be run somewhere that has never seen them. Run it in the session that authored the batch and it will agree with itself, the gates will pass, and `verification.status = "verified"` will be written on a problem nothing verified. That is the sharpest trap here and the tool cannot detect it.

Three smaller decisions:

- **`method: "offline-independent-solve"`**, not the pipeline's `"independent-solve"`. Same check, different hands, and the column is the only record of which — anything ever found wrong with a batch seeded this way is findable by that string and by nothing else.
- **No repair pass.** `verifyOrRepair` spends a call rewriting a disagreed-with problem because a live build has a student waiting and a slot to fill. Nothing is waiting here, so a disagreement prints both answers and discards.
- **A prose answer is deferred, never resolved to `false`.** `solverAgrees` ends at "do these two mean the same thing?" for every `text` answer, which is every `proof`, `conceptual` and `error_analysis` problem. Live that goes to a model; here it is written to `.seed/adjudicate.json` and the next `ingest` picks it up. Answering it `false` in the meantime is the exact bug that once rejected 100% of prose-answered problems while drill looked fine, so `judgeAll` reports those as `deferred` rather than `rejected` — the distinction is what `deferringEquivalence` exists for.

It writes `status: "active"`, so it stocks ordinary builds only: `bespoke()` sets skip pool reuse by design. And it can only usefully write non-`drill` problems, since templates already serve `drill` for free.

**`auto` (`auto.ts`) is those three steps in a loop with `claude -p` as the author**, run in rounds until something stops it. It adds the loop, the ranking and the subprocess, and nothing else — `writeAuthoringBrief`, `normalizeAuthored`, `writeSolvingBrief`, `judgeAll` and `insertProblems` are the same functions the manual commands call. Seven decisions in it are non-obvious:

- **`--verify gemini` is the default, and it is not the cheap option.** `solveBatch` is a different model that never sees the workspace, so the independence is structural rather than requested; `--verify claude` spends no quota and is weaker for the same reason Gemini-checks-Gemini is. What makes the requests worth spending is that a pool problem is authored once and reused for as long as it lives, against five requests every time a build writes one.
- **Depth is counted over the requested styles and formats, not per cell.** The pool query matches those with `IN` and only difficulty with `=`, so forty drill/mcq rows are worth nothing to a student asking for a word problem in open form — and ranking on the raw total sends the whole run back to the deepest cells.
- **A round re-censuses, because the last round changed the answer.** Picking the cell list once would keep working whatever was thinnest an hour ago.
- **Running out of cells raises the target rather than ending the run** — past "covered once", *keep going* can only mean deeper, and raising the target deepens the catalog evenly instead of burrowing into whichever topic sorted first.
- **What a batch asks for is a rotating slice of the vocabulary, not all of it** (`rotate`). A dozen problems spread over four styles and eight formats is one or two of each, and `splitAcrossKinds` divides before the mix is packed into calls — so asking for everything at once buys a thin sample at the worst request count. Depth is still measured over the whole requested vocabulary, which is what brings the cell back until it is stocked across all of it.
- **The per-invocation timeout is derived from what is left of the run** (`attemptCap`), for the same reason the provider's is. A rate-limited subscription does not refuse; `claude -p` waits, indistinguishable from a long batch. One observed invocation ran 2.5 hours inside a 20-minute run — and resolving on the kill's `close` rather than on the timer is what let it, since `close` waits for every inherited stdio pipe.
- **A cell's outcome is decided by the file, not the exit code.** An author that wrote `authored.json` and then wedged has done the expensive part.

Two smaller ones. The subprocess gets `Read,Write,Edit` and deliberately not `Bash`, and the child environment has the parent session's `CLAUDE*` variables cleared (`childEnv`) — a nested `claude -p` that inherits them hangs rather than failing, which reads as a slow model. And a *successful* cell's workspace is swept, so a run over the whole catalog doesn't leave several hundred directories of answer keys behind it; what survives under `.seed/auto/` is the failures, which are the only ones worth opening.

**Stopping is a file as well as a signal.** A run started in another window has no Ctrl-C to receive, and killing it outright abandons the cell in flight along with the authoring already paid for. `npm run seed -- stop` writes `.seed/auto/stop`, which the loop checks before each cell; `auto` clears it at startup, since a stop left from last time is not this run's instruction.

**It also stops itself, and the two ways of producing nothing are counted apart.** A cell that authored a dozen problems and had all twelve rejected is the gates working on a hard patch of the catalog, and the next topic may be fine — ten in a row before it gives up. A cell that authored *nothing at all* is the tool being stuck (no `claude` on PATH, a subscription that has stopped answering), and each further attempt costs a full timeout to learn the same thing — three. Collapsing them into one counter makes one of the two numbers wrong.

### Next.js 16 specifics in use

- `src/proxy.ts` is the renamed `middleware` convention (deprecated in 16); it refreshes the Supabase session for Server Components. It runs its own `getUser()`, so a navigation costs that round-trip plus the layout's (cached) one.
- Route and page `params` are `Promise`s — `await params` on the server. No client component unwraps them: every route resolves its data in a Server Component and passes it down.
- Pages set `export const dynamic = "force-dynamic"`, and the root layout reads auth regardless, so nothing renders statically except the metadata routes.
- `next.config.ts` enables `experimental.viewTransition`, which the `<ViewTransition>` in `layout.tsx` needs; `src/types/react-view-transition.d.ts` supplies the types `@types/react` doesn't ship yet. Drop the flag and route animations stop silently.

## Conventions

- Comments explain *why*, especially where a decision looks arbitrary (budgets, fallback ordering, clamping vs discarding). Match that when touching this code; don't add narration of what the line does.
- Failure paths degrade rather than throw: partial sets, discarded problems, `null` returns. Preserve that when adding steps to the pipeline.

## Presentation layer

### Four invariants keep the client bundle small

All four are easy to undo by accident and none of them fail loudly — the app keeps working, the bundle just grows. **`client-bundle.test.ts` is what makes them fail loudly**: it walks every `"use client"` file, follows static value imports transitively, and asserts none reaches `zod`, `katex`, `@google/genai` or `@supabase/*`. Two things stop the walk, and both are real boundaries rather than exceptions — `await import(...)` (its own chunk, fetched on a click) and a `"use server"` module (replaced at the import site by an RPC stub). A `"use client"` file that nothing statically imports is not an entry either; `lib/auth.ts` is one, which is why it may import the Supabase SDK directly.

1. **KaTeX never reaches the browser.** `src/lib/math-render.ts` (`renderMath`, `renderProse`, `prepareProblem`) runs KaTeX in Node; `src/components/latex.tsx` only injects the resulting HTML and must not import `katex`. Server Components and `/api/check` pre-render every expression, which is why `CheckResponse` carries `*_html` fields rather than LaTeX. Importing `katex` from a Client Component silently adds ~275 kB. `renderProse` escapes its text segments, since it builds a string where React used to escape for us.
2. **The Supabase browser SDK is lazily imported.** Auth is resolved server-side by `getCurrentUser()` (`auth-server.ts`, wrapped in React `cache` so the layout and the page share one round-trip) and handed to `AuthButton` as a plain prop; `@/lib/auth` is `await import(...)`-ed at the point of a click. A top-level import from any client component puts ~64 kB gzipped back on every route.
3. **Plots are drawn in Node too.** `src/lib/plot.ts` renders a declarative spec to an SVG string and `prepareProblem()` ships `plot_svg` — same reasoning as KaTeX, since a plot is a fixed stimulus that never animates or re-fits. Colours are CSS custom properties, so plots follow the theme without this module knowing which one is active. `plotGeometry` is pure arithmetic and *is* imported by the interactive overlays, so the drawn axes and the click targets agree by construction rather than by two copies of one transform. (`curveFromHandles` lives in `graph-sketch.tsx`, the client component that needs it, not here.) `describePlot()` derives the accessible name from the same spec — the plot *is* the question on a read-a-value problem, and a constant "Coordinate plot" told a screen-reader user only that a picture existed.
4. **The problem vocabulary lives apart from the schemas.** Client components import values from `kinds`, never from `schemas`. Not hypothetical tidiness: four components importing a *value* from `schemas.ts` — a format list, `assertNeverFormat` — put 283 kB of zod on seven routes including the landing page. The same rule covers `wasAttempted` (`scan-marks.ts`) and the shapes in `problem-shapes.ts`.

### Practice progress is derived, not stored

`src/lib/progress.ts` reconstructs state from `attempts` rows — no extra column and no migration. `is_correct` carries the whole tri-state: `true`, `false`, or `null` for "revealed"; a problem with no row is unattempted. This is also why the client can't fabricate a score. `POST /api/check` has a third action, `recall`, which replays an outcome the student already earned without writing a new attempt — it 404s when no prior attempt exists, so it can't be used to read an answer key early.

### Design system

`src/app/globals.css` holds the whole vocabulary: tokens (light, `prefers-color-scheme` dark, and an explicit `[data-theme]` override that wins over both), `@theme inline` mappings, then `.btn` / `.chip` / `.field` / `.panel` / `.badge` / `.meter` / `.eyebrow` / `.aside-rule` / `.dropzone` / `.option-row` / `.plot-frame` component classes. Prefer composing those over inventing new ad-hoc utility stacks.

Two rules the palette depends on:

- **The accent is oxblood and "incorrect" is a red.** They are separated by lightness, hue, and containment — the accent never appears inside a graded answer region. Introducing accent-coloured UI next to correct/incorrect markers is the one reliable way to make this palette fail.
- **Correctness is never colour alone.** Every ok/bad state pairs the colour with an icon and a word.

Toggle state lives on `aria-pressed`, which is also the styling hook, so the visuals and the accessibility tree can't drift apart.
