/**
 * The lemma mark: a solid block with its top-right quadrant lifted out and
 * set beside it. It reads three ways at once — an L, a QED tombstone, and a
 * piece extracted from a larger proof, which is what a lemma is.
 *
 * Pure geometry, no font dependency, legible down to 16px.
 */
export function Logomark({
  className,
  title,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={className}
    >
      <path d="M3 3h8.5v8.5H21V21H3V3Z" />
      <path d="M14.5 3H21v6.5h-6.5V3Z" opacity="0.45" />
    </svg>
  );
}

/** Mark plus wordmark, sized off the current font-size. */
export function Wordmark({
  className,
  markClassName,
}: {
  className?: string;
  markClassName?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-[0.4em] ${className ?? ""}`}>
      <Logomark
        className={`h-[0.72em] w-[0.72em] shrink-0 text-accent ${markClassName ?? ""}`}
      />
      <span className="display-md leading-none tracking-[-0.03em]">lemma</span>
    </span>
  );
}
