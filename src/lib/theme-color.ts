/**
 * The colour the browser paints its own chrome, in both themes.
 *
 * Shared because two files need it and they were disagreeing: the layout's
 * `viewport.themeColor` said paper, the web manifest's `theme_color` said
 * oxblood, and in a standalone install those paint adjacent surfaces — the
 * status bar directly against the page. One constant makes that agreement
 * structural instead of something a test has to keep catching.
 *
 * A manifest carries a single `theme_color` with no media query, so it takes
 * the light value; a browser in dark mode overrides it from the meta tag.
 */
export const THEME_COLORS = {
  light: "#faf7f0",
  dark: "#0e0c0a",
} as const;
