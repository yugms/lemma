import type { Metadata, Viewport } from "next";
import { ViewTransition } from "react";
import { headers } from "next/headers";
import Link from "next/link";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { THEME_SCRIPT } from "@/components/theme-toggle";
import { Wordmark } from "@/components/brand";
import { JsonLd, siteGraph } from "@/components/json-ld";
import { getCurrentUser, toHeaderUser } from "@/lib/auth-server";
import { loadActiveSession } from "@/lib/study-session";
import { siteUrl } from "@/lib/env";
// Shared with manifest.ts: in standalone these paint adjacent surfaces, and
// they used to disagree.
import { THEME_COLORS } from "@/lib/theme-color";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

/** Metadata, counters and numeric readouts only — never body copy. */
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

/**
 * Display face, variable across optical size so the hero can be set with true
 * display optics while small headings stay sober. See the .display* classes
 * in globals.css.
 *
 * `opsz` only: adding Fraunces' SOFT and WONK axes measured at 118 kB for the
 * latin subset versus 66 kB without them. Optical sizing is the axis doing
 * real typographic work; the other two are flourishes not worth 52 kB.
 */
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
});

const SITE_URL = siteUrl();

const SITE_DESCRIPTION =
  "Build custom math problem sets by course, topic, and difficulty. Every problem is solved independently by a second model before it reaches you, and comes with a step-by-step solution.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "lemma — math practice, generated for you",
    template: "%s · lemma",
  },
  description: SITE_DESCRIPTION,
  applicationName: "lemma",
  keywords: [
    "math practice",
    "problem sets",
    "algebra",
    "calculus",
    "worked solutions",
  ],
  // Relative, so Next resolves it against metadataBase per route rather than
  // pinning every page's canonical to the homepage.
  alternates: { canonical: "./" },
  openGraph: {
    type: "website",
    siteName: "lemma",
    title: "lemma — math practice, generated for you",
    description:
      "Problem sets built to order. Pick the topic, difficulty and style; every problem is independently verified.",
    // Relative for the same reason as the canonical above. Absolute here meant
    // every page shared the homepage's og:url, so a link to /build previewed as
    // a link to the site root.
    url: "./",
  },
  twitter: {
    card: "summary_large_image",
    title: "lemma — math practice, generated for you",
    description:
      "Problem sets built to order. Every problem independently verified.",
  },
};

/**
 * `width=device-width, initial-scale=1` is Next's own default and is left
 * alone; `maximumScale` / `userScalable` are deliberately *not* set, because
 * blocking pinch-zoom is an accessibility failure and the layout no longer
 * needs it.
 *
 * The two additions both do real work:
 *
 * `viewportFit: "cover"` is what makes `env(safe-area-inset-*)` resolve to
 * anything at all. Without it every safe-area rule in globals.css silently
 * evaluates to 0 — the tab bar sits under the home indicator and the header
 * under the notch, with nothing in the CSS to suggest why.
 *
 * `interactiveWidget: "resizes-content"` shrinks the *layout* viewport when
 * the soft keyboard opens, which is what puts a sticky bottom bar above the
 * keyboard rather than behind it. Chrome-on-Android honours it; iOS Safari
 * does not, which is why the answer controls sit next to the field rather
 * than relying on this alone. It reflows on every keyboard open, and the one
 * `100vh` in the app (global-error.tsx) is a page with no inputs, so that
 * costs nothing here.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
  colorScheme: "light dark",
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

const FOOTER_LINKS = [
  { href: "/build", label: "Build a set" },
  { href: "/sets", label: "My sets" },
  // /account is here as well as under your own name in the header: the privacy
  // policy promises deletion controls, and a promise that depends on finding an
  // unlabelled control is not much of one.
  { href: "/account", label: "Your data" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Deduped with the pages' own lookups by React `cache`, so the header
  // costs no extra auth round-trip.
  const authUser = await getCurrentUser();
  const user = toHeaderUser(authUser);

  // Set by the proxy, which is also what puts it in the CSP header.
  const nonce = (await headers()).get("x-nonce");

  // A running study session shows on every page, so the lookup lives here.
  // Guests don't get sessions, which also keeps this off the common path.
  const session =
    authUser && !authUser.is_anonymous ? await loadActiveSession(authUser.id) : null;

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <head>
        {/* Applies the stored theme before first paint. Next stamps its own
            scripts with the nonce automatically, but this one is ours, so it
            has to be tagged by hand or the CSP blocks it — and a blocked theme
            script means a flash of the wrong theme on every load. */}
        <script nonce={nonce ?? undefined} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <JsonLd data={siteGraph(SITE_URL, SITE_DESCRIPTION)} nonce={nonce} />
      </head>
      {/* `dvh` rather than `min-h-full`: on a phone the browser's own chrome
          collapses as you scroll, and a viewport-height unit that ignores it
          leaves the footer floating short of the bottom. */}
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only z-50 focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:rounded-[3px] focus:bg-accent-solid focus:px-4 focus:py-2 focus:text-sm focus:text-accent-on"
        >
          Skip to content
        </a>

        <SiteHeader user={user} sessionStartedAt={session?.startedAt ?? null} />

        <main
          id="main"
          tabIndex={-1}
          className="above-grain mx-auto w-full max-w-6xl flex-1 px-5 py-12 sm:px-8 sm:py-16"
        >
          {/* Direction encodes history: going deeper slides left, coming back
              slides right, lateral moves just crossfade. Links opt in with
              `transitionTypes`; anything untagged (a fresh load, the browser
              back button) simply cuts. */}
          <ViewTransition
            enter={{
              "nav-forward": "nav-forward",
              "nav-back": "nav-back",
              "nav-lateral": "nav-lateral",
              default: "none",
            }}
            exit={{
              "nav-forward": "nav-forward",
              "nav-back": "nav-back",
              "nav-lateral": "nav-lateral",
              default: "none",
            }}
            default="none"
          >
            {children}
          </ViewTransition>
        </main>

        <footer className="above-grain mt-8 border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-5 px-5 py-9 sm:px-8">
            <div>
              <Link href="/" className="text-lg">
                <Wordmark />
              </Link>
              <p className="eyebrow mt-2.5">
                Every problem independently verified
              </p>
            </div>
            <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6 gap-y-2">
              {FOOTER_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  transitionTypes={["nav-lateral"]}
                  className="text-sm text-muted transition-colors hover:text-accent"
                >
                  {l.label}
                </Link>
              ))}
            </nav>
          </div>
        </footer>

        {/* After the footer on purpose: the spacer it renders adds its height
            at the end of the document, which is what lets the footer scroll
            clear of a fixed bar without <main> or the footer knowing the bar
            is there. */}
        <MobileTabBar user={user} />
      </body>
    </html>
  );
}
