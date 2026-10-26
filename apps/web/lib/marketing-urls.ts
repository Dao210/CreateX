import type { SupportedLocale } from "@auro/core/i18n";
import { SITE_URL } from "./brand";

export const MARKETING_LOCALES = ["en", "zh-Hans", "ko", "ja"] as const;
export const SEARCHABLE_PAGES = ["/", "/about"] as const;

/** Explicit language URLs keep crawlers independent of cookies and headers. */
export function localizedHref(path: string, locale: SupportedLocale): string {
  const url = new URL(path, SITE_URL);
  url.searchParams.set("lang", locale === "fr" ? "en" : locale);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function languageAlternates(path: string) {
  return Object.fromEntries([
    ["x-default", `${SITE_URL}${path}`],
    ...MARKETING_LOCALES.map((locale) => [locale, `${SITE_URL}${localizedHref(path, locale)}`]),
  ]);
}
