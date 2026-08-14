"use client";

import clsx from "clsx";

export type RailStop = {
  key: string;
  /** Colour utility for this stop's dash. */
  tone: string;
  /** How this stop reads to a screen reader — "correct", "unanswered". */
  state: string;
};

/**
 * Where you are in a set, and every other problem you could jump to.
 *
 * Practice and quiz carry the same rail with different tones over it, so the
 * geometry lives here and the meaning stays with the caller.
 *
 * A set runs to `MAX_SET_COUNT` problems, which at a fixed `w-5 shrink-0`
 * needed ~371px of un-shrinkable rail beside a title in a 335px box. It
 * scrolls instead, and the pitch is 24px so adjacent targets are tangent
 * rather than overlapping — the `sm:w-6` is deliberately that way round, since
 * the wider screen is the one with room for wider dots.
 */
export function ProblemRail({
  noun,
  stops,
  current,
  onGo,
}: {
  /** "Problem" or "Question" — the rail's own label is its plural. */
  noun: string;
  stops: RailStop[];
  current: number;
  onGo: (index: number) => void;
}) {
  return (
    <nav
      aria-label={`${noun}s`}
      className="-mr-5 flex max-w-[55%] shrink-0 gap-1 overflow-x-auto pr-5 [scrollbar-width:none] sm:mr-0 sm:max-w-none sm:overflow-visible sm:pr-0"
    >
      {stops.map((stop, i) => (
        <button
          key={stop.key}
          type="button"
          onClick={() => onGo(i)}
          aria-current={i === current ? "step" : undefined}
          aria-label={`${noun} ${i + 1}, ${stop.state}`}
          className="group -my-2 shrink-0 px-1 py-3"
        >
          <span
            className={clsx(
              "block h-[3px] w-4 rounded-full transition-all duration-300 group-hover:h-[5px] sm:w-6",
              stop.tone,
              i === current && "h-[5px]"
            )}
          />
        </button>
      ))}
    </nav>
  );
}
