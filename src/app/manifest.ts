import type { MetadataRoute } from "next";
import { THEME_COLORS } from "@/lib/theme-color";

/**
 * What the OS is told when someone installs this to a home screen.
 *
 * Three of these look optional and are not. `id` is the install's permanent
 * identity — without it the browser derives one from `start_url`, so changing
 * the landing route later would register a second app beside the first rather
 * than updating it. `scope` decides which links open inside the installed
 * window; unset, it is inferred from `start_url`, which happens to be right
 * today and would quietly stop being right the moment `start_url` moves.
 *
 * `theme_color` was oxblood while `viewport.themeColor` in layout.tsx is the
 * paper tone, and the two paint adjacent surfaces in standalone mode — the
 * status bar against the page. Both now read `THEME_COLORS`, so the agreement
 * is structural rather than something a reviewer has to notice.
 *
 * No `orientation`: the graph inputs and /print are the widest content in the
 * app, and landscape is the only way a phone reaches ~800 CSS px. Locking to
 * portrait would take that away to buy nothing.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "lemma — math practice, generated for you",
    short_name: "lemma",
    description:
      "Build custom math problem sets by course, topic, and difficulty. Every problem is independently verified.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: THEME_COLORS.light,
    theme_color: THEME_COLORS.light,
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/apple-icon", type: "image/png", sizes: "180x180" },
      // Android's install prompt wants a 192 and a 512 raster; without both it
      // falls back to a screenshot of the page for the home-screen icon.
      { src: "/icon-192", type: "image/png", sizes: "192x192", purpose: "any" },
      { src: "/icon-512", type: "image/png", sizes: "512x512", purpose: "any" },
      { src: "/icon-512", type: "image/png", sizes: "512x512", purpose: "maskable" },
    ],
  };
}
