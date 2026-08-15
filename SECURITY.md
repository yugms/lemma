# Security

The `problems` table holds answer keys, so the design assumes the client is hostile.

## Reporting a vulnerability

Open a private security advisory on this repository rather than a public issue.

## Model

- **`problems` has RLS enabled with no policies** — deny-all. It is read server-side only, and `loadSetForUser()` strips every row into a `SanitizedProblem` before anything renders.
- **`/api/check` is the only path that discloses an answer**, and it first proves the problem appears in a set the caller owns. Problems are pooled across users, so checking the set id alone would leak arbitrary answer keys. Its `recall` action (replaying an outcome you already earned) additionally requires that an attempt exists, so it can't read an answer early.
- **A live retry offer and the answer key are mutually exclusive** — handing over the key beside a "Try again" button would turn the second attempt into a copying exercise.
- **Outcomes are written exclusively server-side.** Clients get read-only access to their own sets, items and attempts. That is what makes the derived progress, meters and stats trustworthy.
- **Targeted sets take a plan id and nothing else.** The topics, difficulty and above all the authoring *directives* are rebuilt server-side from the caller's own history, because `focus.directives` lands verbatim in a model prompt.
- **Uploaded material is bounded by a digest, not sanitized.** An upload is read once by a model told the input is data, into a closed-enum, short-capped structure; nothing else from the file reaches the authoring prompt. The student's accompanying note is interpreted at ingest and never passed through.
- **A share link grants a copy, not access.** Opening one shows sanitized problems and offers to mint a set you own; widening the ownership check to "or you know the code" would have been the smaller diff and the much larger attack surface.
- **Deleting a set relies on the `delete own sets` RLS policy** as the authorization check, so a forged id matches no rows. `problem_set_items` cascades; `attempts.set_id` is `ON DELETE SET NULL`, so practice history outlives the set it was earned in.
- **Guests are Supabase anonymous users**, carrying the `authenticated` role, so every `auth.uid()`-scoped policy covers them unchanged. Google sign-in uses `linkIdentity()`, preserving the user id and therefore the history.

Spend is bounded per account per day and again per network. The two layers fail in opposite directions on purpose — see [self-hosting](docs/self-hosting.md#rate-limiting).

> [!WARNING]
> A guest's identity lives only in their session cookie. Clearing it orphans their sets permanently — to test the signed-out state, fetch with `credentials: "omit"` instead.

## The offline seeding tool

`npm run seed` writes into a table every student reads, and runs an agent on the machine it is typed on. It adds no route, no RLS policy and no client code; it runs when you type it and never otherwise. The agent it spawns gets `Read`/`Write`/`Edit` and no shell, is started inside its own workspace directory, and inherits none of the run's credentials. Nothing it writes reaches the table without passing schema validation, the structural check, and a solve by a model that never saw the workspace. Details in [pool seeding](docs/pool-seeding.md).

## Headers

`next.config.ts` sets HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and `Permissions-Policy` for every response. The Content-Security-Policy is built per request in `src/proxy.ts` instead, because it carries a nonce: Next reads the nonce out of the request's CSP header and stamps it onto every script it emits, so `script-src` needs no `'unsafe-inline'`. The usual objection to nonces — that they force dynamic rendering — costs nothing here, since every page already sets `force-dynamic`.

`style-src` keeps `'unsafe-inline'` deliberately. A nonce there would *disable* it (CSP ignores `'unsafe-inline'` once a nonce is present), breaking progress meters and `next/font`, to defend against a far smaller risk than script injection.

## Accepted advisor findings

Two Supabase advisor items are expected here rather than bugs:

- **`rls_enabled_no_policy` on `problems` (INFO)** — deliberate. No policy means deny-all, which is what a table of answer keys should be.
- **`auth_allow_anonymous_sign_ins` (WARN)** — flagged because anonymous sign-ins are on, so `authenticated`-role policies also cover guests. That is the product requirement; every one of those policies is still scoped to `auth.uid()`.

Still open: leaked-password protection is off. It doesn't apply today (anonymous + Google only, no passwords), but turn it on before adding email/password sign-in.

## Privacy

`/privacy` and `/terms` describe what the app actually does, and are worth reading before deploying your own instance — particularly the note that content sent through the free tier of Google AI Studio may be reviewed by Google. That matters most for worksheet scans, which can carry a student's name and handwriting.

`/account` offers three levels of deletion, all immediate, with storage swept before the database cascade so no orphaned files survive.

The policy names four processors: Supabase, Vercel, Google and Cloudflare. Any new third party the app contacts has to be added there in the same change, or the policy becomes false.
