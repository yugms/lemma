/**
 * Deterministic coordinate plots, rendered to SVG in Node.
 *
 * Same rule as `math-render.ts`: the drawing happens on the server and the
 * browser only ever injects markup. A charting library in the client bundle
 * would cost more than KaTeX for a picture that never animates and never
 * re-fits — the plot is a fixed stimulus, so it can be a string.
 *
 * The geometry half is pure arithmetic with no dependencies, so the interactive
 * overlays import it too and agree with the rendered axes by construction
 * rather than by two hand-tuned copies of the same transform.
 */

export type PlotCurve =
  | { kind: "linear"; m: number; b: number }
  | { kind: "quadratic"; a: number; b: number; c: number }
  | { kind: "abs"; a: number; h: number; k: number }
  | { kind: "exp"; a: number; base: number };

export type PlotWindow = { xMin: number; xMax: number; yMin: number; yMax: number };

export type PlotMark = { x: number; y: number; label?: string | null };

export type PlotSpec = {
  window: PlotWindow;
  curves: PlotCurve[];
  /** Points drawn on top of the curves — intercepts, a vertex, sample data. */
  marks: PlotMark[];
  showGrid: boolean;
};

/** The authored (coefficient-array) form, structurally matching the zod schema. */
export type AuthoredCurveLike = { kind: string; coeffs: number[] };
export type AuthoredPlotLike = {
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
  curves: AuthoredCurveLike[];
  marks: { x: number; y: number; label?: string | null }[];
  show_grid: boolean;
};

/** How many coefficients each family needs, and what they mean. */
const ARITY: Record<string, number> = { linear: 2, quadratic: 3, abs: 3, exp: 2 };

/**
 * Coefficient array -> curve. Returns null on the wrong arity or a non-finite
 * coefficient: the source is model output, and a half-specified curve must be
 * dropped at the boundary rather than drawn as NaN.
 */
export function curveFromAuthored(c: AuthoredCurveLike): PlotCurve | null {
  const n = ARITY[c.kind];
  if (n === undefined || c.coeffs.length !== n) return null;
  if (!c.coeffs.every((v) => Number.isFinite(v))) return null;
  switch (c.kind) {
    case "linear":
      return { kind: "linear", m: c.coeffs[0], b: c.coeffs[1] };
    case "quadratic":
      return { kind: "quadratic", a: c.coeffs[0], b: c.coeffs[1], c: c.coeffs[2] };
    case "abs":
      return { kind: "abs", a: c.coeffs[0], h: c.coeffs[1], k: c.coeffs[2] };
    case "exp":
      return c.coeffs[1] > 0 ? { kind: "exp", a: c.coeffs[0], base: c.coeffs[1] } : null;
    default:
      return null;
  }
}

/** Authored plot -> drawing input. Null when the window is unusable. */
export function plotFromSpec(spec: AuthoredPlotLike): PlotSpec | null {
  const window = { xMin: spec.x_min, xMax: spec.x_max, yMin: spec.y_min, yMax: spec.y_max };
  if (!Object.values(window).every((v) => Number.isFinite(v))) return null;
  if (window.xMax <= window.xMin || window.yMax <= window.yMin) return null;
  return {
    window,
    curves: spec.curves.map(curveFromAuthored).filter((c): c is PlotCurve => c !== null),
    marks: spec.marks.filter((m) => Number.isFinite(m.x) && Number.isFinite(m.y)),
    showGrid: spec.show_grid,
  };
}

/**
 * Do two curves describe the same graph?
 *
 * Compared by sampled value rather than by coefficients, so an `abs` written
 * with a negated `a` and a shifted `k` that happens to coincide still counts —
 * and so a student who positioned the handles to the right curve is not failed
 * for arriving at it a different way.
 */
export function curvesMatch(
  a: PlotCurve,
  b: PlotCurve,
  w: PlotWindow,
  tolerance = 1e-6
): boolean {
  const SAMPLES = 40;
  const scale = Math.max(1, Math.abs(w.yMax - w.yMin));
  for (let i = 0; i <= SAMPLES; i++) {
    const x = w.xMin + ((w.xMax - w.xMin) * i) / SAMPLES;
    const ya = evalCurve(a, x);
    const yb = evalCurve(b, x);
    if (ya === null || yb === null) {
      if (ya !== yb) return false;
      continue;
    }
    if (Math.abs(ya - yb) > tolerance * scale) return false;
  }
  return true;
}

