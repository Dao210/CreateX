import Link from "next/link";
import type { SupportedLocale } from "@auro/core/i18n";
import { brandForLocale } from "@/lib/brand";
import { localizedHref, MARKETING_LOCALES } from "@/lib/marketing-urls";
import { BrandMark } from "@auro/ui/components/common/brand-mark";
import { Menu } from "lucide-react";
import styles from "./marketing-chrome.module.css";

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
    { href: "/#games", label: brand.world },
    { href: "/#how-it-works", label: brand.rules },
    { href: "/about", label: brand.about },
  ];
  const navLinks = links.map(({ href, label }) => (
    <Link key={href} href={localizedHref(href, locale)} prefetch={false} className={styles.navLink}>{label}</Link>
  ));
  return (
    <header className={styles.header} data-light={light}>
      <div className={styles.headerInner}>
        <Link href={localizedHref("/", locale)} prefetch={false} className={styles.brand}><BrandMark className={styles.brandMark} /><span>{brand.name}</span></Link>
        <nav aria-label={copy.navigation} className={styles.desktopNav}>{navLinks}</nav>
        <div className={styles.actions}>
          <details className={styles.menu}>
            <summary aria-label={copy.menu}><Menu size={19} aria-hidden="true" /></summary>
            <nav aria-label={copy.navigation} className={styles.mobileNav}>{navLinks}</nav>
          </details>
          <a href={localizedHref("/#create", locale)} data-analytics-cta="header_play" className={styles.playLink}>{brand.play}</a>
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter({ locale, path = "/" }: { locale: SupportedLocale; path?: string }) {
  const brand = brandForLocale(locale);
  const copy = labels[locale === "fr" ? "en" : locale];
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
          <div><Link href={localizedHref("/", locale)} prefetch={false} className="text-title-sm font-semibold">{brand.name}</Link><p className="mt-2 text-body text-white/50">{brand.slogan}</p></div>
          <nav aria-label={copy.language} className={styles.languages}>
            {MARKETING_LOCALES.map((language) => <a key={language} href={localizedHref(path, language)} hrefLang={language} lang={language} aria-current={language === locale ? "page" : undefined}>{languageNames[language]}</a>)}
          </nav>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-white/8 pt-6 text-caption text-white/45">
          <p>© {new Date().getFullYear()} {brand.name}</p>
          <div className={styles.legalLinks}><a href={localizedHref("/privacy", locale)}>{copy.privacy}</a><a href={localizedHref("/licensing", locale)}>{copy.licensing}</a></div>
        </div>
      </div>
    </footer>
  );
}
