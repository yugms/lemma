"use client";

import { useState, useTransition } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { buildReviewSet } from "@/app/review/actions";

/**
 * Assemble a set from the problems this student missed.
 *
 * No streaming and no progress bar, unlike the builder: nothing is generated,
 * so there is nothing to watch. The action redirects on success.
 */
export function RedoButton({ count }: { count: number }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={pending || count === 0}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await buildReviewSet();
            if (res?.error) setError(res.error);
          });
        }}
        className="btn btn-accent btn-lg"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <RotateCcw className="h-4 w-4" aria-hidden />
        )}
        {pending ? "Building…" : `Practise these ${count}`}
      </button>
      {error && (
        <p role="alert" className="aside-rule mt-3 border-bad py-1 text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
