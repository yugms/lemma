/**
 * Escape text that is about to be concatenated into markup.
 *
 * There were three copies of this: `math-render.ts` and `print-key.ts` held
 * byte-identical tables, and `plot.ts` spelled the same five characters as a
 * nested ternary. All three exist for one reason — the text is model-authored
 * and the surrounding code builds a string rather than letting React build a
 * text node, so the escaping React would have done is theirs to do.
 *
 * Its own module because it has to reach all three and they cannot reach each
 * other: `math-render.ts` imports katex, and `plot.ts` is imported by the
 * interactive graph overlays, which are `"use client"`. A shared helper living
 * in either one would put 275 kB of KaTeX in the browser bundle.
 *
 * The same five characters cover HTML and XML, which is why the SVG writer and
 * the two HTML writers can share one function.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeMarkup(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}
