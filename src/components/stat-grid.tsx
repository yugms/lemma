/**
 * The headline number tiles, shared by the home page and the stats page so a
 * student sees the same figure presented the same way in both places.
 *
 * Hairline separators come from the wrapper's `gap-px` over a `bg-line`
 * background rather than per-tile borders, which is what keeps the grid from
 * doubling up its rules when it wraps.
 */
export function StatGrid({
  children,
  label,
  columns = 3,
}: {
  children: React.ReactNode;
  label: string;
  columns?: 3 | 4;
}) {
  return (
    <section
      aria-label={label}
      className={`grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line ${
        columns === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3"
      }`}
    >
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  suffix,
  className,
}: {
  label: string;
  value: string;
  suffix?: string;
  className?: string;
}) {
  return (
    <div className={`bg-surface px-5 py-6 ${className ?? ""}`}>
      <p className="eyebrow">{label}</p>
      <p className="display-md mt-3 text-[2rem] leading-none tabular-nums">
        {value}
        {suffix && <span className="ml-2 text-sm text-faint">{suffix}</span>}
      </p>
    </div>
  );
}
