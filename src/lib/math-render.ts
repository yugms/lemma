import katex from "katex";
import type { PreparedProblem, SanitizedProblem } from "@/lib/ai/schemas";
import { plotFromSpec, renderPlot } from "@/lib/plot";

/**
 * Server-side math rendering.
 *
 * KaTeX is ~275 kB of JavaScript. Nothing in this module may be imported from
 * a Client Component — every math string is rendered to HTML on the server
 * (in a Server Component or a route handler) and only the resulting markup
 * crosses to the browser. `src/components/latex.tsx` holds the client-safe
 * counterparts that inject that markup.
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Prose segments used to be React text nodes, which React escaped for us.
 * Now that they are concatenated into a string, escaping is ours to do —
 * problem statements are model-authored, so this is load-bearing.
 */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Render a raw LaTeX string (no delimiters) to KaTeX HTML. */
export function renderMath(latex: string, display = false): string {
  try {
    return katex.renderToString(latex, {
      throwOnError: false,
      displayMode: display,
      strict: "ignore",
      // Every string reaching this function is model-authored and its output is
      // injected with dangerouslySetInnerHTML. `trust` is what keeps \href,
      // \url, \includegraphics and the \html* family from emitting live
      // attributes; false is KaTeX's default, and it is stated here so the
      // guarantee is a decision rather than an inherited default that a version
      // bump or a "let authors link out" change could quietly reverse.
      trust: false,
    });
  } catch {
    // A broken expression should still read as its source, not vanish.
    return escapeHtml(latex);
  }
}

/**
 * Render prose containing inline \( \) and display \[ \] math segments,
 * plus {{n}} placeholders rendered as small blank markers.
 */
export function renderProse(text: string): string {
  let out = "";
  const regex = /\\\((.+?)\\\)|\\\[([\s\S]+?)\\\]|\{\{(\d+)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) out += escapeHtml(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out += renderMath(m[1]);
    } else if (m[2] !== undefined) {
      out += `<span class="my-3 block text-center">${renderMath(m[2], true)}</span>`;
    } else {
      out += `<span class="mx-1 inline-flex min-w-14 items-center justify-center border-b border-line-strong px-2 font-mono text-xs text-faint">${escapeHtml(m[3])}</span>`;
    }
    last = regex.lastIndex;
  }
  if (last < text.length) out += escapeHtml(text.slice(last));
  return out;
}

/** Convenience for nullable fields (hints, notes). */
export function renderProseOrNull(text: string | null | undefined): string | null {
  return text ? renderProse(text) : null;
}

/** Pre-render every math string a problem will display in the browser. */
export function prepareProblem(p: SanitizedProblem): PreparedProblem {
  return {
    id: p.id,
    position: p.position,
    style: p.style,
    format: p.format,
    difficulty: p.difficulty,
    topic_title: p.topic_title,
    blanks_count: p.blanks_count,
    statement_html: renderProse(p.statement_latex),
    hint_html: renderProseOrNull(p.hint),
    choices: p.choices?.map((c) => ({ id: c.id, html: renderMath(c.latex) })),
    // Ordering steps are prose-with-math, not bare expressions — a step reads
    // "divide both sides by \(3\)", so it needs renderProse, not renderMath.
    items: p.items?.map((i) => ({ id: i.id, html: renderProse(i.latex) })),
    // Matching columns hold bare expressions on one side and often a phrase on
    // the other ("the power rule"), so both go through renderProse.
    left: p.left?.map((l) => ({ id: l.id, html: renderProse(l.latex) })),
    right: p.right?.map((r) => ({ id: r.id, html: renderProse(r.latex) })),
    parts: p.parts?.map((part) => ({
      label: part.label,
      prompt_html: renderProse(part.prompt_latex),
    })),
    // The plot is drawn here for the same reason the math is: so the browser
    // needs neither KaTeX nor a charting library. The window travels alongside
    // it because the interactive overlays need the transform, not the picture.
    ...plotFields(p),
  };
}

function plotFields(p: SanitizedProblem) {
  if (!p.plot) return {};
  const plot = plotFromSpec(p.plot);
  if (!plot) return {};
  return {
    plot_svg: renderPlot(plot),
    plot_window: plot.window,
    response_kind: p.response_kind,
    sketch_kind: p.sketch_kind,
  };
}
