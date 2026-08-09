"use client";

import { turnstileSiteKey } from "@/lib/env";

/**
 * Cloudflare Turnstile, solved on demand.
 *
 * Anonymous sign-ins are issued by Supabase straight to the browser, so no
 * per-user cap in this codebase can see them — a script can mint guest accounts
 * in a loop and each one gets a fresh daily allowance. Supabase's own IP rate
 * limit slows that down; a CAPTCHA is what actually stops it, and their docs
 * recommend one specifically because anonymous users are rows in your database.
 *
 * **Do not mistake this for the boundary.** Everything below runs in the
 * browser, and the token is verified by Supabase, not by this app — so it only
 * binds callers who come through this code. A script calling
 * `signInAnonymously` against the public key never loads any of it, and the one
 * thing that stops *that* is Turnstile being switched on in the Supabase
 * dashboard, which is not in this repo and cannot be asserted from here. What
 * bounds the damage either way is `IP_LIMITS` in `limits.ts`, which sits on the
 * routes that actually spend money and does not care how the caller signed in.
 *
 * Three properties this is built around:
 *
 * 1. **Off unless configured.** With no site key nothing is loaded, nothing is
 *    sent to Cloudflare, and `solveCaptcha` returns null immediately. Shipping
 *    this code changes nothing until the key is set.
 * 2. **Once per browser.** It runs only where a brand-new guest is created, not
 *    on every action — see `ensureUser`.
 * 3. **Invisible unless it isn't.** `interaction-only` shows nothing for an
 *    ordinary visitor. If Turnstile does want a click, the widget has to be
 *    visible and reachable, which is why this appends a real overlay rather
 *    than rendering into a hidden container — a hidden challenge is a dead end
 *    the student cannot get out of.
 */

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * Long enough to cover a slow network and a human clicking a checkbox, short
 * enough that a wedged widget doesn't leave a button spinning forever.
 */
const SOLVE_TIMEOUT_MS = 45_000;

type TurnstileOptions = {
  sitekey: string;
  action: string;
  callback: (token: string) => void;
  "error-callback": (code?: string) => void;
  "timeout-callback": () => void;
  "before-interactive-callback": () => void;
  "after-interactive-callback": () => void;
  appearance: "always" | "execute" | "interaction-only";
  theme: "auto" | "light" | "dark";
  retry: "auto" | "never";
};

/**
 * Errors no amount of retrying will fix — a wrong sitekey, a domain not on the
 * widget's allowlist, a device clock too far out. Everything else Cloudflare
 * reports, including the `110600`/`110620` timeouts that share a prefix with
 * these, is transient and worth another attempt.
 *
 * https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/
 */
const UNRECOVERABLE_ERROR_CODES = new Set([
  "110100", // invalid sitekey
  "110110", // unknown sitekey
  "110200", // domain not allowed
  "200100", // clock or cache mismatch
  "400020", // sitekey problem
  "400070", // sitekey problem
]);

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: TurnstileOptions) => string;
      remove: (id: string) => void;
    };
  }
}

/** Raised when the check is configured but could not be completed. */
export class CaptchaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptchaError";
  }
}

let scriptPromise: Promise<void> | null = null;

/**
 * Injected from application code rather than sitting in the document head.
 *
 * That is deliberate on two counts: it keeps Cloudflare uncontacted for anyone
 * who never creates a guest session, and under the CSP's `strict-dynamic` a
 * script inserted by an already-trusted script inherits that trust — so this
 * needs no host allowance in `script-src` for modern browsers. The host is
 * listed there anyway, for older ones that ignore `strict-dynamic`.
 */
function loadTurnstile(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Let a later attempt retry rather than caching the failure forever.
      scriptPromise = null;
      reject(new CaptchaError("The anti-abuse check couldn't load."));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/**
 * A token for `signInAnonymously`, or `null` when Turnstile is not configured.
 *
 * Throws `CaptchaError` when it *is* configured and the check could not be
 * completed. Returning null there would send an unauthenticated request that
 * Supabase rejects with `captcha_failed`, and the student would be shown a
 * message about server configuration for what is usually an ad blocker.
 */
export async function solveCaptcha(): Promise<string | null> {
  const sitekey = turnstileSiteKey();
  if (!sitekey) return null;

  await loadTurnstile();
  const turnstile = window.turnstile;
  if (!turnstile) throw new CaptchaError("The anti-abuse check couldn't start.");

  const host = document.createElement("div");
  host.className = "captcha-host";
  // Announced, because for a keyboard or screen-reader user a challenge
  // appearing silently mid-action is indistinguishable from the app hanging.
  host.setAttribute("role", "group");
  host.setAttribute("aria-label", "Anti-abuse check");
  document.body.appendChild(host);

  let widgetId: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const teardown = () => {
    if (timer) clearTimeout(timer);
    if (widgetId) {
      try {
        turnstile.remove(widgetId);
      } catch {
        // Already gone; the element removal below is what actually matters.
      }
    }
    host.remove();
  };

  return new Promise<string>((resolve, reject) => {
    const succeed = (token: string) => {
      teardown();
      resolve(token);
    };
    const fail = (message: string) => {
      teardown();
      reject(new CaptchaError(message));
    };

    timer = setTimeout(() => fail("The anti-abuse check timed out."), SOLVE_TIMEOUT_MS);

    try {
      widgetId = turnstile.render(host, {
        sitekey,
        // Labels the challenge in Cloudflare's own analytics. There is exactly
        // one surface here, so it buys little locally; it is the marker
        // Cloudflare's setup guide asks integrations to send.
        action: "turnstile-spin-v2",
        appearance: "interaction-only",
        theme: "auto",
        // Cloudflare's default, restated because it is load-bearing here and
        // silently reversible: the widget re-attempts every 8s on its own, and
        // the error handling below is written around that rather than against
        // it. Setting this to "never" would make a single blip fatal again.
        retry: "auto",
        callback: succeed,
        /**
         * Transient errors deliberately do *not* fail here.
         *
         * This used to reject on the first error, which tore the widget down —
         * and since teardown removes the widget, it also cancelled the retry
         * Cloudflare was about to make. One dropped packet on a phone was
         * enough to kill the student's whole action, which is the "fails
         * occasionally" this check was reported for. Leaving the widget alive
         * lets it retry roughly five times inside the timeout below, which is
         * the real backstop.
         */
        "error-callback": (code) => {
          if (code && UNRECOVERABLE_ERROR_CODES.has(code)) {
            fail(
              `The anti-abuse check isn't set up correctly for this site, so a guest session couldn't be started. (If you run this project: error ${code} means NEXT_PUBLIC_TURNSTILE_SITE_KEY is wrong, or this domain is not on the widget's allowlist in Cloudflare.)`
            );
            return;
          }
          console.warn(`[lemma] Turnstile error ${code ?? "(no code)"}; letting the widget retry.`);
        },
        "timeout-callback": () => fail("The anti-abuse check timed out."),
        // Only dim the page once there is actually something to interact with.
        "before-interactive-callback": () => host.setAttribute("data-interactive", "true"),
        "after-interactive-callback": () => host.removeAttribute("data-interactive"),
      });
    } catch {
      fail("The anti-abuse check couldn't start.");
    }
  });
}
