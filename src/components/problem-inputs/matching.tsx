"use client";

import clsx from "clsx";
import { Check, X } from "lucide-react";
import { Math } from "@/components/latex";

export type MatchOption = { id: string; html: string };

/**
 * Pair each left prompt with one right candidate.
 *
 * A native `<select>` per row rather than drag-and-drop: dragging is the
 * obvious visual metaphor and the wrong control here. It is unusable by
 * keyboard without a parallel implementation, awkward on a phone — which is
 * where a lot of practice happens — and it buys nothing, because the answer is
 * a mapping, not an arrangement. The select also lets one right entry be picked
 * twice, which is a real student error worth surfacing rather than preventing.
 */
export function MatchingInput({
  left,
  right,
  value,
  onChange,
  disabled,
  graded,
}: {
  left: MatchOption[];
  right: MatchOption[];
  /** `{ leftId: rightId }` — the same shape submitted to /api/check. */
  value: Record<string, string>;
  onChange: (leftId: string, rightId: string) => void;
  disabled: boolean;
  /** Once graded, the correct pairing. */
  graded?: { left_id: string; right_id: string }[];
}) {
  const truth = graded ? new Map(graded.map((p) => [p.left_id, p.right_id])) : null;
  const rightLabel = new Map(right.map((r) => [r.id, r.html]));

  return (
    <div className="mt-8 space-y-6">
      <div>
        <p className="mono-meta mb-3">Match each one</p>
        <ul className="space-y-2">
          {left.map((l) => {
            const picked = value[l.id] ?? "";
            const answer = truth?.get(l.id);
            const isRight = truth ? picked === answer : null;

            return (
              <li
                key={l.id}
                className={clsx(
                  "flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[3px] border px-4 py-3.5 transition-colors",
                  isRight === true && "border-ok bg-ok-wash",
                  isRight === false && "border-bad bg-bad-wash",
                  isRight === null && "border-line"
                )}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[2px] border border-line-strong font-mono text-[11px] text-muted">
                  {l.id}
                </span>
                <Math html={l.html} className="min-w-0 flex-1" />

                <label className="sr-only" htmlFor={`match-${l.id}`}>
                  Match for {l.id}
                </label>
                <select
                  id={`match-${l.id}`}
                  className="field w-28 shrink-0"
                  value={picked}
                  disabled={disabled}
                  onChange={(e) => onChange(l.id, e.target.value)}
                >
                  <option value="">—</option>
                  {right.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.id}
                    </option>
                  ))}
                </select>

                {/* Never colour alone — icon and word carry it too. */}
                {isRight === true && (
                  <span className="mono-meta flex shrink-0 items-center gap-1.5 text-ok">
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                    Correct
                  </span>
                )}
                {isRight === false && (
                  <span className="mono-meta flex shrink-0 items-center gap-1.5 text-bad">
                    <X className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                    {answer ? `Should be ${answer}` : "Wrong"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* The right column is reference material, not a control — the selects
          above are what gets answered, so this is a plain labelled list. */}
      <div>
        <p className="mono-meta mb-3">Choose from</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {right.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-[3px] border border-line px-3 py-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[2px] border border-line-strong font-mono text-[11px] text-muted">
                {r.id}
              </span>
              <Math html={rightLabel.get(r.id) ?? ""} className="min-w-0 flex-1" />
            </li>
          ))}
        </ul>
        <p className="mono-meta mt-3">
          More options than prompts — some match nothing.
        </p>
      </div>
    </div>
  );
}
