# Self-hosting

Everything needed to run your own instance. See the [README](../README.md) for what lemma is.

## Prerequisites

- Node.js 20.9+ (what Next 16 requires; CI runs 22)
- A [Supabase](https://supabase.com) project (free tier)
- A [Google AI Studio](https://aistudio.google.com/apikey) API key (free, no card)

## Install

```bash
git clone <your-fork-url> lemma
cd lemma
npm install
cp .env.example .env.local   # then fill it in — see below
npm run dev
```

## Configure Supabase

Three settings, none of which live in this repo, and all three are needed for sign-in to work:

1. **Authentication → Sign In / Providers → "Anonymous sign-ins"**. Required — guest mode is the default path through the app.
2. **Authentication → Sign In / Providers → "Allow manual linking"**. Also required, and **off by default**. `linkIdentity()` is what upgrades a guest to a Google account without changing their user id; without this every guest sign-in fails with `404 manual_linking_disabled`.
3. **The Google provider**, with a client ID and secret from Google Cloud Console. The OAuth client's redirect URI must point at `https://<project>.supabase.co/auth/v1/callback` — Supabase, *not* your app. With the provider off you get `400 validation_failed / "provider is not enabled"`.

Then add your deployed origin under **Authentication → URL Configuration** (Site URL and Redirect URLs), since sign-in derives its redirect from `window.location.origin`.

> [!TIP]
> None of this is visible from the code, so when sign-in fails, read `error_code` in the Supabase auth logs first. `src/lib/auth-errors.ts` maps those codes to the copy shown on `/signin`, and the callback forwards the real code rather than a generic flag precisely so the page can name the cause.

> [!IMPORTANT]
> There is no local database and no SQL in this repo. The schema lives in the Supabase project's migration history — run `list_migrations` through the Supabase MCP server configured in `.mcp.json` to see it, and `apply_migration` to change it. An enumeration here would go stale the first time a migration was applied, which is exactly what happened to the one this replaced.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Same page. The current key format — the legacy `anon` JWT is deprecated |
| `SUPABASE_SECRET_KEY` | yes | "Secret keys" → create one. **Server-only, bypasses RLS** |
| `GEMINI_API_KEY` | yes | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `NEXT_PUBLIC_SITE_URL` | no | The canonical origin: metadata base, Open Graph and canonical URLs, and the host in `robots.txt` / `sitemap.xml`. See the resolution order below. Auth does **not** use it; sign-in derives its redirect from `window.location.origin` |
| `GEMINI_GENERATOR_MODELS` | no | `gemini-3.5-flash,gemini-3.6-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite` |
| `GEMINI_CHECKER_MODELS` | no | `gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-lite-latest` |
| `GEMINI_CONCURRENCY` | no | `6` — the whole build's budget against free-tier limits of around 10 RPM, shared by authoring and verification |
| `GEMINI_PROBLEMS_PER_CALL` | no | `6` — problems per authoring call. A request-count dial, not a latency one |
| `GEMINI_SOLVES_PER_CALL` | no | `5` — problems per verification call. Deliberately smaller: a long shared context is where a solver starts pattern-matching between problems instead of solving each |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | no | Cloudflare Turnstile site key. Unset, the guest-sign-up check is off entirely and nothing is loaded. Must be set **before** enabling CAPTCHA in Supabase — see below |

The two model variables are comma-separated **preference-ordered chains**: later entries are tried only when earlier ones are rate-limited or overloaded, because free-tier Flash models return 503 in bursts. The strong models lead and the lites catch what falls through — which only works if the tail is alive, and once wasn't: `gemini-2.5-flash` sat at the end of both chains and had started answering 404, so the fallback that was supposed to absorb a rate-limited flash absorbed nothing.

> [!TIP]
> Only Flash and Flash-Lite tiers are free. Pointing these at a Pro model works, but stops being free.

### How the canonical origin is resolved

`siteUrl()` tries these in order, and the first branch is the one that matters:

1. `VERCEL_ENV === "preview"` with `VERCEL_URL` — **a preview describes itself, ahead of anything configured.** `NEXT_PUBLIC_SITE_URL` is set once per Vercel project and applies to every environment, so with it checked first every preview deployment answered with the production origin: a `robots.txt` pointing at the real sitemap, canonicals claiming the real pages, and a link to a preview unfurling as the live site.
2. `NEXT_PUBLIC_SITE_URL`
3. `VERCEL_PROJECT_PRODUCTION_URL` — the project's production domain
4. `VERCEL_URL` — this specific deployment
5. `http://localhost:3000`, with a warning

So a Vercel deploy is correct with nothing configured. It warns rather than throwing on the last step, because throwing would fail a plain `npm run build` on a developer's machine — but **nothing in that chain may ever produce a host the deployment does not serve**, which is what the hardcoded fallback it replaced did.

## Guest sign-up protection

Anyone can create a guest account here without an email address, which is the point — and also means a script could create them in bulk, each with a fresh daily allowance. `src/lib/captcha.ts` runs a Cloudflare Turnstile check once, at the moment a guest session is first created, and never again.

It is **off unless `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set**: with no key nothing loads, Cloudflare is never contacted, and guest sign-in behaves exactly as it did before. Turning it on is two switches that must move together:

1. Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (site key from the Cloudflare dashboard, free) and deploy.
2. **Authentication → Attack Protection** in Supabase: enable Turnstile and paste the matching secret.

> [!WARNING]
> Doing (2) without (1) breaks **every** guest session, which is the default path through the whole app. Always set the key and deploy first. The reverse order is harmless — a token is simply ignored until Supabase is checking for one.

If you run an instance **without** Turnstile configured, the Cloudflare paragraph in `src/app/privacy/page.tsx` describes something that never happens and should be removed.

## Rate limiting

Per-account daily caps are listed in the [README](../README.md#daily-limits). There is a second layer, per network.

Anonymous sessions are issued by Supabase straight to the browser, so a per-account cap only bounds casual overuse — someone minting fresh guest accounts gets a fresh allowance each time. `IP_LIMITS` in `src/lib/limits.ts` adds a burst window and a daily ceiling per address, checked through the `rate_check` RPC against a `rate_events` table. The address comes from `x-vercel-forwarded-for` in preference to `x-forwarded-for`, since only the former is stamped at the edge and cannot be chosen by the caller, and it is stored as a salted hash rather than an address.

The two layers fail in opposite directions, deliberately. A per-account cap that cannot read its own count **refuses**, because it is the only thing between one account and unbounded model spend. The per-network check **allows**, because it sits behind a bound that is already working, and refusing would make every set in the app depend on one more table being healthy.

> [!NOTE]
> Those numbers err generous. A classroom or library behind one address looks exactly like a script, and a false positive there reads to a student as the site being broken — so every refusal is logged, and the daily figures are the place to tune.
