import type { Metadata, Viewport } from "next";
import { ViewTransition } from "react";
import { headers } from "next/headers";
import Link from "next/link";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import { THEME_SCRIPT } from "@/components/theme-toggle";
import { Wordmark } from "@/components/brand";
import { getCurrentUser, toHeaderUser } from "@/lib/auth-server";
import { loadActiveSession } from "@/lib/study-session";
import { siteUrl } from "@/lib/env";
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

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "lemma — math practice, generated for you",
    template: "%s · lemma",
  },
  description:
    "Build custom math problem sets by course, topic, and difficulty. Every problem is solved independently by a second model before it reaches you, and comes with a step-by-step solution.",
  applicationName: "lemma",
  keywords: [
    "math practice",
    "problem sets",
    "algebra",
    "calculus",
    "worked solutions",
  ],
  openGraph: {
    type: "website",
    siteName: "lemma",
    title: "lemma — math practice, generated for you",
    description:
      "Problem sets built to order. Pick the topic, difficulty and style; every problem is independently verified.",
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "lemma — math practice, generated for you",
    description:
      "Problem sets built to order. Every problem independently verified.",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf7f0" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0c0a" },
  ],
  colorScheme: "light dark",
};

const FOOTER_LINKS = [
  { href: "/build", label: "Build a set" },
  { href: "/sets", label: "My sets" },
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
      </head>
      <body className="flex min-h-full flex-col">
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
            <nav aria-label="Footer" className="flex items-center gap-6">
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
      </body>
    </html>
  );
}
