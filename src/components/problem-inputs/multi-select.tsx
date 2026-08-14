"use client";

import clsx from "clsx";
import { Check, Circle, X } from "lucide-react";
import { Math } from "@/components/latex";

export type Option = { id: string; html: string };

/**
 * Select all that apply.
 *
 * Deliberately not a `radiogroup`: with several correct answers, roving
 * tabindex would hide options from a keyboard user who has already chosen one.
 * Each option is its own toggle button, so Tab reaches every one of them and
 * `aria-pressed` carries the state — the same convention `.chip` uses, which is
 * also what the selected styling hangs off.
 */
export function MultiSelectInput({
  options,
  selected,
  onToggle,
  disabled,
  graded,
}: {
  options: Option[];
  selected: string[];
  onToggle: (id: string) => void;
  disabled: boolean;
  /** Once graded, the ids that were actually correct. */
  graded?: string[];
}) {
  const picked = new Set(selected);
  const truth = graded ? new Set(graded) : null;

  return (
    <div role="group" aria-label="Select every correct statement" className="mt-8 grid gap-2">
      <p className="mono-meta mb-1">Select all that apply</p>
      {options.map((o) => {
        const isPicked = picked.has(o.id);
        const isCorrect = truth?.has(o.id) ?? false;
        // Three graded states, each with a colour, an icon and a word.
        const state = !truth
          ? null
          : isCorrect && isPicked
            ? "got"
            : isCorrect && !isPicked
              ? "missed"
              : isPicked
                ? "wrong"
                : "left";

        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={isPicked}
            disabled={disabled}
            onClick={() => onToggle(o.id)}
            className={clsx(
              "option-row",
              state === "got" && "border-ok bg-ok-wash",
              state === "wrong" && "border-bad bg-bad-wash",
              state === "missed" && "border-ok border-dashed",
              state === "left" && "border-line opacity-45",
              !truth && isPicked && "border-accent bg-accent-wash",
              !truth && !isPicked && "border-line hover:border-accent-line hover:bg-surface"
            )}
          >
            <span
              className={clsx(
                "option-key",
                state === "got" && "border-ok bg-ok text-paper",
                state === "wrong" && "border-bad bg-bad text-paper",
                state === "missed" && "border-ok text-ok",
                !truth && isPicked && "border-accent bg-accent-solid text-accent-on",
                !truth && !isPicked && "border-line-strong text-muted",
                state === "left" && "border-line-strong text-muted"
              )}
            >
              {o.id}
            </span>
            <Math html={o.html} className="min-w-0 flex-1" />
            {state === "got" && (
              <span className="mono-meta flex shrink-0 items-center gap-1.5 text-ok">
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                Correct
              </span>
            )}
            {state === "wrong" && (
              <span className="mono-meta flex shrink-0 items-center gap-1.5 text-bad">
                <X className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                Not this one
              </span>
            )}
            {state === "missed" && (
              <span className="mono-meta flex shrink-0 items-center gap-1.5 text-ok">
                <Circle className="h-3 w-3" aria-hidden />
                Missed
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