/** Unordered comparison of selected points against the key. */
export function pointsMatch(
  picked: { x: number; y: number }[],
  truth: { x: number; y: number }[],
  tolerance = 1e-6
): boolean {
  if (picked.length !== truth.length) return false;
  const remaining = [...truth];
  for (const p of picked) {
    const i = remaining.findIndex(
      (t) => Math.abs(t.x - p.x) <= tolerance && Math.abs(t.y - p.y) <= tolerance
    );
    if (i === -1) return false;
    remaining.splice(i, 1);
  }
  return remaining.length === 0;
}

/** Internal drawing surface. The SVG scales to its container via viewBox. */
export const PLOT_W = 480;
export const PLOT_H = 360;
/** Left/bottom room for tick labels; right/top just clears the stroke. */
const PAD_L = 36;
const PAD_B = 30;
const PAD_R = 12;
const PAD_T = 12;

export function evalCurve(c: PlotCurve, x: number): number | null {
  switch (c.kind) {
    case "linear":
      return c.m * x + c.b;
    case "quadratic":
      return c.a * x * x + c.b * x + c.c;
    case "abs":
      return c.a * Math.abs(x - c.h) + c.k;
    case "exp": {
      // A non-positive base is not a function of a real exponent; authored
      // specs are model output, so this has to degrade rather than emit NaN.
      if (c.base <= 0) return null;
      const y = c.a * Math.pow(c.base, x);
      return Number.isFinite(y) ? y : null;
    }
    default:
      return null;
  }
}

/**
 * The math↔pixel transform, shared by the server renderer and the client
 * overlays. `snap` is what makes point answers gradeable: a click becomes a
 * lattice coordinate, not a float nobody could ever match exactly.
 */
