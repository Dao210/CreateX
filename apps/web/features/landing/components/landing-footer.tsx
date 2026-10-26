"use client";

import Link from "next/link";
import { cn } from "@auro/ui/lib/utils";
import { useAuthStore } from "@auro/core/auth";
import { BrandMark } from "./brand-mark";
import { XMark, DiscordMark, twitterUrl, discordUrl } from "./shared";
import { useLocale, locales, localeLabels } from "../i18n";
import { useDashboardCtaHref } from "../utils/use-dashboard-cta";
import { brandForLocale } from "@/lib/brand";
import { localizedHref } from "@/lib/marketing-urls";
import { usePathname } from "next/navigation";

export function LandingFooter({ tagline }: { tagline?: string } = {}) {
  const { t, locale, setLocale } = useLocale();
  const user = useAuthStore((s) => s.user);
  const ctaHref = useDashboardCtaHref();
  const brand = brandForLocale(locale);
  const pathname = usePathname();
  const groups = [
    { label: brand.name, links: [
      { label: brand.world, href: localizedHref("/#world", locale) },
      { label: brand.play, href: localizedHref("/#create", locale) },
      { label: brand.rules, href: localizedHref("/#rules", locale) },
      { label: brand.about, href: localizedHref("/about", locale) },
    ] },
    { ...t.footer.groups.resources, links: t.footer.groups.resources.links },
    { label: t.footer.groups.company.label, links: t.footer.groups.company.links.filter((link) => ["/privacy", "/licensing"].includes(link.href)) },
  ];

  return (
    <footer className="bg-[#0a0d12] text-white">
      <div className="mx-auto max-w-[1320px] px-4 sm:px-6 lg:px-8">
        {/* Top: CTA + link columns */}
        <div className="flex flex-col gap-12 border-b border-white/10 py-16 sm:py-20 lg:flex-row lg:gap-20">
          {/* Left — newsletter / CTA */}
          <div className="lg:w-[340px] lg:shrink-0">
            <Link href={localizedHref("/", locale)} className="flex items-center gap-2.5">
              <BrandMark className="h-5 w-auto text-white" />
              <span className="text-title font-semibold tracking-tight">
                {brand.name}
              </span>
            </Link>
            <p className="mt-4 max-w-[300px] text-body leading-[1.7] text-white/50 sm:text-body-lg">
              {tagline ?? brand.slogan}
            </p>
            <div className="mt-4 flex items-center gap-3">
              <Link
                href={twitterUrl}
                target="_blank"
                rel="noreferrer"
                className="text-white/40 transition-colors hover:text-white"
                aria-label="X"
              >
                <XMark className="size-4" />
              </Link>
              <Link
                href={discordUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Discord"
                className="text-white/40 transition-colors hover:text-white"
              >
                <DiscordMark className="size-4" />
              </Link>
            </div>
            <div className="mt-6">
              <Link
                href={ctaHref}
                className="inline-flex items-center justify-center rounded-(--landing-radius-button) bg-white px-5 py-2.5 text-label font-semibold text-[#0a0d12] transition-colors hover:bg-white/88"
              >
                {user ? t.header.dashboard : brand.play}
              </Link>
            </div>
          </div>

          {/* Right — link columns */}
          <div className="grid flex-1 grid-cols-2 gap-8 sm:grid-cols-4">
            {groups.map((group) => (
              <div key={group.label}>
                <h4 className="text-caption font-semibold uppercase tracking-[0.1em] text-white/40">
                  {group.label}
                </h4>
                <ul className="mt-4 flex flex-col gap-2.5">
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        {...(link.href.startsWith("http")
                          ? { target: "_blank", rel: "noreferrer" }
                          : {})}
                        className="text-body text-white/50 transition-colors hover:text-white"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom: copyright + language switcher */}
        <div className="flex items-center justify-between pt-6 pb-10">
          <p className="text-label text-white/36">
            © {new Date().getFullYear()} {brand.name}
          </p>
          <div className="flex items-center">
            {locales.map((l, i) => (
              <Link
                href={localizedHref(pathname, l)}
                hrefLang={l}
                key={l}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  setLocale(l);
                }}
                aria-current={l === locale ? "true" : undefined}
                className={cn(
                  "px-1.5 py-1 text-caption font-medium transition-colors",
                  l === locale
                    ? "text-white/70"
                    : "text-white/30 hover:text-white/50",
                  i > 0 && "border-l border-white/16",
                )}
              >
                {localeLabels[l]}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
