import type { Metadata } from "next";
import type { SupportedLocale } from "@auro/core/i18n";
import { BRAND_NAME, BRAND_NAME_ZH, SITE_URL, brandForLocale } from "./brand";
import { languageAlternates, localizedHref } from "./marketing-urls";

const OG_LOCALES: Record<SupportedLocale, string> = {
  en: "en_US", "zh-Hans": "zh_CN", ko: "ko_KR", ja: "ja_JP", fr: "en_US",
};

export function publicPageMetadata(path: "/" | "/about", locale: SupportedLocale): Metadata {
  const brand = brandForLocale(locale);
  const title = path === "/"
    ? `${brand.name} — ${brand.genre}`
    : `${brand.about} | ${brand.name}`;
  const canonical = localizedHref(path, locale);
  return {
    title: { absolute: title },
    description: brand.description,
    alternates: { canonical, languages: languageAlternates(path) },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large" } },
    openGraph: {
      type: "website", siteName: BRAND_NAME, title, description: brand.description,
      url: canonical, locale: OG_LOCALES[locale],
      alternateLocale: [...new Set(Object.values(OG_LOCALES))].filter((value) => value !== OG_LOCALES[locale]),
      images: [{ url: "/images/weave-a-world-social.png", width: 1200, height: 630, alt: `${BRAND_NAME} · ${BRAND_NAME_ZH} — ${brand.slogan}` }],
    },
    twitter: { card: "summary_large_image", title, description: brand.description, images: ["/images/weave-a-world-social.png"] },
  };
}

/** Only describe the game; pricing, ratings and operator identity are not inferred. */
export function gameStructuredData(locale: SupportedLocale) {
  const brand = brandForLocale(locale);
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": `${SITE_URL}/#website`, url: SITE_URL, name: BRAND_NAME, alternateName: BRAND_NAME_ZH, inLanguage: ["en", "zh-Hans", "ko", "ja"] },
      {
        "@type": "VideoGame", "@id": `${SITE_URL}/#game`, url: SITE_URL,
        name: BRAND_NAME, alternateName: BRAND_NAME_ZH,
        description: brand.description, genre: ["Creative adventure", "Virtual civilization simulation"],
        applicationCategory: "GameApplication", operatingSystem: "Web browser", gamePlatform: "Web browser",
        image: `${SITE_URL}/images/weave-a-world-social.png`, inLanguage: ["en", "zh-Hans", "ko", "ja"],
      },
    ],
  };
}
