"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Layers, RotateCcw, Sparkles, type LucideIcon } from "lucide-react";
import { hidesTabBar, NAV } from "@/lib/nav";
import type { HeaderUser } from "@/lib/auth-server";

/**
 * Keyed by href rather than positional, so adding a NAV entry without an icon
 * is a compile error rather than a blank tab — the same guide-rail idea as
 * `assertNeverFormat`, applied to navigation.
 */
const ICONS: Record<(typeof NAV)[number]["href"], LucideIcon> = {
  "/build": Sparkles,
  "/sets": Layers,
  "/review": RotateCcw,
  "/stats": BarChart3,
};

/**
 * Primary navigation on a phone.
 *
 * The header could not hold it: at 390px it needed about 520px of
 * min-content — a wordmark, four links, a three-key theme toggle and an auth
 * control on one non-wrapping row — so every route scrolled sideways before
 * a word of it was read.
 *
 * Which route is showing is read from `usePathname()` rather than threaded
 * down from the layout. The layout does not re-render on a soft navigation
 * within the same segment, so a pathname passed as a prop would be stale the
 * moment someone navigated from /sets into a practice run — and the bar would
 * stay up over the one screen it must not cover, or print on a worksheet.
 */
export function MobileTabBar({ user }: { user: HeaderUser }) {
  const pathname = usePathname();
  if (hidesTabBar(pathname)) return null;

  const items = NAV.filter((item) => !item.requiresAccount || (user && !user.isGuest));

  return (
    <>
      {/* Renders after the footer, so the height it adds is at the very end of
          the document — which is what lets the footer scroll clear of a fixed
          bar without `<main>` or the footer knowing the bar exists. It goes
          away with the bar, so an immersive route has no dead space to
          compensate for. */}
      <div aria-hidden className="mobile-tabs-spacer" />

      <nav
        aria-label="Primary"
        // Pinned like the site header: a fixed element caught in the root view
        // transition snapshot slides across the screen on every navigation.
        style={{ viewTransitionName: "mobile-tabs" }}
        className="mobile-tabs"
      >
        {items.map((item) => {
          const Icon = ICONS[item.href];
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              transitionTypes={["nav-lateral"]}
            >
              <Icon className="h-5 w-5" strokeWidth={active ? 2 : 1.6} aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
