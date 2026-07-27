"use client";

import { useState } from "react";
import { Latex, MathProse } from "@/components/latex";
import type { FeedbackResult, SanitizedProblem } from "@/lib/ai/schemas";

export type CheckResponse = {
  correct?: boolean;
  revealed?: boolean;
  feedback?: FeedbackResult | null;
  answer: {
    correct_choice_id?: string;
    value_latex?: string;
    blanks?: { index: number; value_latex: string }[];
  };
  explanation: { steps: { latex: string; note: string }[] };
};

const STYLE_LABELS: Record<string, string> = {
  drill: "Drill",
  word: "Word problem",
  conceptual: "Conceptual",
  proof: "Proof",
  error_analysis: "Error analysis",
};

export function ProblemCard({
  problem,
  index,
  total,
  onCheck,
  onDone,
}: {
  problem: SanitizedProblem;
  index: number;
  total: number;
  onCheck: (action: "answer" | "reveal", answer?: unknown) => Promise<CheckResponse>;
  onDone: (correct: boolean | null) => void;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const [openAnswer, setOpenAnswer] = useState("");
  const [blankAnswers, setBlankAnswers] = useState<Record<string, string>>({});
  const [showHint, setShowHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const answered = result !== null;

  const submittable =
    problem.format === "mcq"
      ? choice !== null
      : problem.format === "open"
        ? openAnswer.trim().length > 0
        : Object.keys(blankAnswers).length >= (problem.blanks_count ?? 1) &&
          Object.values(blankAnswers).every((v) => v.trim().length > 0);

  async function submit(action: "answer" | "reveal") {
    setBusy(true);
    setError(null);
    try {
      const payload =
        problem.format === "mcq" ? choice : problem.format === "open" ? openAnswer : blankAnswers;
      const res = await onCheck(action, action === "answer" ? payload : undefined);
      setResult(res);
      onDone(action === "reveal" ? null : (res.correct ?? null));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm p-6 space-y-5">
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span className="font-medium">
          Problem {index} <span className="text-zinc-300">/</span> {total}
        </span>
        <span className="flex items-center gap-2">
          {problem.topic_title && <span>{problem.topic_title}</span>}
          <span className="rounded-full bg-indigo-50 text-indigo-600 px-2 py-0.5 font-medium">
            {STYLE_LABELS[problem.style] ?? problem.style}
          </span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5">lvl {problem.difficulty}</span>
        </span>
      </div>

      <MathProse text={problem.statement_latex} className="text-[15px] leading-7 text-zinc-800" />

      {/* Answer input */}
      {problem.format === "mcq" && (
        <div className="grid gap-2">
          {problem.choices?.map((c) => {
            const isPicked = choice === c.id;
            const isCorrectChoice = answered && result?.answer.correct_choice_id === c.id;
            const isWrongPick = answered && isPicked && !isCorrectChoice;
            return (
              <button
                key={c.id}
                disabled={answered || busy}
                onClick={() => setChoice(c.id)}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition
                  ${isCorrectChoice ? "border-emerald-400 bg-emerald-50" : ""}
                  ${isWrongPick ? "border-rose-400 bg-rose-50" : ""}
                  ${!answered && isPicked ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-300" : ""}
                  ${!answered && !isPicked ? "border-zinc-200 hover:border-indigo-300 hover:bg-indigo-50/40" : ""}
                  ${answered && !isCorrectChoice && !isWrongPick ? "border-zinc-200 opacity-60" : ""}`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold
                  ${isCorrectChoice ? "bg-emerald-500 text-white" : isWrongPick ? "bg-rose-500 text-white" : isPicked ? "bg-indigo-500 text-white" : "bg-zinc-100 text-zinc-600"}`}
                >
                  {c.id}
                </span>
                <Latex math={c.latex} />
              </button>
            );
          })}
        </div>
      )}

      {problem.format === "open" && (
        <div className="space-y-1">
          <input
            value={openAnswer}
            disabled={answered || busy}
            onChange={(e) => setOpenAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && submittable && !answered && !busy) submit("answer");
            }}
            placeholder="Your answer, e.g. x = 3 or 3/4 or 2x+1"
            className="w-full rounded-xl border border-zinc-300 px-4 py-3 font-mono text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-300 disabled:bg-zinc-50"
          />
          <p className="text-xs text-zinc-400">
            Type math plainly: fractions as 3/4, roots as sqrt(2), powers as x^2.
          </p>
        </div>
      )}

      {problem.format === "fill_blank" && (
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: problem.blanks_count ?? 1 }, (_, i) => i + 1).map((n) => (
            <label key={n} className="flex items-center gap-2 text-sm text-zinc-600">
              <span className="font-medium text-indigo-500">{n}.</span>
              <input
                value={blankAnswers[String(n)] ?? ""}
                disabled={answered || busy}
                onChange={(e) => setBlankAnswers((prev) => ({ ...prev, [String(n)]: e.target.value }))}
                className="w-36 rounded-lg border border-zinc-300 px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none disabled:bg-zinc-50"
              />
            </label>
          ))}
        </div>
      )}

      {/* Hint */}
      {!answered && problem.hint && (
        <div>
          {showHint ? (
            <p className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              💡 <MathProse text={problem.hint} className="inline" as="span" />
            </p>
          ) : (
            <button onClick={() => setShowHint(true)} className="text-sm text-amber-600 hover:underline">
              Need a hint?
            </button>
          )}
        </div>
      )}

      {/* Actions */}
      {!answered && (
        <div className="flex items-center gap-3">
          <button
            disabled={!submittable || busy}
            onClick={() => submit("answer")}
            className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-40"
          >
            {busy ? "Checking..." : "Check answer"}
          </button>
          <button
            disabled={busy}
            onClick={() => submit("reveal")}
            className="text-sm text-zinc-500 hover:text-zinc-700 hover:underline"
          >
            Show solution
          </button>
        </div>
      )}
      {error && <p className="text-sm text-rose-600">{error}</p>}

      {/* Result */}
      {answered && result && (
        <div className="space-y-4">
          {!result.revealed && (
            <div
              className={`rounded-xl px-4 py-3 text-sm font-medium ${
                result.correct
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : "bg-rose-50 text-rose-700 border border-rose-200"
              }`}
            >
              {result.correct ? "Correct! Nice work." : "Not quite."}
            </div>
          )}

          {!result.correct && (
            <div className="text-sm text-zinc-700">
              <span className="font-semibold">Answer: </span>
              {result.answer.value_latex !== undefined && <Latex math={result.answer.value_latex} />}
              {result.answer.blanks?.map((b) => (
                <span key={b.index} className="mr-3">
                  <span className="text-indigo-500 font-medium">{b.index}.</span>{" "}
                  <Latex math={b.value_latex} />
                </span>
              ))}
            </div>
          )}

          {result.feedback && (
            <div className="rounded-xl bg-sky-50 border border-sky-200 px-4 py-3 text-sm text-sky-900 space-y-1">
              <p className="font-semibold">What likely went wrong</p>
              <MathProse text={result.feedback.what_went_wrong_latex} />
              <p className="text-sky-700">
                <span className="font-medium">Try this: </span>
                <MathProse text={result.feedback.next_hint} className="inline" as="span" />
              </p>
            </div>
          )}

          <details className="group rounded-xl border border-zinc-200" open={result.revealed || !result.correct}>
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-zinc-700">
              Step-by-step solution
            </summary>
            <ol className="space-y-3 px-4 pb-4">
              {result.explanation.steps.map((s, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-semibold text-zinc-500 mt-0.5">
                    {i + 1}
                  </span>
                  <div>
                    {s.latex && (
                      <div className="mb-0.5">
                        <Latex math={s.latex} />
                      </div>
                    )}
                    <p className="text-zinc-500">{s.note}</p>
                  </div>
                </li>
              ))}
            </ol>
          </details>
        </div>
      )}
    </div>
  );
}