export function plotGeometry(w: PlotWindow) {
  const spanX = w.xMax - w.xMin || 1;
  const spanY = w.yMax - w.yMin || 1;
  const innerW = PLOT_W - PAD_L - PAD_R;
  const innerH = PLOT_H - PAD_T - PAD_B;

  const toPxX = (x: number) => PAD_L + ((x - w.xMin) / spanX) * innerW;
  const toPxY = (y: number) => PAD_T + innerH - ((y - w.yMin) / spanY) * innerH;
  const toMathX = (px: number) => w.xMin + ((px - PAD_L) / innerW) * spanX;
  const toMathY = (py: number) => w.yMin + ((PAD_T + innerH - py) / innerH) * spanY;

  return {
    toPxX,
    toPxY,
    toMathX,
    toMathY,
    /** Nearest integer lattice point, clamped into the window. */
    snap: (x: number, y: number) => ({
      x: clamp(Math.round(x), w.xMin, w.xMax),
      y: clamp(Math.round(y), w.yMin, w.yMax),
    }),
    inner: { left: PAD_L, top: PAD_T, width: innerW, height: innerH },
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 1/2/5 × 10^k, so labels land on numbers a reader recognises. */
export function niceStep(span: number, target = 8): number {
  if (!(span > 0)) return 1;
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function ticks(min: number, max: number): number[] {
  const step = niceStep(max - min);
  const out: number[] = [];
  // Start from a multiple of the step rather than from `min`, or every label
  // inherits the window's arbitrary offset.
  const first = Math.ceil(min / step) * step;
  for (let v = first; v <= max + step * 1e-6; v += step) {
    // Re-round each value: repeated addition of 0.1 drifts visibly by the
    // eighth tick and prints "0.30000000000000004".
    out.push(Number((Math.round(v / step) * step).toFixed(10)));
  }
  return out;
}

/** Trailing-zero-free, and never in exponent form for the ranges plots use. */
function fmt(v: number): string {
  if (Object.is(v, -0) || Math.abs(v) < 1e-10) return "0";
  return String(Number(v.toFixed(4)));
}

const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === '"' ? "&quot;" : "&#39;"
  );

/**
 * Sample a curve into path segments, breaking wherever it leaves the window.
 *
 * One path across a discontinuity would draw a near-vertical line joining the
 * two branches — which reads as part of the graph and is the classic way a
 * naive plotter lies about, say, an exponential blowing up.
 */
function curvePath(c: PlotCurve, w: PlotWindow, g: ReturnType<typeof plotGeometry>): string {
  const SAMPLES = 240;
  const spanY = w.yMax - w.yMin;
  // A little slack so a curve that exits and re-enters still joins up smoothly
  // instead of being clipped exactly at the frame.
  const lo = w.yMin - spanY;
  const hi = w.yMax + spanY;

  const segments: string[] = [];
  let current: string[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const x = w.xMin + ((w.xMax - w.xMin) * i) / SAMPLES;
    const y = evalCurve(c, x);
    if (y === null || !Number.isFinite(y) || y < lo || y > hi) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
      continue;
    }
    current.push(
      `${current.length === 0 ? "M" : "L"}${g.toPxX(x).toFixed(2)},${g.toPxY(y).toFixed(2)}`
    );
  }
  if (current.length > 1) segments.push(current.join(" "));
  return segments.join(" ");
}

/**
 * Render a plot to a standalone SVG string.
 *
 * Colours are CSS custom properties from `globals.css`, so the plot follows the
 * light/dark token swap without this module knowing which theme is active.
 */
export function renderPlot(spec: PlotSpec, opts?: { title?: string }): string {
  const w = spec.window;
  const g = plotGeometry(w);
  const parts: string[] = [];

  const xTicks = ticks(w.xMin, w.xMax);
  const yTicks = ticks(w.yMin, w.yMax);

  if (spec.showGrid) {
    const lines: string[] = [];
    for (const t of xTicks) {
      const px = g.toPxX(t).toFixed(2);
      lines.push(`<line x1="${px}" y1="${PAD_T}" x2="${px}" y2="${PLOT_H - PAD_B}" />`);
    }
    for (const t of yTicks) {
      const py = g.toPxY(t).toFixed(2);
      lines.push(`<line x1="${PAD_L}" y1="${py}" x2="${PLOT_W - PAD_R}" y2="${py}" />`);
    }
    parts.push(
      `<g stroke="var(--line)" stroke-width="1" opacity="0.6">${lines.join("")}</g>`
    );
  }

  // Axes sit at zero when zero is in view, otherwise on the frame edge — a
  // y-axis floating off-screen leaves tick labels with nothing to attach to.
  const axisX = g.toPxY(clamp(0, w.yMin, w.yMax)).toFixed(2);
  const axisY = g.toPxX(clamp(0, w.xMin, w.xMax)).toFixed(2);
  parts.push(
    `<g stroke="var(--fg-muted)" stroke-width="1.25">` +
      `<line x1="${PAD_L}" y1="${axisX}" x2="${PLOT_W - PAD_R}" y2="${axisX}" />` +
      `<line x1="${axisY}" y1="${PAD_T}" x2="${axisY}" y2="${PLOT_H - PAD_B}" />` +
      `</g>`
  );

  const labels: string[] = [];
  for (const t of xTicks) {
    if (t === 0) continue;
    labels.push(
      `<text x="${g.toPxX(t).toFixed(2)}" y="${PLOT_H - PAD_B + 15}" text-anchor="middle">${fmt(t)}</text>`
    );
  }
  for (const t of yTicks) {
    if (t === 0) continue;
    labels.push(
      `<text x="${PAD_L - 7}" y="${(g.toPxY(t) + 3.5).toFixed(2)}" text-anchor="end">${fmt(t)}</text>`
    );
  }
  parts.push(
    `<g fill="var(--fg-faint)" font-size="11" font-family="ui-monospace, monospace">${labels.join(
      ""
    )}</g>`
  );

  for (const c of spec.curves) {
    const d = curvePath(c, w, g);
    if (d) {
      parts.push(
        `<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`
      );
    }
  }

  for (const m of spec.marks) {
    const cx = g.toPxX(m.x).toFixed(2);
    const cy = g.toPxY(m.y).toFixed(2);
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="4" fill="var(--accent)" stroke="var(--paper)" stroke-width="1.5" />`
    );
    if (m.label) {
      parts.push(
        `<text x="${cx}" y="${(Number(cy) - 10).toFixed(2)}" text-anchor="middle" fill="var(--fg-muted)" font-size="11" font-family="ui-monospace, monospace">${escapeXml(
          m.label
        )}</text>`
      );
    }
  }

  const title = opts?.title ?? "Coordinate plot";
  return (
    `<svg viewBox="0 0 ${PLOT_W} ${PLOT_H}" role="img" aria-label="${escapeXml(title)}" ` +
    `preserveAspectRatio="xMidYMid meet" class="w-full h-auto">` +
    parts.join("") +
    `</svg>`
  );
}
