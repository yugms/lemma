/**
 * The primary routes, and which of them hide the bottom bar.
 *
 * This exists so the header nav and the phone tab bar read from one list. Two
 * copies would drift on the day a route is added, and the failure is silent
 * and one-sided: the route stays reachable on a laptop and is simply missing
 * on a phone, where there is no other way to get to it.
 */
export const NAV = [
  { href: "/build", label: "Build", requiresAccount: false },
  { href: "/sets", label: "Sets", requiresAccount: false },
  // Both are derived from an account's history, so a guest has nothing to see.
  { href: "/review", label: "Review", requiresAccount: true },
  { href: "/stats", label: "Stats", requiresAccount: true },
] as const;

export type NavItem = (typeof NAV)[number];

/**
 * Routes that run their own bottom action bar.
 *
 * Two fixed bars stacked on a phone is worse than neither, and these are the
 * routes where the second one earns its place — answering a problem, marking
 * a page. `/print` is here for a different reason: its whole output is paper,
 * and navigation on a worksheet is only discovered once the sheet is handed
 * out.
 */
const IMMERSIVE = /^\/set\/[^/]+\/(practice|quiz|flashcards|scan|print)\/?$/;

export const hidesTabBar = (pathname: string) => IMMERSIVE.test(pathname);
