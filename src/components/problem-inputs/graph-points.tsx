"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Check, X } from "lucide-react";
import { plotGeometry, PLOT_H, PLOT_W, type PlotWindow } from "@/lib/plot";

export type Point = { x: number; y: number };

const key = (p: Point) => `${p.x},${p.y}`;

/**
 * Select points on a plot.
 *
 * Selection snaps to integer coordinates, which is what makes the answer
 * gradeable at all: a raw click is a float nobody could reproduce, so "the
 * vertex" would be unanswerable no matter how well the student understood it.
 * `structuralCheck` refuses non-integer keys for the same reason.
 *
 * The lattice is real focusable buttons rather than a click surface, so the
 * whole thing is reachable by keyboard and every candidate point is announced
 * with its coordinates.
 */
export function GraphPointsInput({
  svg,
  window: win,
  selected,
  onToggle,
  disabled,
  graded,
}: {
  /** Server-rendered plot; this component never draws the curves itself. */
  svg: string;
  window: PlotWindow;
  selected: Point[];
  onToggle: (p: Point) => void;
  disabled: boolean;
  /** Once graded, the points that should have been selected. */
  graded?: Point[];
}) {
  const [hover, setHover] = useState<string | null>(null);
  const g = useMemo(() => plotGeometry(win), [win]);

  // One button per lattice point. Capped so a wide window degrades to a
  // coarser grid rather than rendering thousands of targets.
  const lattice = useMemo(() => {
    const out: Point[] = [];
    const stepX = Math.max(1, Math.ceil((win.xMax - win.xMin) / 24));
    const stepY = Math.max(1, Math.ceil((win.yMax - win.yMin) / 24));
    for (let x = Math.ceil(win.xMin); x <= win.xMax; x += stepX) {
      for (let y = Math.ceil(win.yMin); y <= win.yMax; y += stepY) {
        out.push({ x, y });
      }
    }
    return out;
  }, [win]);

  const picked = new Set(selected.map(key));
  const truth = graded ? new Set(graded.map(key)) : null;

  return (
    <div className="mt-8">
      <p className="mono-meta mb-3">
        {truth ? "Your selection" : "Click the points being asked for"}
      </p>

      <div className="relative overflow-hidden rounded-[3px] border border-line bg-surface">
        {/* Not `aria-hidden`. The server-rendered plot carries its own
            `role="img"` and a description of the curve and axes — the stimulus
            — while the overlay below names the controls. They describe
            different things, so hiding this one left a screen-reader user able
            to pick points on a graph nobody had described to them. */}
        <div className="[&>svg]:block" dangerouslySetInnerHTML={{ __html: svg }} />

        <svg
          viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 h-full w-full"
          role="group"
          aria-label="Selectable points"
        >
          {lattice.map((p) => {
            const k = key(p);
            const isPicked = picked.has(k);
            const isTruth = truth?.has(k) ?? false;
            const state = !truth
              ? null
              : isTruth && isPicked
                ? "got"
                : isTruth
                  ? "missed"
                  : isPicked
                    ? "wrong"
                    : null;

            // Unselected points stay nearly invisible until hovered or focused;
            // drawing every candidate at full strength would bury the curve
            // under its own coordinate grid.
            const visible = isPicked || state !== null || hover === k;

            return (
              <g key={k}>
                <circle
                  cx={g.toPxX(p.x)}
                  cy={g.toPxY(p.y)}
                  r={visible ? 5 : 3}
                  className={clsx(
                    "transition-all",
                    state === "got" && "fill-[var(--ok)]",
                    state === "wrong" && "fill-[var(--bad)]",
                    state === "missed" && "fill-none stroke-[var(--ok)] [stroke-dasharray:3_2]",
                    !state && isPicked && "fill-[var(--accent-solid)]",
                    !state && !isPicked && "fill-[var(--fg-faint)]"
                  )}
                  opacity={visible ? 1 : 0.18}
                  strokeWidth={1.5}
                />
                {!disabled && (
                  <circle
                    cx={g.toPxX(p.x)}
                    cy={g.toPxY(p.y)}
                    r={9}
                    fill="transparent"
                    tabIndex={0}
                    role="button"
                    aria-pressed={isPicked}
                    aria-label={`Point ${p.x}, ${p.y}`}
                    className="cursor-pointer outline-none focus-visible:stroke-[var(--accent)] focus-visible:[stroke-width:2]"
                    onMouseEnter={() => setHover(k)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(k)}
                    onBlur={() => setHover(null)}
                    onClick={() => onToggle(p)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onToggle(p);
                      }
                    }}
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Coordinates in text, so the selection is legible without reading pixels
          — and so a screen reader user has the answer stated, not just plotted. */}
      <p className="mono-meta mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          Selected:{" "}
          {selected.length > 0
            ? selected.map((p) => `(${p.x}, ${p.y})`).join("  ")
            : "none yet"}
        </span>
        {truth && (
          <span className="flex items-center gap-1.5 text-ok">
            <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden />
            Answer: {graded!.map((p) => `(${p.x}, ${p.y})`).join("  ")}
          </span>
        )}
        {truth && selected.some((p) => !truth.has(key(p))) && (
          <span className="flex items-center gap-1.5 text-bad">
            <X className="h-3 w-3" strokeWidth={2.5} aria-hidden />
            Some picks were wrong
          </span>
        )}
      </p>
    </div>
  );
}
