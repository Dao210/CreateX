import type { Metadata } from "next";
import type { SupportedLocale } from "@auro/core/i18n";
import { BRAND_NAME, BRAND_NAME_ZH, SITE_URL, brandForLocale } from "./brand";
import { languageAlternates, localizedHref, marketingLocale, MARKETING_LOCALES, type MarketingLocale, type MarketingPage } from "./marketing-urls";

const OG_LOCALES: Record<MarketingLocale, string> = {
  en: "en_US", "zh-Hans": "zh_CN", ko: "ko_KR", ja: "ja_JP",
};

function pageCopy(path: MarketingPage, locale: MarketingLocale) {
  const brand = brandForLocale(locale);
  return {
    title: path === "/" ? brand.searchTitle : locale === "zh-Hans" ? `${brand.about}（${BRAND_NAME}）` : brand.about,
    description: path === "/" ? brand.description : brand.aboutDescription,
  };
}

export function publicPageMetadata(path: MarketingPage, requestedLocale: SupportedLocale): Metadata {
  const locale = marketingLocale(requestedLocale);
  const { title, description } = pageCopy(path, locale);
  const canonical = localizedHref(path, locale);
  const image = {
    url: "/images/weave-a-world-social.png", width: 1200, height: 630,
    alt: `${BRAND_NAME} · ${BRAND_NAME_ZH} — ${brandForLocale(locale).slogan}`,
  };
  return {
    title: { absolute: title },
    description,
    alternates: { canonical, languages: languageAlternates(path) },
    robots: {
      index: true, follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
    },
    openGraph: {
      type: "website", siteName: BRAND_NAME, title, description,
      url: canonical, locale: OG_LOCALES[locale],
      alternateLocale: Object.values(OG_LOCALES).filter((value) => value !== OG_LOCALES[locale]),
      images: [image],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

/** Only describe the game; pricing, ratings and operator identity are not inferred. */
export function gameStructuredData(requestedLocale: SupportedLocale, path: MarketingPage = "/") {
  const locale = marketingLocale(requestedLocale);
  const brand = brandForLocale(locale);
  const { title, description } = pageCopy(path, locale);
  const url = `${SITE_URL}${localizedHref(path, locale)}`;
  const websiteId = `${SITE_URL}/#website`;
  const gameId = `${SITE_URL}/#game`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": websiteId, url: `${SITE_URL}/`, name: BRAND_NAME, alternateName: BRAND_NAME_ZH, inLanguage: MARKETING_LOCALES },
      {
        "@type": "VideoGame", "@id": gameId, url: `${SITE_URL}/`,
        name: BRAND_NAME, alternateName: BRAND_NAME_ZH,
        description: brand.description, genre: ["Creative adventure", "Virtual civilization simulation"],
        applicationCategory: "GameApplication", operatingSystem: "Web browser", gamePlatform: "Web browser",
        image: `${SITE_URL}/images/weave-a-world-social.png`,
      },
      {
        "@type": path === "/" ? "WebPage" : "AboutPage", "@id": `${url}#webpage`,
        url, name: title, description, inLanguage: locale,
        isPartOf: { "@id": websiteId }, about: { "@id": gameId },
        primaryImageOfPage: { "@type": "ImageObject", url: `${SITE_URL}/images/weave-a-world-social.png`, width: 1200, height: 630 },
        ...(path === "/about" ? { breadcrumb: { "@id": `${url}#breadcrumb` } } : {}),
      },
      ...(path === "/about" ? [{
        "@type": "BreadcrumbList", "@id": `${url}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: brand.name, item: `${SITE_URL}${localizedHref("/", locale)}` },
          { "@type": "ListItem", position: 2, name: brand.about, item: url },
        ],
      }] : []),
    ],
  };
}
