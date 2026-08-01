import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://lemma.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Owner-scoped and auth-gated; nothing there is crawlable anyway.
      disallow: ["/api/", "/set/", "/auth/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
