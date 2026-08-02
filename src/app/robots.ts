import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Owner-scoped and auth-gated; nothing there is crawlable anyway.
      // /account holds a signed-in user's data controls, and /signin is a
      // redirect target — neither is a useful search result.
      disallow: ["/api/", "/set/", "/auth/", "/account", "/signin"],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
