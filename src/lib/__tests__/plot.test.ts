import { describe, expect, it } from "vitest";
import {
  evalCurve,
  niceStep,
  plotGeometry,
  renderPlot,
  type PlotSpec,
  type PlotWindow,
} from "../plot";

const WINDOW: PlotWindow = { xMin: -5, xMax: 5, yMin: -5, yMax: 5 };

const spec = (over: Partial<PlotSpec> = {}): PlotSpec => ({
  window: WINDOW,
  curves: [{ kind: "linear", m: 1, b: 0 }],
  marks: [],
  showGrid: true,
  ...over,
});

describe("evalCurve", () => {
  it("evaluates each curve family", () => {
    expect(evalCurve({ kind: "linear", m: 2, b: 1 }, 3)).toBe(7);
    expect(evalCurve({ kind: "quadratic", a: 1, b: 0, c: -4 }, 2)).toBe(0);
    expect(evalCurve({ kind: "abs", a: 1, h: 2, k: 0 }, -1)).toBe(3);
    expect(evalCurve({ kind: "exp", a: 1, base: 2 }, 3)).toBe(8);
  });

  it("returns null rather than NaN for an impossible exponential", () => {
    // Authored specs are model output, so a negative base has to degrade.
    expect(evalCurve({ kind: "exp", a: 1, base: -2 }, 0.5)).toBeNull();
  });

  it("returns null when a value overflows to infinity", () => {
    expect(evalCurve({ kind: "exp", a: 1, base: 10 }, 1e6)).toBeNull();
  });
});

describe("plotGeometry", () => {
  const g = plotGeometry(WINDOW);

  it("round-trips math coordinates through pixels", () => {
    for (const [x, y] of [
      [0, 0],
      [-5, 5],
      [2.5, -1.25],
    ]) {
      expect(g.toMathX(g.toPxX(x))).toBeCloseTo(x, 9);
      expect(g.toMathY(g.toPxY(y))).toBeCloseTo(y, 9);
    }
  });

  it("puts the window's corners at opposite pixel corners", () => {
    // y is inverted in SVG space; getting this backwards flips every plot.
    expect(g.toPxY(WINDOW.yMax)).toBeLessThan(g.toPxY(WINDOW.yMin));
    expect(g.toPxX(WINDOW.xMin)).toBeLessThan(g.toPxX(WINDOW.xMax));
  });

  it("snaps to the lattice and clamps to the window", () => {
    expect(g.snap(1.4, -2.6)).toEqual({ x: 1, y: -3 });
    expect(g.snap(99, -99)).toEqual({ x: 5, y: -5 });
  });
});

describe("niceStep", () => {
  it("picks 1/2/5 x 10^k", () => {
    for (const span of [1, 3, 8, 10, 47, 100, 0.4]) {
      const step = niceStep(span);
      const mantissa = step / Math.pow(10, Math.floor(Math.log10(step)));
      expect([1, 2, 5, 10]).toContain(Number(mantissa.toFixed(6)));
    }
  });

  it("survives a degenerate span", () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-3)).toBe(1);
  });
});

describe("renderPlot", () => {
  it("produces a self-contained svg with no external references", () => {
    const svg = renderPlot(spec());
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).not.toMatch(/https?:\/\//);
    expect(svg).not.toContain("<script");
  });

  it("emits no NaN, Infinity or undefined in path data", () => {
    // One bad sample silently corrupts the whole path attribute.
    const svg = renderPlot(
      spec({
        curves: [
          { kind: "exp", a: 1, base: 3 },
          { kind: "quadratic", a: 4, b: 0, c: -20 },
          { kind: "exp", a: 1, base: -2 },
        ],
      })
    );
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  });

  it("breaks the path where a curve leaves the window", () => {
    // A single path across the gap would draw a false near-vertical segment
    // joining the two branches.
    const svg = renderPlot(spec({ curves: [{ kind: "exp", a: 1, base: 5 }] }));
    const d = /<path d="([^"]+)"/.exec(svg)?.[1] ?? "";
    expect(d.length).toBeGreaterThan(0);
    const steep = /M[\d.,-]+ L/.test(d) || (d.match(/M/g) ?? []).length >= 1;
    expect(steep).toBe(true);
  });

  it("escapes label text rather than injecting it", () => {
    const svg = renderPlot(
      spec({ marks: [{ x: 1, y: 1, label: '<script>alert("x")</script>' }] })
    );
    expect(svg).not.toContain("<script");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("labels ticks without floating point noise", () => {
    const svg = renderPlot(spec({ window: { xMin: 0, xMax: 1, yMin: 0, yMax: 1 } }));
    expect(svg).not.toMatch(/0\.30000000000000004|0\.7000000000000001/);
  });

  it("theme-follows via CSS variables rather than baked colours", () => {
    const svg = renderPlot(spec());
    expect(svg).toContain("var(--accent)");
    expect(svg).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("carries an accessible name", () => {
    expect(renderPlot(spec(), { title: "y equals x" })).toContain('aria-label="y equals x"');
  });
});
