import Link from "next/link";

/**
 * A set with nothing in it.
 *
 * Reachable because a build can deliver zero problems and still save the set —
 * the pipeline degrades to a short set rather than failing, and zero is the
 * shortest one. Both practice engines used to `return null` here, which left a
 * page with an empty `<main>`, no heading, and nothing to click.
 */
export function EmptySet({ setId }: { setId: string }) {
  return (
    <div className="mx-auto max-w-lg py-16">
      <p className="eyebrow eyebrow-accent">Nothing to practise</p>
      <h1 className="display-sm mt-5 text-section">This set came out empty.</h1>
      <p className="mt-5 text-prose text-muted">
        No problems survived verification when it was built, so there is nothing here to
        work through. Building it again usually gets a full set.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/build" className="btn btn-accent">
          Build a new set
        </Link>
        <Link href={`/set/${setId}`} className="btn btn-outline">
          Back to the set
        </Link>
      </div>
    </div>
  );
}
