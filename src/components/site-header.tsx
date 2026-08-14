"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthButton } from "@/components/auth-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/brand";
import { SessionChip } from "@/components/stats/session-chip";
// Shared with the phone tab bar, which has to gate on account exactly the way
// this does. Two copies of the list would drift silently, and only on a phone.
import { NAV } from "@/lib/nav";
import type { HeaderUser } from "@/lib/auth-server";

export function SiteHeader({
  user,
  sessionStartedAt,
}: {
  user: HeaderUser;
  /** Set only while a study session is running. */
  sessionStartedAt?: string | null;
}) {
  const pathname = usePathname();
  const nav = NAV.filter((item) => !item.requiresAccount || (user && !user.isGuest));

  return (
    <header
      // Named so view transitions can pin it: the content moves, the
      // header stays put, and the reader keeps a fixed spatial anchor.
      style={{ viewTransitionName: "site-header" }}
      className="site-header sticky top-0 z-30 border-b border-line bg-paper/80 backdrop-blur-md backdrop-saturate-150"
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <div className="flex items-center gap-7 sm:gap-9">
          <Link
            href="/"
            aria-label="lemma — home"
            transitionTypes={["nav-back"]}
            className="text-[22px] transition-opacity hover:opacity-80"
          >
            <Wordmark />
          </Link>
          {/* Gone below `md`, where MobileTabBar carries it instead. The
              breakpoint is 768 rather than this repo's habitual 640: the row
              needs ~520px of min-content, and at 640 the ~80px of slack left
              over is eaten by the widest signed-in state — a display name
              beside the sign-out control. */}
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {nav.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  transitionTypes={["nav-lateral"]}
                  className={`relative rounded-sm px-2.5 py-1.5 text-sm transition-colors ${
                    active ? "text-fg" : "text-muted hover:text-fg"
                  }`}
                >
                  {item.label}
                  <span
                    aria-hidden
                    className={`absolute inset-x-2.5 -bottom-px h-px origin-left bg-accent transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                      active ? "scale-x-100" : "scale-x-0"
                    }`}
                  />
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {sessionStartedAt && <SessionChip startedAt={sessionStartedAt} />}
          <ThemeToggle />
          {/* Sign-in returns to whatever the reader was on, except /signin
              itself — coming back to the sign-in page reads as a failure. */}
          <AuthButton user={user} next={pathname === "/signin" ? "/" : pathname} />
        </div>
      </div>
    </header>
  );
}
