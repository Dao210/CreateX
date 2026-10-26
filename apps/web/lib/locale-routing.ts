import {
  matchLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@auro/core/i18n";

export const AURO_LOCALE_HEADER = "x-auro-locale";

export function isSupportedLocale(
  value: string | null,
): value is SupportedLocale {
  return (
    value !== null &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

export function resolveLocaleFromSignals({
  queryLocale,
  cookieLocale,
  acceptLanguage,
}: {
  queryLocale?: string | null;
  cookieLocale?: string | null;
  acceptLanguage?: string | null;
}): SupportedLocale {
  if (queryLocale && isSupportedLocale(queryLocale)) return queryLocale;
  const candidates: string[] = [];
  if (cookieLocale) candidates.push(cookieLocale);

  for (const part of (acceptLanguage ?? "").split(",")) {
    const tag = part.split(";")[0]?.trim();
    if (tag) candidates.push(tag);
  }

  return matchLocale(candidates);
}
