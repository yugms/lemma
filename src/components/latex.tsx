import katex from "katex";
import "katex/dist/katex.min.css";

/** Render a raw LaTeX string (no delimiters) as math. */
export function Latex({ math, display = false, className }: { math: string; display?: boolean; className?: string }) {
  let html: string;
  try {
    html = katex.renderToString(math, {
      throwOnError: false,
      displayMode: display,
      strict: "ignore",
    });
  } catch {
    html = math;
  }
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * Render prose containing inline \( \) and display \[ \] math segments,
 * plus {{n}} placeholders rendered as small blank markers.
 *
 * `as="span"` is required when the output sits inside a <p> or other phrasing
 * context — a <div> there is invalid HTML and trips a React hydration error.
 */
export function MathProse({
  text,
  className,
  as: Wrapper = "div",
}: {
  text: string;
  className?: string;
  as?: "div" | "span";
}) {
  const parts: React.ReactNode[] = [];
  const regex = /\\\((.+?)\\\)|\\\[([\s\S]+?)\\\]|\{\{(\d+)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    if (m[1] !== undefined) {
      parts.push(<Latex key={key++} math={m[1]} />);
    } else if (m[2] !== undefined) {
      parts.push(
        <span key={key++} className="block my-2 text-center">
          <Latex math={m[2]} display />
        </span>
      );
    } else {
      parts.push(
        <span
          key={key++}
          className="inline-flex items-center justify-center min-w-14 mx-1 px-2 border-b-2 border-dashed border-indigo-400 text-indigo-500 text-sm font-medium"
        >
          {m[3]}
        </span>
      );
    }
    last = regex.lastIndex;
  }
  if (last < text.length) parts.push(<span key={key++}>{text.slice(last)}</span>);
  return <Wrapper className={className}>{parts}</Wrapper>;
}
