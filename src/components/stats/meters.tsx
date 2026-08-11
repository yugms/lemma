import type { SliceStat } from "@/lib/analytics";

/**
 * Accuracy bars.
 *
 * The accent is oxblood and "incorrect" is a red; the palette only survives
 * because the accent never appears inside a graded region. These bars are a
 * graded region, so they use ok / ink / bad only — the accent belongs to the
 * eyebrows and the build buttons, which sit well away from them.
 *
 * Colour is never the whole signal either: the percentage is always printed
 * beside the bar.
 */
export function accuracyTone(accuracy: number | null): string {
  if (accuracy === null) return "bg-line-strong";
  if (accuracy >= 80) return "bg-ok";
  if (accuracy >= 50) return "bg-fg";
  return "bg-bad";
}

export function AccuracyMeter({
  accuracy,
  label,
}: {
  accuracy: number | null;
  label: string;
}) {
  return (
    <div
      role="img"
      aria-label={accuracy === null ? `${label}: not graded yet` : `${label}: ${accuracy}% correct`}
      className="meter"
    >
      <div className={`meter-fill ${accuracyTone(accuracy)}`} style={{ width: `${accuracy ?? 0}%` }} />
    </div>
  );
}

/**
 * One breakdown — by format, by style, by difficulty.
 *
 * The heading is optional because one caller sits directly under a section
 * heading that already names it, and passing `""` used to render a genuinely
 * empty `<h3>` — an element with no accessible name, which is a WCAG failure
 * rather than a cosmetic one.
 */
export function SliceList({ title, slices }: { title?: string; slices: SliceStat[] }) {
  if (slices.length === 0) return null;
  return (
    <div>
      {title ? <h3 className="eyebrow border-b border-line pb-2.5">{title}</h3> : null}
      <ul className="mt-4 space-y-4">
        {slices.map((s) => (
          <li key={s.key}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[13px]">{s.label}</span>
              <span className="mono-meta shrink-0 tabular-nums">
                {s.accuracy === null ? "—" : `${s.accuracy}%`}
              </span>
            </div>
            <div className="mt-2">
              <AccuracyMeter accuracy={s.accuracy} label={s.label} />
            </div>
            <p className="mono-meta mt-1.5">
              {s.correct}/{s.attempted} correct
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Last 30 days. A gap is as informative as a spike, so empty days are drawn. */
export function ActivityStrip({
  activity,
}: {
  activity: { date: string; answered: number; correct: number; revealed: number }[];
}) {
  const peak = Math.max(1, ...activity.map((d) => d.answered + d.revealed));
  const total = activity.reduce((n, d) => n + d.answered + d.revealed, 0);
  const days = activity.filter((d) => d.answered + d.revealed > 0).length;

  return (
    <div>
      <div className="flex h-16 items-end gap-[3px]" aria-hidden>
        {activity.map((d) => {
          const n = d.answered + d.revealed;
          return (
            <div
              key={d.date}
              title={`${d.date}: ${n} problem${n === 1 ? "" : "s"}`}
              className={`min-w-0 flex-1 rounded-[1px] ${n > 0 ? "bg-fg" : "bg-line"}`}
              style={{ height: n > 0 ? `${Math.max(8, (n / peak) * 100)}%` : "2px" }}
            />
          );
        })}
      </div>
      <p className="mono-meta mt-3">
        {total} problem{total === 1 ? "" : "s"} across {days} day{days === 1 ? "" : "s"} · last 30 days
      </p>
    </div>
  );
}
