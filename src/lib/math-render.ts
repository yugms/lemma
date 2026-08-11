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
 * Escape sequences that survived JSON decoding as literal characters.
 *
 * A model writing "\\n\\n" in its output leaves a backslash and an "n" in the
 * decoded string, which rendered verbatim in the middle of a question.
 *
 * The lookahead excludes a following *lowercase* letter, which is what
 * distinguishes this from a real macro: `\nu`, `\neq`, `\nabla`, `\times`,
 * `\text` all continue in lowercase, while the sequence that actually turns up
 * is `\n` against a newline, a space, or a capitalised next word — "\\n\\nOrder
 * the steps", where matching greedily would invent a macro called `\nOrder`.
 * The casualties are the uppercase-continued negations (`\nRightarrow`), which
 * no problem in this catalogue uses.
 */
function normalizeEscapes(text: string): string {
  return text.replace(/\\r\\n|\\[nr](?![a-z])/g, "\n").replace(/\\t(?![a-z])/g, " ");
}

/**
 * A run of undelimited LaTeX sitting in ordinary prose — the `\frac{7}{25}` in
 * "can be represented by the fraction \frac{7}{25}."
 *
 * Models are told to wrap inline math in \( \) and mostly do, but a field named
 * `latex` invites them to write the macro bare, and the result was rendering as
 * source text. Recognising it here means the convention is a preference rather
 * than a requirement. The optional numeric prefix catches `28\%`, where the
 * number belongs to the expression that follows it.
 */
const BARE_MATH =
  String.raw`(?:\d+(?:\.\d+)?\s*)?(?:\\[a-zA-Z]+(?:\s*\{[^{}]*\})*|\\[%$&#_])(?:\s*(?:\\[a-zA-Z]+(?:\s*\{[^{}]*\})*|\\[%$&#_]|\{[^{}]*\}))*`;

/**
 * Render prose containing inline \( \) and display \[ \] math segments,
 * plus {{n}} placeholders rendered as small blank markers. Undelimited LaTeX
 * is picked up too — see `BARE_MATH`.
 */
export function renderProse(raw: string): string {
  const text = normalizeEscapes(raw);
  let out = "";
  // Delimited forms are listed first so a `\(` is never mistaken for the start
  // of a bare run; the alternation is ordered, and both start at a backslash.
  const regex = new RegExp(
    String.raw`\\\((.+?)\\\)|\\\[([\s\S]+?)\\\]|\{\{(\d+)\}\}|(${BARE_MATH})`,
    "g"
  );
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) out += escapeHtml(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out += renderMath(m[1]);
    } else if (m[2] !== undefined) {
      // `overflow-x-auto` here as well as on `.katex-display` in globals.css:
      // KaTeX only emits `katex-display` when it renders in display mode, and
      // this wrapper is what a `\[...\]` becomes even when the inner render
      // falls back. A wide equation that escapes both scrolls the document.
      out += `<span class="my-3 block overflow-x-auto text-center">${renderMath(m[2], true)}</span>`;
    } else if (m[3] !== undefined) {
      out += `<span class="mx-1 inline-flex min-w-14 items-center justify-center border-b border-line-strong px-2 font-mono text-xs text-faint">${escapeHtml(m[3])}</span>`;
    } else {
      out += renderMath(m[4].trim());
    }
    last = regex.lastIndex;
  }
  if (last < text.length) out += escapeHtml(text.slice(last));
  return out;
}

/** Two ordinary words in a row: this is a sentence, not an expression. */
const PROSE_RUN = /[A-Za-z]{2,}\s+[A-Za-z]{2,}/;

/** Anything that could belong to an expression rather than a sentence. */
const MATH_SIGNAL = /\\[a-zA-Z]+|[\\^_{}=+\-*/<>]|\d/;

/** Macros and their arguments removed, so `\cdot` doesn't read as a word. */
function withoutMath(text: string): string {
  return text.replace(/\\[a-zA-Z]+/g, " ").replace(/\{[^{}]*\}/g, " ");
}

/**
 * Which of the two renderers a fragment needs.
 *
 * Exported because verification has to check a fragment the same way it will
 * be displayed. When the two disagreed, every select-all problem was thrown
 * away before it reached anyone: the field was documented as prose, the model
 * wrote prose, and `structuralCheck` still required the whole string to parse
 * as one LaTeX expression.
 */
export function inlineShape(raw: string): "empty" | "prose" | "math" {
  const text = normalizeEscapes(raw).trim();
  if (!text) return "empty";
  // The author used the convention, so trust it.
  if (/\\\(|\\\[|\{\{\d+\}\}/.test(text)) return "prose";
  // No math anywhere in it — a phrase like "the power rule".
  if (!MATH_SIGNAL.test(text)) return "prose";
  return PROSE_RUN.test(withoutMath(text)) ? "prose" : "math";
}

/**
 * Render a fragment that may be a bare expression, a sentence, or a sentence
 * with math in it — choices, ordering steps and matching columns are all three
 * depending on the problem.
 *
 * Picking one renderer per field was the bug: `renderMath` put whole sentences
 * into math mode, which strips the spaces between words, and `renderProse`
 * left bare expressions showing their source. Neither field has one shape, so
 * the shape is detected instead.
 */
export function renderInline(raw: string): string {
  const text = normalizeEscapes(raw).trim();
  return inlineShape(text) === "math" ? renderMath(text) : renderProse(text);
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
    // These four are all `renderInline` for the same reason: what they hold
    // depends on the problem. An MCQ choice is usually a bare expression but a
    // select-all choice is a full sentence; an ordering step reads "divide both
    // sides by \(3\)" or just "y = -\frac{9}{4}"; a matching column is bare
    // expressions on one side and phrases on the other.
    choices: p.choices?.map((c) => ({ id: c.id, html: renderInline(c.latex) })),
    items: p.items?.map((i) => ({ id: i.id, html: renderInline(i.latex) })),
    left: p.left?.map((l) => ({ id: l.id, html: renderInline(l.latex) })),
    right: p.right?.map((r) => ({ id: r.id, html: renderInline(r.latex) })),
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
