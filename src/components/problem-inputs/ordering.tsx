"use client";

import { useState } from "react";
import clsx from "clsx";
import { Check, ChevronDown, ChevronUp, X } from "lucide-react";
import { Prose } from "@/components/latex";

export type Step = { id: string; html: string };

/**
 * Put the steps in order.
 *
 * Reordering is by button and keyboard, not drag: HTML5 drag-and-drop does not
 * fire on touch at all, and a drag-only control is unusable from a keyboard or
 * a screen reader. Alt+Arrow moves the focused step, which is the convention
 * assistive-technology users already expect from a reorderable list.
 */
export function OrderingInput({
  steps,
  order,
  onReorder,
  disabled,
  graded,
}: {
  steps: Step[];
  /** Item ids in the student's current order. */
  order: string[];
  onReorder: (next: string[]) => void;
  disabled: boolean;
  /** Once graded, the ids in the correct order. */
  graded?: string[];
}) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  // Reordering rewrites the list in place, so without this a screen-reader user
  // gets no confirmation a move happened or where the step landed — the button
  // they are focused on just silently changes meaning.
  const [announcement, setAnnouncement] = useState("");

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    onReorder(next);
    setAnnouncement(`Step moved to position ${target + 1} of ${next.length}`);
  }

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    e.stopPropagation();
    move(index, e.key === "ArrowUp" ? -1 : 1);
  }

  return (
    <div className="mt-8">
      <p className="mono-meta mb-3">
        {/* The keyboard route is named only where there is a keyboard to name
            it to — on a phone "Alt + ↑ ↓" is instructions for a machine the
            reader isn't holding. */}
        Put the steps in order
        {!disabled && (
          <>
            {" — use the arrows"}
            <span className="pointer-coarse:hidden">, or Alt + ↑ ↓</span>
          </>
        )}
      </p>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <ol className="grid gap-2">
        {order.map((id, i) => {
          const step = byId.get(id);
          if (!step) return null;
          const rightHere = graded ? graded[i] === id : null;

          return (
            <li
              key={id}
              className={clsx(
                "flex items-center gap-3 rounded-sm border px-3 py-3 transition-colors",
                rightHere === true && "border-ok bg-ok-wash",
                rightHere === false && "border-bad bg-bad-wash",
                rightHere === null && "border-line bg-surface"
              )}
            >
              <span
                className={clsx(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] tabular-nums",
                  rightHere === true && "bg-ok text-paper",
                  rightHere === false && "bg-bad text-paper",
                  rightHere === null && "bg-sunk text-muted"
                )}
              >
                {i + 1}
              </span>

              <Prose html={step.html} className="min-w-0 flex-1 text-sm leading-relaxed" />

              {graded ? (
                <span
                  className={clsx(
                    "mono-meta flex shrink-0 items-center gap-1.5",
                    rightHere ? "text-ok" : "text-bad"
                  )}
                >
                  {rightHere ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                  ) : (
                    <X className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                  )}
                  {rightHere ? "In place" : "Out of place"}
                </span>
              ) : (
                /* Stacked they were two 20px targets touching each other,
                   which is the one arrangement where a bigger hit area makes
                   things worse — two 44px areas 20px apart overlap by more
                   than half, so a tap on "up" is as likely to be "down", and
                   getting it wrong moves the step the way you didn't want.
                   Side by side on touch, at 40px: under the guideline by
                   design, because unambiguous beats large. */
                <span className="flex shrink-0 flex-col pointer-coarse:flex-row pointer-coarse:gap-1.5">
                  <button
                    type="button"
                    disabled={disabled || i === 0}
                    onClick={() => move(i, -1)}
                    onKeyDown={(e) => onKeyDown(e, i)}
                    aria-label={`Move step ${i + 1} of ${order.length} up`}
                    className="grid place-items-center rounded-xs p-0.5 text-faint transition-colors hover:text-accent disabled:opacity-25 disabled:hover:text-faint pointer-coarse:h-10 pointer-coarse:w-10 pointer-coarse:border pointer-coarse:border-line"
                  >
                    <ChevronUp className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    disabled={disabled || i === order.length - 1}
                    onClick={() => move(i, 1)}
                    onKeyDown={(e) => onKeyDown(e, i)}
                    aria-label={`Move step ${i + 1} of ${order.length} down`}
                    className="grid place-items-center rounded-xs p-0.5 text-faint transition-colors hover:text-accent disabled:opacity-25 disabled:hover:text-faint pointer-coarse:h-10 pointer-coarse:w-10 pointer-coarse:border pointer-coarse:border-line"
                  >
                    <ChevronDown className="h-4 w-4" aria-hidden />
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The right sequence, shown after a wrong ordering. */
export function CorrectOrder({ steps, order }: { steps: Step[]; order: string[] }) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  return (
    <ol className="mt-3 grid gap-1.5">
      {order.map((id, i) => {
        const step = byId.get(id);
        if (!step) return null;
        return (
          <li key={id} className="flex items-baseline gap-3">
            <span className="mono-meta shrink-0 tabular-nums">{i + 1}</span>
            <Prose html={step.html} className="min-w-0 text-sm leading-relaxed text-muted" />
          </li>
        );
      })}
    </ol>
  );
}
