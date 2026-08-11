"use client";

import { flushSync } from "react-dom";

/**
 * The characters a phone keyboard buries, next to the field that needs them.
 *
 * The card asks students to "type math plainly — fractions as 3/4, roots as
 * sqrt(2), powers as x^2", and on iOS every one of `/ ^ ( )` is two taps into
 * the symbol plane and back. That is three or four extra gestures per answer
 * on the app's highest-frequency action.
 *
 * The label is the glyph and the payload is ASCII, and that asymmetry is the
 * whole point: `normalizeMath` in `answers.ts` canonicalises to `sqrt(`,
 * `pi`, `+-`, `<=`, so those are what get typed. A key that inserted √ or ≤
 * would look right and grade wrong. The student sees exactly what will be
 * compared, which is also the more honest thing to show them.
 *
 * Shown only where the pointer is coarse — on a desktop keyboard these
 * characters are already one keystroke, and a row of buttons would be noise.
 */

type Key = {
  /** What the reader sees. */
  label: string;
  /** What is typed. */
  text: string;
  /** How far back from the end of `text` to leave the caret. */
  back?: number;
  /** Spoken name, where the glyph alone would not be read usefully. */
  name?: string;
};

const KEYS: Key[] = [
  { label: "/", text: "/", name: "divided by" },
  { label: "^", text: "^", name: "to the power of" },
  { label: "()", text: "()", back: 1, name: "brackets" },
  { label: "√", text: "sqrt()", back: 1, name: "square root" },
  { label: "π", text: "pi", name: "pi" },
  { label: "×", text: "*", name: "times" },
  { label: "±", text: "+-", name: "plus or minus" },
  { label: "≤", text: "<=", name: "less than or equal to" },
  { label: "≥", text: ">=", name: "greater than or equal to" },
  { label: "∞", text: "inf", name: "infinity" },
];

export function MathKeys({
  value,
  onChange,
  getInput,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  /** The field being typed into. A getter, so one shape serves a single ref
   *  and a per-item map alike. */
  getInput: () => HTMLInputElement | null;
  disabled: boolean;
}) {
  if (disabled) return null;

  function insert(key: Key) {
    const el = getInput();
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? start;
    const next = value.slice(0, start) + key.text + value.slice(end);
    const caret = start + key.text.length - (key.back ?? 0);
    // `flushSync` so the caret can be placed in the same tick. The selection has
    // to be set *after* React writes the value — set earlier it lands on the old
    // string and gets clamped — and the obvious way to wait, a
    // requestAnimationFrame, does not fire at all while the tab is in the
    // background. That failure is silent and leaves the caret past the closing
    // bracket rather than between the two, which is the one thing this control
    // exists to get right.
    flushSync(() => onChange(next));
    if (document.activeElement !== el) el.focus();
    el.setSelectionRange(caret, caret);
  }

  return (
    <div
      role="group"
      aria-label="Insert a symbol"
      className="-mx-6 mt-2.5 hidden gap-1.5 overflow-x-auto px-6 pb-1 [scrollbar-width:none] pointer-coarse:flex sm:mx-0 sm:px-0"
    >
      {KEYS.map((k) => (
        <button
          key={k.text}
          type="button"
          aria-label={k.name ?? k.label}
          // Keeps focus and the selection on the field. Without it the field
          // blurs on press, the keyboard closes, and `selectionStart` — which
          // is the whole basis of inserting at the caret — is already gone by
          // the time the click lands.
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => insert(k)}
          className="chip h-10 w-11 shrink-0 justify-center px-0 font-mono text-[15px]"
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}
