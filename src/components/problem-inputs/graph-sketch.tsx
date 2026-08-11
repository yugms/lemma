"use client";

import { useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useCoarsePointer } from "@/lib/use-coarse-pointer";
import {
  evalCurve,
  plotGeometry,
  PLOT_H,
  PLOT_W,
  type PlotCurve,
  type PlotWindow,
} from "@/lib/plot";

export type SketchKind = "linear" | "quadratic" | "abs";
export type Handle = { x: number; y: number };

/**
 * Produce a curve by positioning handles, rather than drawing it freehand.
 *
 * Freehand is the obvious reading of "sketch the graph" and the wrong control
 * for a graded one. Capturing a finger-drawn line and fitting an equation to it
 * needs a tolerance loose enough to accept a wobbly parabola and tight enough
 * to reject the wrong one — and there is no such tolerance, so the grader ends
 * up feeling arbitrary exactly when the student was right.
 *
 * Handles keep the skill (you must know where the curve goes) and make grading
 * exact: they snap to the lattice, so a correctly placed curve reproduces the
 * target's coefficients rather than approximating them.
 */
export function GraphSketchInput({
  svg,
  window: win,
  kind,
  handles,
  onMove,
  disabled,
  solutionSvg,
}: {
  svg: string;
  window: PlotWindow;
  /** Which family the student is positioning; set by the problem. */
  kind: SketchKind;
  handles: Handle[];
  onMove: (index: number, next: Handle) => void;
  disabled: boolean;
  /** Once graded, a plot with the correct curve drawn on it. */
  solutionSvg?: string;
}) {
  const g = useMemo(() => plotGeometry(win), [win]);
  const coarse = useCoarsePointer();
  const [dragging, setDragging] = useState<number | null>(null);
  /** Which pointer owns the drag, so a second finger can't hijack it. */
  const activePointer = useRef<number | null>(null);

  function endDrag() {
    activePointer.current = null;
    setDragging(null);
  }

  const curve = curveFromHandles(kind, handles);
  const labels = HANDLE_LABELS[kind];

  /** Pointer position -> lattice coordinate, via the SVG's own viewBox. */
  function pointAt(e: React.PointerEvent<SVGSVGElement>): Handle | null {
    const svgEl = e.currentTarget;
    const rect = svgEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    // The viewBox letterboxes inside the element, so map through it rather than
    // assuming the element and the viewBox share an aspect ratio.
    const scale = Math.min(rect.width / PLOT_W, rect.height / PLOT_H);
    const offsetX = (rect.width - PLOT_W * scale) / 2;
    const offsetY = (rect.height - PLOT_H * scale) / 2;
    const px = (e.clientX - rect.left - offsetX) / scale;
    const py = (e.clientY - rect.top - offsetY) / scale;
    return g.snap(g.toMathX(px), g.toMathY(py));
  }

  function nudge(i: number, dx: number, dy: number) {
    const h = handles[i];
    onMove(i, g.snap(h.x + dx, h.y + dy));
  }

  const path = curve ? curvePathFor(curve, win, g) : "";

  return (
    <div className="mt-8">
      <p className="mono-meta mb-3">
        {solutionSvg ? "Your curve" : `Position the ${labels.length} handles`}
      </p>

      {/* Full-bleed on a phone, same as graph-points: the handles and the curve
          are both easier to place with 48px more to place them in. */}
      <div className="relative -mx-6 overflow-hidden border-y border-line bg-surface sm:mx-0 sm:rounded-[3px] sm:border-x">
        {/* Not `aria-hidden` — see the same note in `graph-points.tsx`. The
            plot describes the axes and any reference curve; the handles below
            describe the controls. */}
        <div className="[&>svg]:block" dangerouslySetInnerHTML={{ __html: svg }} />

        <svg
          viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
          preserveAspectRatio="xMidYMid meet"
          role="group"
          aria-label="Curve handles"
          // `touch-none` only while a drag is live. Left on permanently — as it
          // was — the overlay covers the whole plot, so a finger put down
          // anywhere on a ~350×260 band of the screen to scroll past the graph
          // did nothing, and the page read as frozen.
          className={`absolute inset-0 h-full w-full ${dragging !== null ? "touch-none" : ""}`}
          onPointerMove={(e) => {
            if (dragging === null || disabled) return;
            // A second finger landing mid-drag would otherwise steer the handle.
            if (activePointer.current !== null && e.pointerId !== activePointer.current) return;
            const p = pointAt(e);
            if (p) onMove(dragging, p);
          }}
          onPointerUp={endDrag}
          // `pointercancel` fires — and `pointerup` does not — when the OS takes
          // the touch away for an edge swipe, a notification, a call. Without
          // this the drag stayed latched, and the next finger that crossed the
          // plot moved a handle with nothing pressed.
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
        >
          {path && (
            <path
              d={path}
              fill="none"
              stroke="var(--fg)"
              // 2 viewBox units is 1.3 CSS px once this plot is scaled to a
              // phone, with the dashes narrower still — the student's own curve
              // was the faintest thing on screen while they positioned it.
              strokeWidth={coarse ? 3 : 2}
              strokeDasharray="5 3"
              strokeLinecap="round"
            />
          )}

          {handles.map((h, i) => (
            <g key={i}>
              <circle
                cx={g.toPxX(h.x)}
                cy={g.toPxY(h.y)}
                r={coarse ? 10 : 7}
                fill="var(--paper)"
                stroke="var(--fg)"
                strokeWidth={2}
              />
              <circle
                cx={g.toPxX(h.x)}
                cy={g.toPxY(h.y)}
                // Generous on touch in a way the point lattice cannot be: there
                // are two handles and they are normally far apart, and if they
                // do coincide `curveFromHandles` returns null, so the worst case
                // is an inert submit button rather than a wrong answer.
                r={coarse ? 30 : 13}
                fill="transparent"
                tabIndex={disabled ? -1 : 0}
                role="slider"
                aria-label={`${labels[i]} handle`}
                aria-valuetext={`${h.x}, ${h.y}`}
                aria-valuenow={h.x}
                className="cursor-grab touch-none outline-none focus-visible:stroke-[var(--accent)] focus-visible:[stroke-width:2]"
                onPointerDown={(e) => {
                  if (disabled) return;
                  // Capture on the SVG, not the handle. The move handler lives
                  // on the SVG, and without capture a thumb that leaves the
                  // ~260px-tall plot dropped the drag mid-placement — silently,
                  // with the handle left wherever the edge happened to be.
                  e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId);
                  activePointer.current = e.pointerId;
                  setDragging(i);
                }}
                onKeyDown={(e) => {
                  if (disabled) return;
                  const step =
                    e.key === "ArrowLeft" ? [-1, 0]
                    : e.key === "ArrowRight" ? [1, 0]
                    : e.key === "ArrowUp" ? [0, 1]
                    : e.key === "ArrowDown" ? [0, -1]
                    : null;
                  if (!step) return;
                  e.preventDefault();
                  // The practice engine pages through the set on Left/Right.
                  // Without this the handle moved *and* the page turned, which
                  // threw the sketch away mid-answer — so the keyboard route
                  // this control advertises could never place a point.
                  e.stopPropagation();
                  nudge(i, step[0], step[1]);
                }}
              />
            </g>
          ))}
        </svg>
      </div>

      <p className="mono-meta mt-3">
        {handles.map((h, i) => `${labels[i]} (${h.x}, ${h.y})`).join("   ")}
        {/* The arrow-key route is not worth naming to someone holding a phone. */}
        {!disabled && (coarse ? "  ·  drag a handle" : "  ·  drag, or focus a handle and use the arrow keys")}
      </p>

      {solutionSvg && (
        <div className="mt-6">
          <p className="mono-meta mb-3 flex items-center gap-1.5 text-ok">
            <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden />
            The correct curve
          </p>
          <div
            className="-mx-6 overflow-hidden border-y border-line bg-surface sm:mx-0 sm:rounded-[3px] sm:border-x [&>svg]:block"
            dangerouslySetInnerHTML={{ __html: solutionSvg }}
          />
        </div>
      )}
    </div>
  );
}

