"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Check, X } from "lucide-react";
import { plotGeometry, PLOT_H, PLOT_W, type PlotWindow } from "@/lib/plot";
import { useCoarsePointer } from "@/lib/use-coarse-pointer";

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
  const coarse = useCoarsePointer();
  const g = useMemo(() => plotGeometry(win), [win]);

  // One button per lattice point. Capped so a wide window degrades to a
  // coarser grid rather than rendering thousands of targets.
  const { lattice, hitR } = useMemo(() => {
    const out: Point[] = [];
    const stepX = Math.max(1, Math.ceil((win.xMax - win.xMin) / 24));
    const stepY = Math.max(1, Math.ceil((win.yMax - win.yMin) / 24));
    for (let x = Math.ceil(win.xMin); x <= win.xMax; x += stepX) {
      for (let y = Math.ceil(win.yMin); y <= win.yMax; y += stepY) {
        out.push({ x, y });
      }
    }

    /**
     * The hit radius is derived from the lattice pitch rather than being a
     * constant, and the pitch is the hard ceiling here — a 44px target is
     * arithmetically impossible. At 390px this plot draws about 350 CSS px
     * wide, so a typical -10..10 window puts neighbouring points ~16 CSS px
     * apart; anything past 45% of that overlaps the point next door, and an
     * ambiguous tap on a graded answer is worse than a small one. Coarsening
     * the lattice would buy room by *removing selectable answers*, which is a
     * grading bug, so it stays.
     */
    const gm = plotGeometry(win);
    const pitch = Math.min(
      Math.abs(gm.toPxX(win.xMin + stepX) - gm.toPxX(win.xMin)),
      Math.abs(gm.toPxY(win.yMin + stepY) - gm.toPxY(win.yMin))
    );
    return { lattice: out, hitR: Math.min(coarse ? 22 : 9, pitch * 0.45) };
  }, [win, coarse]);

  const picked = new Set(selected.map(key));
  const truth = graded ? new Set(graded.map(key)) : null;

  return (
    <div className="mt-8">
      <p className="mono-meta mb-3">
        {truth ? "Your selection" : "Click the points being asked for"}
      </p>

      {/* Full-bleed against the card's `p-6` on a phone. 48px of extra width
          is 14% more space between lattice points, which is the only lever
          that makes the targets bigger without making them ambiguous. */}
      <div className="relative -mx-6 overflow-hidden border-y border-line bg-surface sm:mx-0 sm:rounded-[3px] sm:border-x">
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
            //
            // That reasoning holds only where there is a hover to reveal them
            // with. On touch there is none, so the fallback state *is* the
            // state — the prompt said "click the points being asked for" over
            // a plot that, at 18% opacity and r=3, rendered as blank paper.
            // Drawn stronger there, still below the curve's weight.
            const visible = isPicked || state !== null || hover === k;

            return (
              <g key={k}>
                <circle
                  cx={g.toPxX(p.x)}
                  cy={g.toPxY(p.y)}
                  r={visible ? 5 : coarse ? 4 : 3}
                  className={clsx(
                    "transition-all",
                    state === "got" && "fill-[var(--ok)]",
                    state === "wrong" && "fill-[var(--bad)]",
                    state === "missed" && "fill-none stroke-[var(--ok)] [stroke-dasharray:3_2]",
                    !state && isPicked && "fill-[var(--accent-solid)]",
                    !state && !isPicked && "fill-[var(--fg-faint)]"
                  )}
                  opacity={visible ? 1 : coarse ? 0.42 : 0.18}
                  strokeWidth={1.5}
                />
                {!disabled && (
                  <circle
                    cx={g.toPxX(p.x)}
                    cy={g.toPxY(p.y)}
                    r={hitR}
                    fill="transparent"
                    tabIndex={0}
                    role="button"
                    aria-pressed={isPicked}
                    aria-label={`Point ${p.x}, ${p.y}`}
                    // `touch-none` on the targets only, never on the overlay:
                    // put it on the full-size SVG and the whole plot becomes a
                    // band of screen that refuses to scroll.
                    className="cursor-pointer touch-none outline-none focus-visible:stroke-[var(--accent)] focus-visible:[stroke-width:2]"
                    onPointerEnter={() => setHover(k)}
                    onPointerLeave={() => setHover(null)}
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
          — and so a screen reader user has the answer stated, not just plotted.

          Each one is also a button while the problem is live. The lattice pitch
          caps a target at about 14px on a phone, so a mis-tap is likely; undoing
          it by hitting the same 14px target again is the part that would make
          this format miserable. Here the thing you just selected is a full-size
          control, and it names itself. */}
      <p className="mono-meta mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          Selected:{" "}
          {selected.length === 0 && "none yet"}
          {selected.map((p) =>
            disabled ? (
              <span key={key(p)}>{`(${p.x}, ${p.y})`}</span>
            ) : (
              <button
                key={key(p)}
                type="button"
                onClick={() => onToggle(p)}
                aria-label={`Remove point ${p.x}, ${p.y}`}
                className="chip gap-1 py-1 font-mono text-[11px] tracking-normal"
              >
                {`(${p.x}, ${p.y})`}
                <X className="h-3 w-3" aria-hidden />
              </button>
            )
          )}
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
