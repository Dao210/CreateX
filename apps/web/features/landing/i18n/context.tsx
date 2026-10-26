"use client";

import {
  createContext,
  use,
  useCallback,
  useMemo,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { useConfigStore } from "@auro/core/config";
import { createBrowserCookieLocaleAdapter } from "@auro/core/i18n/browser";
import { createLandingDict } from "./dictionary";
import type { LandingDict, Locale } from "./types";
import { localizedHref } from "@/lib/marketing-urls";

type LocaleContextValue = {
  locale: Locale;
  t: LandingDict;
  setLocale: (locale: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  children,
  initialLocale = "en",
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const locale = initialLocale;
  const [, startTransition] = useTransition();
  const router = useRouter();
  const localeAdapter = useMemo(() => createBrowserCookieLocaleAdapter(), []);
  const allowSignup = useConfigStore((state) => state.allowSignup);
  const t = useMemo(
    () => createLandingDict(locale, allowSignup),
    [allowSignup, locale],
  );

  const setLocale = useCallback(
    (l: Locale) => {
      if (l === locale) return;
      localeAdapter.persist(l);
      startTransition(() => {
        router.push(localizedHref(`${window.location.pathname}${window.location.search}${window.location.hash}`, l), { scroll: false });
      });
    },
    [locale, localeAdapter, router, startTransition],
  );

  return (
    <LocaleContext.Provider value={{ locale, t, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = use(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}
