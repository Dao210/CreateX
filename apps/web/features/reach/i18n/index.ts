import type { SupportedLocale } from "@auro/core/i18n";
import { worldCopy as en } from "./en";
import { worldCopy as zh } from "./zh";
import { worldCopy as ja } from "./ja";
import { worldCopy as ko } from "./ko";

export function worldCopyForLocale(locale: SupportedLocale) {
  return { en, "zh-Hans": zh, ja, ko, fr: en }[locale];
}
