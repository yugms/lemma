import type { NextConfig } from "next";

/**
 * Headers that are the same for every request.
 *
 * The Content-Security-Policy is deliberately *not* here — it carries a
 * per-request nonce, so it is built in `src/proxy.ts` instead. Everything below
 * is static, which is why it can live in config and cover static assets too.
 */
const SECURITY_HEADERS = [
  // Two years, preloadable. Vercel serves HTTPS only, so there is no
  // plain-http origin this can strand.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Stops a browser second-guessing a declared Content-Type, which is how a
  // user-uploaded file gets treated as a script.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // `frame-ancestors 'none'` in the CSP is the modern form of this; kept for
  // browsers that predate it.
  { key: "X-Frame-Options", value: "DENY" },
  // Send the origin cross-site, the full path same-site. Set ids live in URLs
  // here, so a full referrer would leak them to anywhere a student navigates.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app asks for none of these. Scanning uploads a file through an
  // <input type="file">, which needs no camera permission.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // Severs the window reference a cross-origin opener would otherwise keep.
  // Safe here only because Google sign-in is a full-page redirect — adding
  // `skipBrowserRedirect` to signInWithOAuth would turn it into a popup and
  // this would break the callback.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,

  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      /**
       * Every API response here is per-user — a grade, a set, a scan result —
       * and none of them set `Cache-Control` themselves, so they inherited
       * whatever a CDN chose to assume. Declared once at the route prefix
       * rather than on ~25 `Response.json` calls, which also covers routes
       * added later. The SSE route restates it on its own response.
       */
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },

  experimental: {
    // React <ViewTransition>: directional route animation without an
    // animation runtime on the client.
    viewTransition: true,
    // Barrel-file elision so importing three icons doesn't pull the set.
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
