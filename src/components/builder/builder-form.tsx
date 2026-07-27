"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CatalogCourse } from "@/lib/catalog";
import { ensureUser } from "@/lib/auth";
import type { ProblemFormat, ProblemStyle } from "@/lib/ai/schemas";

const STYLES: { id: ProblemStyle; label: string; desc: string }[] = [
  { id: "drill", label: "Drill", desc: "Pure calculation, straight to the point" },
  { id: "word", label: "Word problems", desc: "Real-world scenarios to translate into math" },
  { id: "conceptual", label: "Conceptual", desc: "Why-questions and true/false understanding checks" },
  { id: "proof", label: "Proof / derivation", desc: "Short show-that and derive tasks" },
  { id: "error_analysis", label: "Error analysis", desc: "Spot the mistake in a worked solution" },
];

const FORMATS: { id: ProblemFormat; label: string }[] = [
  { id: "mcq", label: "Multiple choice" },
  { id: "open", label: "Open answer" },
  { id: "fill_blank", label: "Fill in the blank" },
];

const DIFF_LABELS = ["", "Warm-up", "Standard", "Quiz level", "Challenging", "Competition"];

type Progress = { done: number; total: number; message: string };

export function BuilderForm({ catalog }: { catalog: CatalogCourse[] }) {
  const router = useRouter();
  const [courseId, setCourseId] = useState(catalog[0]?.id ?? "");
  const [unitId, setUnitId] = useState<string>("all");
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [count, setCount] = useState(6);
  const [difficulty, setDifficulty] = useState(2);
  const [styles, setStyles] = useState<ProblemStyle[]>(["drill"]);
  const [formats, setFormats] = useState<ProblemFormat[]>(["mcq", "open"]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const course = useMemo(() => catalog.find((c) => c.id === courseId), [catalog, courseId]);
  const visibleUnits = useMemo(
    () => (course ? (unitId === "all" ? course.units : course.units.filter((u) => u.id === unitId)) : []),
    [course, unitId]
  );

  const toggle = <T,>(list: T[], v: T, set: (next: T[]) => void, min = 0) => {
    if (list.includes(v)) {
      if (list.length > min) set(list.filter((x) => x !== v));
    } else {
      set([...list, v]);
    }
  };

  const toggleTopic = (id: string) => {
    setTopicIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : prev.length >= 6 ? prev : [...prev, id]
    );
  };

  const busy = progress !== null;
  const canSubmit = topicIds.length > 0 && styles.length > 0 && formats.length > 0 && !busy;

  async function submit() {
    setError(null);
    setProgress({ done: 0, total: count, message: "Starting..." });
    try {
      await ensureUser();
      const res = await fetch("/api/sets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicIds, count, difficulty, styles, formats }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === "status") {
            setProgress((p) => ({ ...(p ?? { done: 0, total: count }), message: event.message }));
          } else if (event.type === "progress") {
            setProgress((p) => ({ message: p?.message ?? "", done: event.done, total: event.total }));
          } else if (event.type === "complete") {
            router.push(`/set/${event.setId}`);
            return;
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        }
      }
      throw new Error("Generation ended unexpectedly. Please try again.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setProgress(null);
    }
  }

  return (
    <div className="space-y-8">
      {/* Course + unit */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-700">1 · Course</h2>
        <div className="flex flex-wrap gap-2">
          {catalog.map((c) => (
            <button
              key={c.id}
              disabled={busy}
              onClick={() => {
                setCourseId(c.id);
                setUnitId("all");
                setTopicIds([]);
              }}
              className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
                c.id === courseId
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                  : "border-zinc-200 bg-white text-zinc-600 hover:border-indigo-300"
              }`}
            >
              {c.title}
            </button>
          ))}
        </div>
        {course && course.units.length > 1 && (
          <select
            value={unitId}
            disabled={busy}
            onChange={(e) => setUnitId(e.target.value)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
          >
            <option value="all">All units</option>
            {course.units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.title}
              </option>
            ))}
          </select>
        )}
      </section>

      {/* Topics */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-700">
          2 · Topics <span className="font-normal text-zinc-400">(pick 1–6)</span>
        </h2>
        <div className="space-y-4">
          {visibleUnits.map((u) => (
            <div key={u.id}>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-400">{u.title}</p>
              <div className="flex flex-wrap gap-2">
                {u.topics.map((t) => (
                  <button
                    key={t.id}
                    disabled={busy}
                    onClick={() => toggleTopic(t.id)}
                    className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                      topicIds.includes(t.id)
                        ? "border-indigo-500 bg-indigo-600 text-white"
                        : "border-zinc-200 bg-white text-zinc-600 hover:border-indigo-300"
                    }`}
                  >
                    {t.title}
                    {t.supports_templates && (
                      <span className="ml-1.5 text-[10px] opacity-70" title="Instant problems available">
                        ⚡
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Count + difficulty */}
      <section className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-700">3 · Number of problems</h2>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={3}
              max={12}
              value={count}
              disabled={busy}
              onChange={(e) => setCount(parseInt(e.target.value))}
              className="w-full accent-indigo-600"
            />
            <span className="w-8 text-center font-semibold text-indigo-600">{count}</span>
          </div>
        </div>
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-700">4 · Difficulty</h2>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((d) => (
              <button
                key={d}
                disabled={busy}
                onClick={() => setDifficulty(d)}
                className={`h-9 w-9 rounded-lg border text-sm font-semibold transition ${
                  d === difficulty
                    ? "border-indigo-500 bg-indigo-600 text-white"
                    : "border-zinc-200 bg-white text-zinc-500 hover:border-indigo-300"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-400">{DIFF_LABELS[difficulty]}</p>
        </div>
      </section>

      {/* Styles + formats */}
      <section className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-700">5 · Problem style</h2>
          <div className="space-y-1.5">
            {STYLES.map((s) => (
              <label
                key={s.id}
                className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm transition ${
                  styles.includes(s.id) ? "border-indigo-400 bg-indigo-50/60" : "border-zinc-200 bg-white"
                }`}
              >
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={styles.includes(s.id)}
                  onChange={() => toggle(styles, s.id, setStyles, 1)}
                  className="mt-0.5 accent-indigo-600"
                />
                <span>
                  <span className="font-medium text-zinc-800">{s.label}</span>
                  <span className="block text-xs text-zinc-400">{s.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-700">6 · Question format</h2>
          <div className="space-y-1.5">
            {FORMATS.map((f) => (
              <label
                key={f.id}
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition ${
                  formats.includes(f.id) ? "border-indigo-400 bg-indigo-50/60" : "border-zinc-200 bg-white"
                }`}
              >
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={formats.includes(f.id)}
                  onChange={() => toggle(formats, f.id, setFormats, 1)}
                  className="accent-indigo-600"
                />
                <span className="font-medium text-zinc-800">{f.label}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-zinc-400">
            More styles and formats (graphs, matching, multi-part, printables) are on the way.
          </p>
        </div>
      </section>

      {/* Submit */}
      <section className="space-y-3 border-t border-zinc-200 pt-6">
        {progress && (
          <div className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-indigo-700 font-medium">{progress.message}</span>
              <span className="text-indigo-500">
                {progress.done}/{progress.total}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-indigo-100">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all duration-500"
                style={{ width: `${Math.max(4, (progress.done / progress.total) * 100)}%` }}
              />
            </div>
          </div>
        )}
        {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
        <button
          disabled={!canSubmit}
          onClick={submit}
          className="w-full rounded-xl bg-indigo-600 px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-40 sm:w-auto"
        >
          {busy ? "Generating..." : `Generate ${count} problems`}
        </button>
        {!busy && topicIds.length === 0 && (
          <p className="text-xs text-zinc-400">Select at least one topic to continue.</p>
        )}
      </section>
    </div>
  );
}
