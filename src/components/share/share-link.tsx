"use client";

import { useState } from "react";
import { Check, Link2 } from "lucide-react";

/**
 * Copy a set's share link.
 *
 * The URL is assembled from `location.origin` in the click handler rather than
 * during render: the server has no way to know the host the reader is on, and
 * building it while rendering would either bake in a wrong origin or produce a
 * hydration mismatch.
 */
export function ShareLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function copy() {
    const url = `${window.location.origin}/s/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setFailed(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is denied in some browsers and every insecure origin.
      setFailed(true);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={copy} className="btn btn-ghost btn-sm">
        {copied ? (
          <Check className="h-3.5 w-3.5 text-ok" aria-hidden />
        ) : (
          <Link2 className="h-3.5 w-3.5" aria-hidden />
        )}
        {copied ? "Link copied" : "Share"}
      </button>
      {/* Announced rather than merely coloured, and a fallback the reader can
          select by hand when the clipboard is unavailable. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "Share link copied to clipboard" : ""}
      </span>
      {failed && (
        <code className="mono-meta select-all rounded-xs bg-sunk px-2 py-1">/s/{code}</code>
      )}
    </span>
  );
}
