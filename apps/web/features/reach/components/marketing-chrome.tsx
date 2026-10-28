import Link from "next/link";
import type { SupportedLocale } from "@auro/core/i18n";
import { brandForLocale } from "@/lib/brand";
import { localizedHref, MARKETING_LOCALES } from "@/lib/marketing-urls";
import { BrandMark } from "@/features/landing/components/brand-mark";

const labels = {
  en: { navigation: "Main navigation", menu: "Menu", language: "Language", privacy: "Privacy", licensing: "Licensing" },
  "zh-Hans": { navigation: "主导航", menu: "菜单", language: "语言", privacy: "隐私政策", licensing: "许可协议" },
  ja: { navigation: "メインナビゲーション", menu: "メニュー", language: "言語", privacy: "プライバシー", licensing: "ライセンス" },
  ko: { navigation: "주요 메뉴", menu: "메뉴", language: "언어", privacy: "개인정보 처리방침", licensing: "라이선스" },
};
const languageNames = { en: "English", "zh-Hans": "中文", ja: "日本語", ko: "한국어" };

export function MarketingHeader({ locale, light = false }: { locale: SupportedLocale; light?: boolean }) {
  const brand = brandForLocale(locale);
  const copy = labels[locale === "fr" ? "en" : locale];
  const links = [
    { href: "/#world", label: brand.world },
    { href: "/#rules", label: brand.rules },
    { href: "/about", label: brand.about },
  ];
  const navLinks = links.map(({ href, label }) => (
    <Link key={href} href={localizedHref(href, locale)} prefetch={false} className="rounded-(--landing-radius-nav-item) px-3 py-2 text-label font-medium opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-4">{label}</Link>
  ));
  return (
    <header className={light ? "border-b border-[#0a0d12]/8 bg-white text-[#0a0d12]" : "absolute inset-x-0 top-0 z-30 text-[#E8E1D5]"}>
      <div className="mx-auto flex h-[76px] max-w-[1320px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href={localizedHref("/", locale)} prefetch={false} className="flex min-w-0 items-center gap-2.5 text-body font-semibold tracking-tight sm:text-title-sm"><BrandMark className="h-5 w-auto shrink-0" /><span>{brand.name}</span></Link>
        <nav aria-label={copy.navigation} className="hidden items-center gap-1 lg:flex">{navLinks}</nav>
        <div className="flex shrink-0 items-center gap-3">
          <details className="relative lg:hidden">
            <summary className="cursor-pointer rounded-lg px-2 py-2 text-label focus-visible:outline-2">{copy.menu}</summary>
            <nav aria-label={copy.navigation} className={`absolute right-0 top-full z-50 mt-3 flex w-64 flex-col rounded-xl border p-2 shadow-xl ${light ? "border-black/10 bg-white" : "border-white/15 bg-[#0C0E11]"}`}>{navLinks}</nav>
          </details>
          <a href={localizedHref("/login", locale)} className={`rounded-(--landing-radius-button) px-4 py-2.5 text-label font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 ${light ? "bg-[#0a0d12] text-white hover:bg-[#0a0d12]/85" : "bg-[#E8E1D5] text-[#0A0B0E] hover:bg-white"}`}>{brand.play}</a>
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter({ locale, path = "/" }: { locale: SupportedLocale; path?: string }) {
  const brand = brandForLocale(locale);
  const copy = labels[locale === "fr" ? "en" : locale];
  return (
    <footer className="border-t border-white/10 bg-[#0A0B0E] text-[#E8E1D5]">
      <div className="mx-auto max-w-[1320px] px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
          <div><Link href={localizedHref("/", locale)} prefetch={false} className="text-title-sm font-semibold">{brand.name}</Link><p className="mt-2 text-body text-white/50">{brand.slogan}</p></div>
          <nav aria-label={copy.language} className="flex flex-wrap gap-1">
            {MARKETING_LOCALES.map((language) => <a key={language} href={localizedHref(path, language)} hrefLang={language} lang={language} aria-current={language === locale ? "page" : undefined} className={`rounded-lg px-3 py-2 text-label transition-colors focus-visible:outline-2 ${language === locale ? "bg-white/10 text-white hover:bg-white/15" : "text-white/50 hover:bg-white/5 hover:text-white"}`}>{languageNames[language]}</a>)}
          </nav>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-white/8 pt-6 text-caption text-white/45">
          <p>© {new Date().getFullYear()} {brand.name}</p>
          <div className="flex gap-5"><a href={localizedHref("/privacy", locale)} className="hover:text-white">{copy.privacy}</a><a href={localizedHref("/licensing", locale)} className="hover:text-white">{copy.licensing}</a></div>
        </div>
      </div>
    </footer>
  );
}
