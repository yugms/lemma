import Link from "next/link";

/**
 * Shared shell for the privacy policy and the terms.
 *
 * Kept deliberately plain. These are the two pages a reader arrives at already
 * suspicious, and every piece of styling that makes them feel like marketing
 * works against that — so: one column, real headings, and no panels or accent
 * colour anywhere.
 */

export const LEGAL_CONTACT = "yugms7@gmail.com";

/**
 * The date the wording last changed, edited by hand.
 *
 * Not `new Date()`: a policy that always claims to have been updated today is
 * worse than one with no date at all, because it destroys the one signal a
 * reader has for whether the terms moved under them. It is also exactly the
 * kind of render-time clock call `react-hooks/purity` exists to reject.
 */
export const LEGAL_LAST_UPDATED = "1 August 2026";

export function LegalPage({
  eyebrow,
  title,
  summary,
  children,
}: {
  eyebrow: string;
  title: string;
  /** The plain-language version, for people who will not read the rest. */
  summary: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <article className="mx-auto max-w-2xl">
      <p className="eyebrow eyebrow-accent">{eyebrow}</p>
      <h1 className="display mt-5 text-title">{title}</h1>
      <p className="mono-meta mt-5">Last updated {LEGAL_LAST_UPDATED}</p>

      <div className="aside-rule mt-9 py-1 text-prose leading-relaxed text-muted">{summary}</div>

      <div className="mt-14 space-y-12">{children}</div>

      <footer className="mt-16 border-t border-line pt-7">
        <p className="text-sm leading-relaxed text-muted">
          Questions, corrections, or a request about your data:{" "}
          <a href={`mailto:${LEGAL_CONTACT}`} className="link">
            {LEGAL_CONTACT}
          </a>
          .
        </p>
        <p className="mt-3 text-sm text-muted">
          See also the{" "}
          <Link href="/privacy" className="link">
            privacy policy
          </Link>
          , the{" "}
          <Link href="/terms" className="link">
            terms
          </Link>
          , and{" "}
          <Link href="/account" className="link">
            your data controls
          </Link>
          .
        </p>
      </footer>
    </article>
  );
}

export function Section({
  id,
  heading,
  children,
}: {
  id: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="display-md text-section">{heading}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-muted">{children}</div>
    </section>
  );
}

/** A labelled list — "what we collect", "who receives it" — rather than a wall of prose. */
export function Facts({ items }: { items: { term: string; detail: React.ReactNode }[] }) {
  return (
    <dl className="space-y-4 border-l border-line pl-5">
      {items.map((item) => (
        <div key={item.term}>
          <dt className="text-[15px] font-medium text-fg">{item.term}</dt>
          <dd className="mt-1 text-[15px] leading-relaxed text-muted">{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}
