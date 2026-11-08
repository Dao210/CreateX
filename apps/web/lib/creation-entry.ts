import type { SupportedLocale } from "@auro/core/i18n";
import type { GameId } from "@/features/play/types";
import { localizedHref } from "./marketing-urls";

export function parseCreation(value: string | null): GameId | null {
  return value === "tank" || value === "fish" || value === "resident" ? value : null;
}
export function creationLoginHref(locale: SupportedLocale, game: GameId): string {
  const url = new URL(localizedHref("/login", locale), "https://local.invalid");
  url.searchParams.set("next", `/onboarding?creation=${game}`);
  return url.pathname + url.search;
}
export function creationDestination(slug: string, game: GameId): string {
  const feature = { tank: "tanks", fish: "fish", resident: "life" }[game];
  return `/${encodeURIComponent(slug)}/${feature}?create=1`;
}
