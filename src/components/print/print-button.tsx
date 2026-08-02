"use client";

import { Printer } from "lucide-react";

/**
 * A client component for one `window.print()` call.
 *
 * The whole page is otherwise a Server Component, and this keeps it that way —
 * the alternative is telling the reader to use their browser's own print menu,
 * which is worse for the one action the page exists to perform.
 */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="btn btn-accent">
      <Printer className="h-3.5 w-3.5" aria-hidden />
      Print
    </button>
  );
}
