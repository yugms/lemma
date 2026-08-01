"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCw } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-start py-20 sm:py-28">
      <p className="eyebrow eyebrow-accent">Something broke</p>
      <h1 className="display mt-6 text-title">That didn&apos;t load.</h1>
      <p className="mt-5 text-prose text-muted">
        The page hit an error on the way in. Trying again usually clears it —
        nothing you&apos;ve practised has been lost.
      </p>
      {error.digest && (
        <p className="mono-meta mt-5">Reference {error.digest}</p>
      )}
      <div className="mt-10 flex flex-wrap gap-3">
        <button type="button" onClick={reset} className="btn btn-accent">
          <RotateCw className="h-3.5 w-3.5" aria-hidden />
          Try again
        </button>
        <Link href="/" transitionTypes={["nav-back"]} className="btn btn-outline">
          Home
        </Link>
      </div>
    </div>
  );
}
