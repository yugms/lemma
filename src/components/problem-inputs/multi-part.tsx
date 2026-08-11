"use client";

import { useRef } from "react";
import { CornerDownLeft } from "lucide-react";
import { Math, Prose } from "@/components/latex";
import { MATH_INPUT_PROPS } from "@/components/problem-inputs/math-input-props";
import { MathKeys } from "@/components/problem-inputs/math-keys";

export type ProblemPart = { label: string; prompt_html: string };

/**
 * A problem in labelled parts, each with its own typed answer.
 *
 * Graded all-or-nothing by the server, so this deliberately shows no per-part
 * tick: marking (a) correct while the whole problem scored zero would state two
 * different things about one outcome. Once answered it puts the real answer
 * beside each part instead, which is what a student compares against — and the
 * authored feedback names whichever part actually broke the chain.
 */
export function MultiPartInput({
  parts,
  values,
  onChange,
  disabled,
  answers,
}: {
  parts: ProblemPart[];
  /** `{ label: typed }` — the same shape submitted to /api/check. */
  values: Record<string, string>;
  onChange: (label: string, value: string) => void;
  disabled: boolean;
  /** Once graded, the correct answer for each part. */
  answers?: { label: string; html: string }[];
}) {
  const key = answers ? new Map(answers.map((a) => [a.label, a.html])) : null;
  // One entry per part, so each part's symbol row types into its own field.
  const inputs = useRef(new Map<string, HTMLInputElement>());

  return (
    <ol className="mt-8 space-y-6">
      {parts.map((part) => {
        const typed = values[part.label] ?? "";
        const correct = key?.get(part.label);

        return (
          <li key={part.label} className="flex gap-4">
            <span className="mono-meta mt-2.5 w-6 shrink-0">({part.label})</span>
            <div className="min-w-0 flex-1">
              <Prose html={part.prompt_html} className="text-[15px] leading-7" />
              <div className="relative mt-3">
                <input
                  {...MATH_INPUT_PROPS}
                  ref={(el) => {
                    if (el) inputs.current.set(part.label, el);
                    else inputs.current.delete(part.label);
                  }}
                  value={typed}
                  disabled={disabled}
                  onChange={(e) => onChange(part.label, e.target.value)}
                  aria-label={`Your answer to part ${part.label}`}
                  className="field pr-11 font-mono"
                />
                {typed.trim().length > 0 && !key && (
                  <CornerDownLeft
                    aria-hidden
                    className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
                  />
                )}
              </div>
              <MathKeys
                value={typed}
                onChange={(next) => onChange(part.label, next)}
                getInput={() => inputs.current.get(part.label) ?? null}
                disabled={disabled}
              />
              {correct && (
                <p className="mono-meta mt-2 flex flex-wrap items-center gap-x-2">
                  <span>Answer</span>
                  <Math html={correct} className="text-fg" />
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
