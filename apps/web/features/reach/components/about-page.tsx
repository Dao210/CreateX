import Link from "next/link";
import { brandForLocale } from "@/lib/brand";
import { localizedHref } from "@/lib/marketing-urls";
import type { SupportedLocale } from "@auro/core/i18n";
import { MarketingHeader, MarketingFooter } from "@/features/reach/components/marketing-chrome";

export function AboutPage({ locale }: { locale: SupportedLocale }) {
  const brand = brandForLocale(locale);
  return (
    <>
      <MarketingHeader locale={locale} light />
      <main className="bg-white text-[#0a0d12]">
        <article className="mx-auto max-w-[800px] px-4 py-16 sm:px-6 sm:py-24">
          <p className="text-caption font-medium uppercase tracking-widest text-[#9d4d25]">{brand.genre}</p>
          <h1 className="landing-serif mt-5 text-display-sm sm:text-display">{brand.about}</h1>
          <p className="mt-8 text-title-lg font-semibold">{brand.slogan}</p>
          <div className="mt-8 space-y-6 text-body-lg leading-relaxed text-[#0a0d12]/70">
            {brand.story.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </div>
          <p className="mt-10 border-l-2 border-[#C8622D] pl-5 text-title-lg">{brand.value}</p>
          <Link href={localizedHref("/#create", locale)} className="mt-10 inline-flex rounded-lg bg-[#0a0d12] px-6 py-3 text-body font-semibold text-white hover:bg-[#0a0d12]/85">
            {brand.play}
          </Link>
        </article>
      </main>
      <MarketingFooter locale={locale} path="/about" />
    </>
  );
}
