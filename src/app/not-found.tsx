import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-start py-20 sm:py-28">
      <p className="eyebrow eyebrow-accent">404</p>
      <h1 className="display mt-6 text-title">Nothing here.</h1>
      <p className="mt-5 text-prose text-muted">
        That page doesn&apos;t exist — or it belongs to a set on another
        account. Your own sets are always in your library.
      </p>
      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/sets" transitionTypes={["nav-back"]} className="btn btn-accent">
          My sets
        </Link>
        <Link href="/" transitionTypes={["nav-back"]} className="btn btn-outline">
          Home
        </Link>
      </div>
    </div>
  );
}
