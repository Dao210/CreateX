import type { SupportedLocale } from "@auro/core/i18n";

export function docsHrefForLocale(locale: SupportedLocale): string {
  if (locale === "zh-Hans") return "/docs/zh";
  if (locale === "ko") return "/docs/ko";
  if (locale === "ja") return "/docs/ja";
  if (locale === "fr") return "/docs/fr";
  return "/docs";
}