const HANDLE_LABELS: Record<SketchKind, string[]> = {
  linear: ["First point", "Second point"],
  quadratic: ["Vertex", "Second point"],
  abs: ["Vertex", "Second point"],
};

/** Where the handles start, before the student moves them. */
export function defaultHandles(kind: SketchKind, w: PlotWindow): Handle[] {
  const midX = Math.round((w.xMin + w.xMax) / 2);
  const midY = Math.round((w.yMin + w.yMax) / 2);
  const offset = Math.max(1, Math.round((w.xMax - w.xMin) / 6));
  return kind === "linear"
    ? [
        { x: midX - offset, y: midY },
        { x: midX + offset, y: midY },
      ]
    : [
        { x: midX, y: midY },
        { x: midX + offset, y: midY + offset },
      ];
}

/**
 * Handles -> curve, in the same coefficient convention the answer key uses.
 *
 * Exported because the grading payload is the curve, not the handle positions:
 * two handle placements can describe the same line, and the student should not
 * be marked on which pair they happened to pick.
 */
export function curveFromHandles(kind: SketchKind, h: Handle[]): PlotCurve | null {
  if (kind === "linear") {
    const [p, q] = h;
    if (!p || !q || p.x === q.x) return null; // vertical is not a function
    const m = (q.y - p.y) / (q.x - p.x);
    return { kind: "linear", m, b: p.y - m * p.x };
  }
  const [vertex, other] = h;
  if (!vertex || !other || other.x === vertex.x) return null;
  if (kind === "abs") {
    const a = (other.y - vertex.y) / Math.abs(other.x - vertex.x);
    return { kind: "abs", a, h: vertex.x, k: vertex.y };
  }
  // Vertex form a(x-h)^2 + k, expanded to the stored ax^2+bx+c convention.
  const a = (other.y - vertex.y) / Math.pow(other.x - vertex.x, 2);
  return {
    kind: "quadratic",
    a,
    b: -2 * a * vertex.x,
    c: a * vertex.x * vertex.x + vertex.y,
  };
}

/** Same sampling rule as the server renderer, so the preview matches the key. */
function curvePathFor(
  c: PlotCurve,
  w: PlotWindow,
  g: ReturnType<typeof plotGeometry>
): string {
  const SAMPLES = 160;
  const spanY = w.yMax - w.yMin;
  const segments: string[] = [];
  let current: string[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const x = w.xMin + ((w.xMax - w.xMin) * i) / SAMPLES;
    const y = evalCurve(c, x);
    if (y === null || !Number.isFinite(y) || y < w.yMin - spanY || y > w.yMax + spanY) {
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
