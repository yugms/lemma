"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Minus, Plus, Sparkles } from "lucide-react";
import { streamBuild } from "@/lib/build-stream";
import { DIFFICULTY_LABELS, FORMAT_LABELS, STYLE_LABELS } from "@/lib/format";
import {
  PROBLEM_FORMATS,
  PROBLEM_STYLES,
  type ProblemFormat,
  type ProblemStyle,
} from "@/lib/ai/kinds";

const MIN_COUNT = 4;
const MAX_COUNT = 12;

export type ReviewTopic = { id: string; title: string; unit: string | null };

export type MaterialReviewProps = {
  materialId: string;
  summary: string;
  topics: ReviewTopic[];
  difficulty: number;
  styles: ProblemStyle[];
  formats: ProblemFormat[];
  /** What the note asked for, already reduced to a direction by the analysis. */
  shift: "easier" | "same" | "harder";
};

type Progress = { message: string; done: number; total: number };

/** Where the requested shift lands, clamped to the levels that exist. */
const shifted = (level: number, shift: MaterialReviewProps["shift"]) =>
  Math.min(5, Math.max(1, level + (shift === "harder" ? 1 : shift === "easier" ? -1 : 0)));

/**
 * Confirm what was found in the material, then build from it.
 *
 * Everything here is client state over a digest that already exists — there is
 * no round trip until the build, and the build is `POST /api/sets` like every
 * other set, which is the whole reason that route grew a branch instead of this
 * feature growing its own generator.
 *
 * The controls are deliberately the same four the builder form offers, because
 * those are the four the route is willing to accept from a client. Nothing here
 * can edit what the model said about the material itself.
 */
export function MaterialReview({
  materialId,
  summary,
  topics,
  difficulty,
  styles: detectedStyles,
  formats: detectedFormats,
  shift,
}: MaterialReviewProps) {
  const router = useRouter();
  // Seeded in the initializer rather than an effect — `react-hooks/set-state-in-effect`
  // rejects the other shape, and this genuinely is initial state, not a reaction.
  const [topicIds, setTopicIds] = useState<string[]>(() => topics.map((t) => t.id));
  const [count, setCount] = useState(8);
  const [level, setLevel] = useState(() => shifted(difficulty, shift));
  const [styles, setStyles] = useState<ProblemStyle[]>(() => detectedStyles);
  const [formats, setFormats] = useState<ProblemFormat[]>(() => detectedFormats);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = progress !== null;
  const canSubmit = topicIds.length > 0 && styles.length > 0 && formats.length > 0 && !busy;

  const levelNote = useMemo(() => {
    if (level === difficulty) return `matches your material`;
    return level > difficulty ? `a step up from your material` : `a step down from your material`;
  }, [level, difficulty]);

  function toggle<T>(list: T[], value: T, set: (next: T[]) => void) {
    const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    if (next.length > 0) set(next);
  }

  async function submit() {
    setError(null);
    setProgress({ done: 0, total: count, message: "Starting…" });
    try {
      const { ensureUser } = await import("@/lib/auth");
      await ensureUser();
      router.refresh();
      for await (const event of streamBuild({
        mode: "material",
        materialId,
        topicIds,
        count,
        difficulty: level,
        styles,
        formats,
      })) {
        if (event.type === "status") {
          setProgress((p) => ({ ...(p ?? { done: 0, total: count }), message: event.message }));
        } else if (event.type === "progress") {
          setProgress((p) => ({
            message: p?.message ?? "",
            done: event.done,
            total: event.total,
          }));
        } else if (event.type === "complete") {
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
    <div className="space-y-9">
      <p className="text-base leading-relaxed text-muted">{summary}</p>

      <section className="space-y-3">
        <h2 className="eyebrow">Topics found</h2>
        <div className="flex flex-wrap gap-2">
          {topics.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={busy}
              aria-pressed={topicIds.includes(t.id)}
              onClick={() => toggle(topicIds, t.id, setTopicIds)}
              className="chip"
            >
              {t.title}
            </button>
          ))}
        </div>
        <p className="mono-meta">
          {topicIds.length} of {topics.length} selected · turn off anything that isn&apos;t what you
          were working on
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="eyebrow">Level</h2>
        <div className="flex flex-wrap items-center gap-2">
          {[1, 2, 3, 4, 5].map((d) => (
            <button
              key={d}
              type="button"
              disabled={busy}
              aria-pressed={d === level}
              aria-label={`Level ${d} — ${DIFFICULTY_LABELS[d]}`}
              onClick={() => setLevel(d)}
              className="chip h-9 w-9 justify-center px-0 font-mono"
            >
              {d}
            </button>
          ))}
          <span className="ml-2 text-sm text-muted">
            {DIFFICULTY_LABELS[level]} — {levelNote}
          </span>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="eyebrow">Style</h2>
        <div className="flex flex-wrap gap-2">
          {PROBLEM_STYLES.map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy}
              aria-pressed={styles.includes(s)}
              onClick={() => toggle(styles, s, setStyles)}
              className="chip"
            >
              {STYLE_LABELS[s]}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="eyebrow">Format</h2>
        <div className="flex flex-wrap gap-2">
          {PROBLEM_FORMATS.map((f) => (
            <button
              key={f}
              type="button"
              disabled={busy}
              aria-pressed={formats.includes(f)}
              onClick={() => toggle(formats, f, setFormats)}
              className="chip"
            >
              {FORMAT_LABELS[f]}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="eyebrow">Length</h2>
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
          <span aria-live="polite" className="w-10 text-center font-mono text-2xl tabular-nums">
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
      </section>

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
              style={{ width: `${Math.max(3, (progress.done / progress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="aside-rule border-bad py-1 text-sm leading-relaxed text-bad">
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
          <span className="text-sm text-faint">Keep at least one topic.</span>
        )}
      </div>
    </div>
  );
}
