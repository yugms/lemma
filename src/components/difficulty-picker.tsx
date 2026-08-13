"use client";

import { DIFFICULTY_LABELS } from "@/lib/format";

/**
 * The 1–5 level control, shared by the builder form and the material review.
 *
 * The two are deliberately the same control because they send the same field
 * to the same route; they differ only in what they say about the number they
 * land on, which is why the caption is the caller's.
 */
export function DifficultyPicker({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (level: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {[1, 2, 3, 4, 5].map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={d === value}
          aria-label={`Level ${d} — ${DIFFICULTY_LABELS[d]}`}
          disabled={disabled}
          onClick={() => onChange(d)}
          // Fixed square, so the coarse `.chip` padding would fight it.
          className="chip h-9 w-9 justify-center px-0 font-mono pointer-coarse:h-11 pointer-coarse:w-11"
        >
          {d}
        </button>
      ))}
    </div>
  );
}
