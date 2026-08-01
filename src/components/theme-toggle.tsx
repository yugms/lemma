"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

export const THEME_KEY = "lemma-theme";

/**
 * Runs before first paint so the stored theme is applied without a flash.
 * Kept in sync with `read()` below.
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

type Choice = "system" | "light" | "dark";

const OPTIONS: { id: Choice; label: string; Icon: typeof Sun }[] = [
  { id: "system", label: "System", Icon: Monitor },
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
];

/* ── Theme store ────────────────────────────────────────────────────
   localStorage is external state, so it is read through
   useSyncExternalStore rather than mirrored into an effect — that keeps
   the server render ("system") and the client render consistent.
   ─────────────────────────────────────────────────────────────────── */

let listeners: (() => void)[] = [];

function subscribe(onChange: () => void) {
  listeners.push(onChange);
  return () => {
    listeners = listeners.filter((l) => l !== onChange);
  };
}

function read(): Choice {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

/** No storage on the server, and none during the first client render. */
function readServer(): Choice {
  return "system";
}

function apply(choice: Choice) {
  const root = document.documentElement;
  try {
    if (choice === "system") {
      delete root.dataset.theme;
      localStorage.removeItem(THEME_KEY);
    } else {
      root.dataset.theme = choice;
      localStorage.setItem(THEME_KEY, choice);
    }
  } catch {
    // Private-mode storage failures shouldn't break the toggle itself.
    if (choice === "system") delete root.dataset.theme;
    else root.dataset.theme = choice;
  }
  listeners.forEach((l) => l());
}

/** Marks the document so the circular-wipe rules in globals.css apply. */
function beginWipe(origin: DOMRect) {
  const root = document.documentElement;
  root.style.setProperty("--theme-x", `${origin.left + origin.width / 2}px`);
  root.style.setProperty("--theme-y", `${origin.top + origin.height / 2}px`);
  root.dataset.themeSwitching = "";
}

function endWipe() {
  delete document.documentElement.dataset.themeSwitching;
}

function change(next: Choice, origin: HTMLElement) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || !document.startViewTransition) {
    apply(next);
    return;
  }
  // The wipe expands from the button that was pressed, so the change reads
  // as originating from the reader's own gesture.
  beginWipe(origin.getBoundingClientRect());
  document.startViewTransition(() => apply(next)).finished.finally(endWipe);
}

export function ThemeToggle() {
  const choice = useSyncExternalStore(subscribe, read, readServer);

  return (
    <div
      role="group"
      aria-label="Colour theme"
      className="flex items-center gap-px rounded-[3px] border border-line bg-sunk p-px"
    >
      {OPTIONS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={id === choice}
          aria-label={label}
          title={`${label} theme`}
          onClick={(e) => id !== choice && change(id, e.currentTarget)}
          className="flex h-7 w-7 items-center justify-center rounded-[2px] text-faint transition-colors hover:text-fg aria-pressed:bg-surface aria-pressed:text-accent aria-pressed:shadow-[0_1px_2px_rgb(var(--shadow-color)/0.06)]"
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      ))}
    </div>
  );
}
