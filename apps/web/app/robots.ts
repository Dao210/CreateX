import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/brand";

export default function robots(): MetadataRoute.Robots {
  return {
    // Page routes must remain crawlable so their noindex metadata can be read.
    // Blocking them here can leave discovered URLs indexed without a snippet.
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/v1/", "/uploads/", "/ws$", "/health$"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
