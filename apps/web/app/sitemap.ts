import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/brand";
import { languageAlternates, localizedHref, MARKETING_LOCALES, SEARCHABLE_PAGES } from "@/lib/marketing-urls";

export default function sitemap(): MetadataRoute.Sitemap {
  return SEARCHABLE_PAGES.flatMap((path) =>
    MARKETING_LOCALES.map((locale) => ({
      url: `${SITE_URL}${localizedHref(path, locale)}`,
      changeFrequency: "weekly" as const,
      priority: path === "/" ? 1 : 0.7,
      alternates: { languages: languageAlternates(path) },
    })),
  );
}
