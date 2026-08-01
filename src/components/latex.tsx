import "katex/dist/katex.min.css";

/**
 * Client-safe math display. These components take markup that
 * `src/lib/math-render.ts` produced on the server and inject it — they
 * deliberately do not import KaTeX, so no route pays 275 kB of JavaScript
 * to show an equation. Only the stylesheet crosses over.
 */

/** A single rendered expression, from `renderMath()`. */
export function Math({ html, className }: { html: string; className?: string }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * Rendered prose, from `renderProse()`.
 *
 * `as="span"` is required when the output sits inside a <p> or other
 * phrasing context — a <div> there is invalid HTML and trips a React
 * hydration error.
 */
export function Prose({
  html,
  className,
  id,
  as: Wrapper = "div",
}: {
  html: string;
  className?: string;
  id?: string;
  as?: "div" | "span";
}) {
  return (
    <Wrapper id={id} className={className} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
