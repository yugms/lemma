"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the primary pointer is a finger.
 *
 * The graph overlays need this in JavaScript, not only in CSS: the hit radii
 * are SVG geometry attributes computed from the plot window, so there is no
 * class to swap. Everything else that varies by pointer type is a
 * `pointer-coarse:` utility and should stay one.
 *
 * `matchMedia` is external state, so it is read through `useSyncExternalStore`
 * rather than mirrored into an effect — the same shape as the theme store in
 * `theme-toggle.tsx`, and for the same two reasons: `react-hooks/purity`
 * forbids reading it during render, and `react-hooks/set-state-in-effect`
 * forbids the obvious effect-and-setState version.
 *
 * The MediaQueryList is module-scope and made once, so `getSnapshot` returns a
 * stable boolean rather than a fresh object every render.
 */
let mql: MediaQueryList | null = null;
const query = () => (mql ??= window.matchMedia("(pointer: coarse)"));

function subscribe(onChange: () => void) {
  const m = query();
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
}

const getSnapshot = () => query().matches;

/** No matchMedia on the server, and none during the first client render. */
const getServerSnapshot = () => false;

export const useCoarsePointer = () =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
