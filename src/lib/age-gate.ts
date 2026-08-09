"use client";

/**
 * The age declaration, taken once before an account is created.
 *
 * `/privacy` and `/terms` both state a minimum age — 13, or 16 in the EEA and
 * the UK — and until now nothing anywhere asked. That gap is the actual defect:
 * a policy that describes a check nobody performs is worse than having no
 * policy, because it reads as a control to everyone who relies on it.
 *
 * What this is *not* is verification. GDPR Art. 8(2) asks for reasonable
 * efforts proportionate to available technology, and for a maths practice tool
 * that collects no payment details and no contact details, a declaration is
 * what proportionate looks like. Demanding a document, or a parent's email,
 * would gather far more sensitive data about children than the rule is trying
 * to protect — from every user, to catch the few who would lie anyway.
 *
 * Built with DOM APIs rather than as a React component, for the same reason
 * `captcha.ts` is: this way it costs nothing to render, nothing to hydrate and
 * nothing in the bundle for the many visitors who never create an account, and
 * it can be awaited from `ensureUser()` like any other precondition.
 */

/** Bumped if the declaration itself ever changes, which invalidates old ones. */
const STORAGE_KEY = "lemma:age-affirmed:v1";

export const MIN_AGE = 13;
export const MIN_AGE_STRICT = 16;

/**
 * Raised when the visitor says no, or dismisses the dialog.
 *
 * Both call sites render `message` straight to the reader, so it names the rule
 * rather than the mechanism — "confirm your age to continue" tells someone who
 * has just honestly said they are twelve nothing they can act on.
 */
export class AgeGateDeclined extends Error {
  constructor() {
    super(
      `You need to be ${MIN_AGE} or older to use lemma — ${MIN_AGE_STRICT} or older in the EEA and the UK. Nothing was created.`
    );
    this.name = "AgeGateDeclined";
  }
}

/**
 * Whether a stored value counts as a declaration.
 *
 * Deliberately strict about what it accepts. `localStorage` is writable by
 * anything on the origin and survives across deploys, so this is asked to
 * distinguish a real record from leftovers and from garbage; anything it does
 * not recognise means "ask again", which is the safe direction.
 */
export function parseStoredAffirmation(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return false;
    const at = (parsed as { at?: unknown }).at;
    return typeof at === "string" && !Number.isNaN(Date.parse(at));
  } catch {
    return false;
  }
}

/** What gets written to the account record. `now` is a parameter so tests can pin it. */
export function affirmationRecord(now: Date = new Date()) {
  return {
    age_affirmed_at: now.toISOString(),
    age_minimum_declared: MIN_AGE,
  };
}

export function hasAffirmedAge(): boolean {
  try {
    return parseStoredAffirmation(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // Private mode and blocked-storage settings both throw here. Falling back
    // to "not yet" means the dialog shows again next visit, which is a small
    // annoyance; treating it as affirmed would skip the check entirely.
    return false;
  }
}

function rememberAffirmation(at: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ at }));
  } catch {
    // Not being able to remember is survivable — the durable record is the one
    // written to the account in `auth.ts`. This only saves asking twice.
  }
}

/**
 * Resolve once the visitor has declared they meet the minimum age.
 *
 * Throws `AgeGateDeclined` if they say no or dismiss it, which aborts the
 * sign-in it was called from — nothing is created, and no request has been made
 * to Cloudflare or Supabase by that point.
 */
export async function confirmAge(): Promise<void> {
  if (hasAffirmedAge()) return;

  const restoreFocusTo = document.activeElement as HTMLElement | null;
  const host = document.createElement("div");
  host.className = "age-gate";

  const titleId = "age-gate-title";
  const bodyId = "age-gate-body";
  const panel = document.createElement("div");
  panel.className = "age-gate-panel panel-raised";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", titleId);
  panel.setAttribute("aria-describedby", bodyId);

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Before you start";

  const title = document.createElement("h2");
  title.id = titleId;
  title.className = "age-gate-title";
  title.textContent = "How old are you?";

  const body = document.createElement("p");
  body.id = bodyId;
  body.className = "age-gate-body";
  body.textContent = `lemma is for students aged ${MIN_AGE} and over — ${MIN_AGE_STRICT} and over in the EEA and the UK. Confirming also accepts the terms and the privacy policy.`;

  const links = document.createElement("p");
  links.className = "age-gate-links";
  for (const [href, label] of [
    ["/terms", "Terms"],
    ["/privacy", "Privacy"],
  ] as const) {
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    // Opening in a new tab must not hand the opener over with it.
    link.rel = "noopener noreferrer";
    link.textContent = label;
    links.append(link);
  }

  const actions = document.createElement("div");
  actions.className = "age-gate-actions";

  const decline = document.createElement("button");
  decline.type = "button";
  decline.className = "btn btn-ghost";
  decline.textContent = "No, I'm younger";

  const accept = document.createElement("button");
  accept.type = "button";
  accept.className = "btn btn-accent";
  // The button *is* the declaration, so it says what it is agreeing to. A
  // generic "Continue" next to a checkbox records the same click while making
  // it easy to press without reading what it meant.
  accept.textContent = `I'm ${MIN_AGE} or older`;

  actions.append(decline, accept);
  panel.append(eyebrow, title, body, links, actions);
  host.append(panel);
  document.body.append(host);

  return new Promise<void>((resolve, reject) => {
    const teardown = () => {
      document.removeEventListener("keydown", onKeydown, true);
      host.remove();
      restoreFocusTo?.focus?.();
    };

    /**
     * Escape declines rather than dismissing. There is no third outcome here:
     * the caller is about to create an account and needs a yes or a no, so a
     * silent close would have to be read as one of them anyway.
     */
    function onKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        teardown();
        reject(new AgeGateDeclined());
        return;
      }
      if (event.key !== "Tab") return;
      // Keep focus inside the dialog — without this, Tab walks into the page
      // behind it, which for a screen-reader user makes a modal question look
      // like it has been answered and moved past.
      const focusable = [decline, accept];
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (!focusable.includes(active as HTMLButtonElement)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeydown, true);

    accept.addEventListener("click", () => {
      rememberAffirmation(new Date().toISOString());
      teardown();
      resolve();
    });

    decline.addEventListener("click", () => {
      teardown();
      reject(new AgeGateDeclined());
    });

    accept.focus();
  });
}
