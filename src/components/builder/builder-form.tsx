"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ChevronDown, Loader2, Minus, Plus, Sparkles, X, Zap } from "lucide-react";
import type { CatalogCourse } from "@/lib/catalog";
import { streamBuild } from "@/lib/build-stream";
import { DIFFICULTY_LABELS, FORMAT_LABELS, STYLE_LABELS } from "@/lib/format";
// From `kinds` rather than `schemas`: the vocabulary is the same, but importing
// a value from `schemas` puts the whole zod runtime in this route's bundle.
import { PROBLEM_FORMATS, type ProblemFormat, type ProblemStyle } from "@/lib/ai/kinds";

/* Labels come from `format.ts` so the builder's controls and the stats
   breakdowns always name the same thing the same way. */
const STYLES: { id: ProblemStyle; desc: string }[] = [
  { id: "drill", desc: "Pure calculation, straight to the point" },
  { id: "word", desc: "Real-world scenarios to translate into math" },
  { id: "conceptual", desc: "Why-questions and true/false understanding checks" },
  { id: "proof", desc: "Short show-that and derive tasks" },
  { id: "error_analysis", desc: "Spot the mistake in a worked solution" },
];

/** Derived from the schema, so a new format can't be silently unselectable. */
const FORMATS: readonly ProblemFormat[] = PROBLEM_FORMATS;

const FORMAT_HINTS: Record<ProblemFormat, string> = {
  mcq: "One right answer among four",
  open: "Type the answer yourself",
  fill_blank: "Complete the missing pieces",
  multi_select: "More than one can be right",
  matching: "Pair each one with its match",
  multi_part: "Several parts that build up",
  graph: "Read, mark up or draw a plot",
  ordering: "Arrange the steps of a method",
};

const MIN_COUNT = 3;
const MAX_COUNT = 12;
const MAX_TOPICS = 6;

type Progress = { done: number; total: number; message: string };

