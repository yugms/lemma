"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ProblemCard, type CheckResponse } from "@/components/problem-card";
import type { SanitizedProblem } from "@/lib/ai/schemas";

type SetData = {
  set: { id: string; title: string };
  problems: SanitizedProblem[];
};

export default function PracticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<SetData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [results, setResults] = useState<(boolean | null)[]>([]);
  const [finished, setFinished] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    fetch(`/api/sets/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "Failed to load");
        return r.json();
      })
      .then((d: SetData) => {
        setData(d);
        setResults(new Array(d.problems.length).fill(undefined));
      })
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) {
    return (
      <div className="py-16 text-center space-y-3">
        <p className="text-zinc-600">{error}</p>
        <Link href="/sets" className="text-sm text-indigo-600 hover:underline">
          Back to my sets
        </Link>
      </div>
    );
  }
  if (!data) {
    return <div className="py-16 text-center text-zinc-400">Loading your problems...</div>;
  }

  const { set, problems } = data;

  if (finished) {
    const correct = results.filter((r) => r === true).length;
    const answered = results.filter((r) => r !== null && r !== undefined).length;
    return (
      <div className="mx-auto max-w-md space-y-6 py-16 text-center">
        <h1 className="text-3xl font-bold">Set complete 🎉</h1>
        <div className="rounded-2xl border border-zinc-200 bg-white p-8">
          <p className="text-5xl font-bold text-indigo-600">
            {correct}
            <span className="text-2xl text-zinc-300">/{answered}</span>
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            correct{answered < problems.length ? ` · ${problems.length - answered} revealed` : ""}
          </p>
        </div>
        <div className="flex justify-center gap-3">
          <Link
            href="/build"
            className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Build another set
          </Link>
          <Link
            href={`/set/${set.id}`}
            className="rounded-xl border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            Review problems
          </Link>
        </div>
      </div>
    );
  }

  const problem = problems[current];

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="truncate text-sm font-semibold text-zinc-500">{set.title}</h1>
        <div className="flex gap-1">
          {problems.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 w-5 rounded-full ${
                results[i] === true
                  ? "bg-emerald-400"
                  : results[i] === false
                    ? "bg-rose-400"
                    : results[i] === null
                      ? "bg-amber-300"
                      : i === current
                        ? "bg-indigo-400"
                        : "bg-zinc-200"
              }`}
            />
          ))}
        </div>
      </div>

      <ProblemCard
        key={problem.id}
        problem={problem}
        index={current + 1}
        total={problems.length}
        onCheck={async (action, answer) => {
          const res = await fetch("/api/check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              problemId: problem.id,
              setId: set.id,
              mode: "practice",
              action,
              answer,
              timeMs: Date.now() - startedAt.current,
            }),
          });
          if (!res.ok) {
            throw new Error((await res.json().catch(() => null))?.error ?? "Check failed");
          }
          return (await res.json()) as CheckResponse;
        }}
        onDone={(correct) => {
          setResults((prev) => {
            const next = [...prev];
            next[current] = correct;
            return next;
          });
        }}
      />

      {results[current] !== undefined && (
        <div className="flex justify-end">
          <button
            onClick={() => {
              if (current + 1 >= problems.length) {
                setFinished(true);
              } else {
                setCurrent(current + 1);
                startedAt.current = Date.now();
              }
            }}
            className="rounded-xl bg-zinc-900 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-700"
          >
            {current + 1 >= problems.length ? "Finish" : "Next problem →"}
          </button>
        </div>
      )}
    </div>
  );
}
