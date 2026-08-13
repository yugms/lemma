"use client";

import clsx from "clsx";
import { Check, HelpCircle, Loader2, Minus, X } from "lucide-react";
import { wasAttempted } from "@/lib/scan-marks";
import type { ScanMark } from "@/lib/ai/grade-scan";
import type { WorksheetGrading } from "@/lib/worksheets";

/**
 * What came back off the page.
 *
 * The confirmation panel is the whole reason this is interactive: a reading
 * the model was not sure of is *not* on the student's record yet, and saying
 * so — with the button that puts it there — is what keeps a confident misread
 * from becoming permanent wrong history.
 */
export function ScanResults({
  grading,
  confirming,
  onConfirm,
}: {
  grading: WorksheetGrading;
  confirming: boolean;
  onConfirm: (positions: number[]) => void;
}) {
  const marks = grading.marks ?? [];
  const pending = new Set(grading.needs_confirmation ?? []);
  // Scored out of what was actually attempted. Counting blanks against the
  // student would report "3/6" for a page they only got three-quarters through.
  const answered = marks.filter(wasAttempted);
  const right = answered.filter((m) => m.correct).length;

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
        <h2 className="eyebrow">Marked</h2>
        <p className="mono-meta">
          {right}/{answered.length} correct
          {marks.length > answered.length &&
            ` · ${marks.length - answered.length} not attempted`}
          {grading.recorded.length > 0 && ` · ${grading.recorded.length} recorded`}
        </p>
      </div>

      {grading.page_note && (
        <p className="aside-rule mt-5 border-line-strong py-1 text-sm leading-relaxed text-muted">
          {grading.page_note}
        </p>
      )}

      {pending.size > 0 && (
        <div className="panel mt-6 px-5 py-5">
          <p className="flex items-center gap-2 text-sm font-medium">
            <HelpCircle className="h-4 w-4 shrink-0 text-muted" aria-hidden />
            Check these readings first
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The handwriting here was hard to make out. Nothing below is on your record
            yet — confirm the reading is right and it counts, or leave it and it
            won&apos;t.
          </p>
          <button
            type="button"
            disabled={confirming}
            onClick={() => onConfirm([...pending])}
            className="btn btn-outline btn-sm mt-5"
          >
            {confirming && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
            Yes, that&apos;s what I wrote
          </button>
        </div>
      )}

      <ul className="mt-6 space-y-5">
        {marks.map((m) => (
          <MarkRow key={m.problem_number} mark={m} pending={pending.has(m.problem_number)} />
        ))}
      </ul>
    </section>
  );
}

function MarkRow({ mark, pending }: { mark: ScanMark; pending: boolean }) {
  // Three outcomes, not two: correct, incorrect, and never answered. The third
  // is deliberately not styled as a miss — the student didn't get it wrong.
  const attempted = wasAttempted(mark);

  return (
    <li className="flex gap-4">
      <span
        aria-hidden
        className={clsx(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
          !attempted && "bg-sunk text-faint",
          attempted && mark.correct && "bg-ok-wash text-ok",
          attempted && !mark.correct && "bg-bad-wash text-bad"
        )}
      >
        {!attempted ? (
          <Minus className="h-3 w-3" aria-hidden />
        ) : mark.correct ? (
          <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
        ) : (
          <X className="h-3 w-3" strokeWidth={3} aria-hidden />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="mono-meta flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>problem {mark.problem_number}</span>
          {/* Never colour alone — the word carries it with the icon. */}
          {!attempted ? (
            <span>not answered · not recorded</span>
          ) : (
            <span className={mark.correct ? "text-ok" : "text-bad"}>
              {mark.correct ? "correct" : "incorrect"}
            </span>
          )}
          {pending && <span className="text-muted">awaiting your confirmation</span>}
        </p>
        {attempted && (
          <p className="mt-2 text-[15px] leading-7">
            <span className="text-faint">Read as</span>{" "}
            <span className="font-mono">{mark.read_answer}</span>
          </p>
        )}
        {mark.note && (
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{mark.note}</p>
        )}
      </div>
    </li>
  );
}