/** One labelled row of the spec sheet. Label left, controls right. */
function Row({
  label,
  aside,
  children,
}: {
  label: string;
  aside?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <section
      role="group"
      aria-labelledby={id}
      className="grid gap-4 border-b border-line py-8 sm:grid-cols-[8.5rem_1fr] sm:gap-10"
    >
      <div className="flex items-baseline justify-between gap-3 sm:block">
        <h2 id={id} className="eyebrow">
          {label}
        </h2>
        {aside && <p className="mono-meta sm:mt-2">{aside}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function BuilderForm({ catalog }: { catalog: CatalogCourse[] }) {
  const router = useRouter();
  /* Which course is being browsed — not a property of the set. A set is just a
     list of topic ids, and the pipeline labels each one with its own course
     when it prompts the author, so a set may span as many as it likes. */
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

  /** Flat topic id -> where it lives, so a selection can be named from anywhere
      in the catalog rather than only from the part currently on screen. */
  const topicIndex = useMemo(() => {
    const map = new Map<string, { title: string; courseId: string; courseTitle: string }>();
    for (const c of catalog)
      for (const u of c.units)
        for (const t of u.topics) map.set(t.id, { title: t.title, courseId: c.id, courseTitle: c.title });
    return map;
  }, [catalog]);

  const selected = useMemo(
    () =>
      topicIds.flatMap((id) => {
        const t = topicIndex.get(id);
        return t ? [{ id, ...t }] : [];
      }),
    [topicIds, topicIndex]
  );

  /** Per course, for the chip counters — the only cue that a course you are not
      looking at still has topics in the set. */
  const countByCourse = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of selected) counts.set(t.courseId, (counts.get(t.courseId) ?? 0) + 1);
    return counts;
  }, [selected]);

  /* Selected topics the current course/unit view doesn't render. Without them
     the selection would be invisible and unremovable the moment you switch
     course, which is exactly what a cross-course set asks you to do. */
  const offscreen = useMemo(() => {
    const shown = new Set(visibleUnits.flatMap((u) => u.topics.map((t) => t.id)));
    return selected.filter((t) => !shown.has(t.id));
  }, [selected, visibleUnits]);

  const toggle = <T,>(list: T[], v: T, set: (next: T[]) => void, min = 0) => {
    if (list.includes(v)) {
      if (list.length > min) set(list.filter((x) => x !== v));
    } else {
      set([...list, v]);
    }
  };

  const toggleTopic = (id: string) => {
    setTopicIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : prev.length >= MAX_TOPICS ? prev : [...prev, id]
    );
  };

  const busy = progress !== null;
  const canSubmit = topicIds.length > 0 && styles.length > 0 && formats.length > 0 && !busy;

  async function submit() {
    setError(null);
    setProgress({ done: 0, total: count, message: "Starting…" });
    try {
      // Loaded on submit, not on mount — the Supabase SDK is the heaviest
      // dependency on this page and nothing needs it until you generate.
      const { ensureUser } = await import("@/lib/auth");
      await ensureUser();
      // That may have just minted an anonymous session. Auth is resolved on the
      // server and handed to the header as a prop, so without this the header
      // keeps offering "Sign in" to someone who now has a session and a set.
      router.refresh();
      for await (const event of streamBuild({ topicIds, count, difficulty, styles, formats })) {
        if (event.type === "status") {
          setProgress((p) => ({ ...(p ?? { done: 0, total: count }), message: event.message }));
        } else if (event.type === "progress") {
          setProgress((p) => ({ message: p?.message ?? "", done: event.done, total: event.total }));
        } else if (event.type === "complete") {
          // Progress is deliberately left set so the controls stay locked
          // through the navigation.
          router.push(`/set/${event.setId}`);
          return;
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setProgress(null);
    }
  }


  return (
    <div className="border-t border-line">
      <Row label="Course">
        <div className="flex flex-wrap gap-2">
          {catalog.map((c) => {
            const picked = countByCourse.get(c.id) ?? 0;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={c.id === courseId}
                disabled={busy}
                onClick={() => {
                  // Topics are deliberately kept: switching course adds to the
                  // set rather than starting it over. Only the unit filter is
                  // reset, since it names a unit of the course being left.
                  setCourseId(c.id);
                  setUnitId("all");
                }}
                className="chip"
              >
                {c.title}
                {picked > 0 && (
                  <>
                    <span aria-hidden className="font-mono text-[11px] tabular-nums opacity-65">
                      {picked}
                    </span>
                    <span className="sr-only">({picked} selected)</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
        {course && course.units.length > 1 && (
          <div className="relative mt-4 inline-block">
            <select
              value={unitId}
              disabled={busy}
              aria-label="Filter topics by unit"
              onChange={(e) => setUnitId(e.target.value)}
              // No `text-sm`: iOS zooms the viewport on select focus too, and
              // this is the first control a new visitor touches.
              className="field w-auto appearance-none py-2 pl-3 pr-10 sm:text-sm"
            >
              <option value="all">All units</option>
              {course.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.title}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
            />
          </div>
        )}
        <p className="mt-3 text-[13px] leading-relaxed text-faint">
          Topics stay selected when you switch course, so one set can draw on
          several.
        </p>
      </Row>

      <Row label="Topics" aside={`${topicIds.length} / ${MAX_TOPICS}`}>
        <div className="space-y-6">
          {visibleUnits.map((u) => (
            <div key={u.id}>
              <p className="mb-2.5 text-xs text-faint">{u.title}</p>
              <div className="flex flex-wrap gap-2">
                {u.topics.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={topicIds.includes(t.id)}
                    disabled={busy || (topicIds.length >= MAX_TOPICS && !topicIds.includes(t.id))}
                    onClick={() => toggleTopic(t.id)}
                    className="chip group"
                  >
                    {t.title}
                    {t.supports_templates && (
                      <>
                        <Zap
                          aria-hidden
                          className="h-2.5 w-2.5 fill-current text-ok group-aria-pressed:text-accent-on"
                        />
                        {/* `title` alone is unreachable on touch and unreliable
                            in screen readers, so the meaning is in the name. */}
                        <span className="sr-only">(instant problems available)</span>
                      </>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {offscreen.length > 0 && (
            <div className="border-t border-line pt-5">
              <p className="mb-2.5 text-xs text-faint">Also in this set</p>
              <div className="flex flex-wrap gap-2">
                {offscreen.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed
                    disabled={busy}
                    onClick={() => toggleTopic(t.id)}
                    className="chip"
                  >
                    {/* The course is part of the name, not decoration: out of its
                        own list a topic title alone doesn't say where it came from. */}
                    {t.courseId !== courseId && <span className="opacity-65">{t.courseTitle} /</span>}
                    {t.title}
                    <X aria-hidden className="h-3 w-3" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </Row>

      <Row label="Length">
        <div className="flex items-center gap-4">
          <button
            type="button"
            disabled={busy || count <= MIN_COUNT}
            onClick={() => setCount((c) => Math.max(MIN_COUNT, c - 1))}
            aria-label="Fewer problems"
            className="btn btn-outline btn-icon"
          >
            <Minus className="h-3.5 w-3.5" aria-hidden />
          </button>
          <span
            aria-live="polite"
            className="w-10 text-center font-mono text-2xl tabular-nums"
          >
            {count}
          </span>
          <button
            type="button"
            disabled={busy || count >= MAX_COUNT}
            onClick={() => setCount((c) => Math.min(MAX_COUNT, c + 1))}
            aria-label="More problems"
            className="btn btn-outline btn-icon"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </button>
          <span className="ml-1 text-sm text-faint">problems</span>
        </div>
      </Row>

      <Row label="Difficulty">
        <div className="flex flex-wrap items-center gap-2">
          {[1, 2, 3, 4, 5].map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={d === difficulty}
              aria-label={`Level ${d} — ${DIFFICULTY_LABELS[d]}`}
              disabled={busy}
              onClick={() => setDifficulty(d)}
              // Fixed square, so the coarse `.chip` padding would fight it.
              className="chip h-9 w-9 justify-center px-0 font-mono pointer-coarse:h-11 pointer-coarse:w-11"
            >
              {d}
            </button>
          ))}
          <span className="ml-2 text-sm text-muted">{DIFFICULTY_LABELS[difficulty]}</span>
        </div>
      </Row>

      <Row label="Style">
        <div>
          {STYLES.map((s) => {
            const on = styles.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                disabled={busy}
                onClick={() => toggle(styles, s.id, setStyles, 1)}
                className="group flex w-full items-start gap-4 rounded-[3px] py-2.5 text-left disabled:opacity-50"
              >
                <span
                  className={clsx(
                    "mt-[3px] h-3.5 w-3.5 shrink-0 rounded-[2px] border transition-colors",
                    on
                      ? "border-accent bg-accent-solid"
                      : "border-line-strong bg-surface group-hover:border-accent"
                  )}
                />
                {/* Stacked below the label on a phone rather than hidden. The
                    description was `hidden sm:block`, which left mobile with
                    "Drill / Word / Conceptual / Proof / Error analysis" and
                    nothing to say what any of them meant — the one thing on
                    this row a first-time builder actually needs. */}
                <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:gap-4">
                  <span
                    className={clsx(
                      "text-sm transition-colors sm:w-32 sm:shrink-0",
                      on ? "text-fg" : "text-muted"
                    )}
                  >
                    {STYLE_LABELS[s.id]}
                  </span>
                  <span className="flex-1 text-[13px] leading-relaxed text-faint">
                    {s.desc}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Row>

      <Row label="Format">
        <div className="flex flex-wrap gap-2">
          {FORMATS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={formats.includes(f)}
              disabled={busy}
              onClick={() => toggle(formats, f, setFormats, 1)}
              title={FORMAT_HINTS[f]}
              className="chip"
            >
              {FORMAT_LABELS[f]}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-faint">
          {formats.map((f) => FORMAT_HINTS[f]).join(" · ")}
        </p>
      </Row>

      <div className="space-y-7 pt-9">
        {/* Recap, so the spec is checkable without scrolling back up. */}
        {!busy && topicIds.length > 0 && (
          <p className="text-sm leading-relaxed text-muted">
            <span className="text-fg">{count} problems</span> ·{" "}
            {DIFFICULTY_LABELS[difficulty]} ·{" "}
            {selected
              .slice(0, 3)
              .map((t) => t.title)
              .join(", ")}
            {selected.length > 3 && ` +${selected.length - 3} more`}
            {countByCourse.size > 1 && ` · across ${countByCourse.size} courses`}
          </p>
        )}

        {progress && (
          <div className="space-y-3">
            <div className="flex items-baseline justify-between gap-4">
              <span aria-live="polite" className="text-sm text-muted">
                {progress.message}
              </span>
              <span className="mono-meta">
                {progress.done}/{progress.total}
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              aria-label="Generation progress"
              className="meter meter-live"
            >
              <div
                className="meter-fill"
                // Floored so the bar is never invisible while work is real.
                style={{ width: `${Math.max(3, (progress.done / progress.total) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="aside-rule border-bad py-1 text-sm leading-relaxed text-bad"
          >
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="btn btn-accent btn-lg"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-4 w-4" aria-hidden />
            )}
            {busy ? "Generating…" : `Generate ${count} problems`}
          </button>
          {!busy && topicIds.length === 0 && (
            <span className="text-sm text-faint">Select at least one topic.</span>
          )}
        </div>
      </div>
    </div>
  );
}
