import type { ProblemFormat, ProblemStyle } from "@/lib/ai/schemas";

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const shortDateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

export function formatDate(value: string | Date): string {
  return dateFormat.format(new Date(value));
}

/**
 * Recent dates read better as a relative phrase — "Today" tells a student
 * more about their own week than "Jul 31" does.
 */
export function formatRelativeDate(value: string | Date): string {
  const then = new Date(value);
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(then)) / 86_400_000);

  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (then.getFullYear() === new Date().getFullYear()) return shortDateFormat.format(then);
  return dateFormat.format(then);
}

export const DIFFICULTY_LABELS = [
  "",
  "Warm-up",
  "Standard",
  "Quiz level",
  "Challenging",
  "Competition",
];

/**
 * A set's level for display. Review sets store 0 because they span whatever the
 * student missed — and `DIFFICULTY_LABELS[0]` is the empty string, which `??`
 * does not fall back on, so an unguarded lookup renders a blank badge.
 */
export function difficultyLabel(level: number | undefined): string {
  if (!level) return "Mixed levels";
  return DIFFICULTY_LABELS[level] ?? `Level ${level}`;
}

/** Shared so the builder's controls and the stats breakdowns can't drift apart. */
export const STYLE_LABELS: Record<ProblemStyle, string> = {
  drill: "Drill",
  word: "Word problems",
  conceptual: "Conceptual",
  proof: "Proof",
  error_analysis: "Error analysis",
};

export const FORMAT_LABELS: Record<ProblemFormat, string> = {
  mcq: "Multiple choice",
  open: "Open answer",
  fill_blank: "Fill in the blank",
  multi_select: "Select all that apply",
  ordering: "Order the steps",
};

/**
 * Format labels for values that came out of the database rather than out of
 * `PROBLEM_FORMATS`. The `problems.format` enum has values the app doesn't
 * author (`graph`, `matching`, `multi_part`), and an unchecked lookup renders
 * `undefined` in the stats breakdown — or throws, where the result is
 * `.toLowerCase()`d.
 */
export function formatLabel(key: string): string {
  return FORMAT_LABELS[key as ProblemFormat] ?? key.replace(/_/g, " ");
}

/** Minutes and seconds, for the median-time tile. */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/** Coarse elapsed time for a running session — "2h 14m", "just started". */
export function formatElapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just started";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
