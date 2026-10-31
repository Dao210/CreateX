"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { SupportedLocale } from "@auro/core/i18n";
import { useLocale, useT } from "@auro/views/i18n";
import { BrandMark } from "@/features/landing/components/brand-mark";
import { WorldPoster } from "@/features/reach/components/world-poster";
import { brandForLocale } from "@/lib/brand";

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useT("auth");
  const locale = useLocale() as SupportedLocale;
  const brand = brandForLocale(locale);
  const isCjk = locale === "zh-Hans" || locale === "ja" || locale === "ko";
  const isKorean = locale === "ko";
  const copyBreakClass = isKorean ? "break-keep break-words" : "";

  return (
    <div className="min-h-svh bg-[#F4EFE6] lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <header className="flex h-16 items-center justify-between border-b border-white/8 bg-[#0A0B0E] px-4 text-[#E8E1D5] lg:hidden">
        <Link
          href="/"
          prefetch={false}
          className="flex min-w-0 items-center gap-2 text-body font-semibold"
        >
          <BrandMark className="h-5 w-auto shrink-0" />
          <span className="truncate">{brand.name}</span>
        </Link>
        <Link
          href="/"
          prefetch={false}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-label text-[#E8E1D5]/70 transition-colors hover:text-[#E8E1D5] focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t(($) => $.login_shell.back_short)}
        </Link>
      </header>

      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[#0A0B0E] p-10 text-[#E8E1D5] lg:flex lg:min-h-svh xl:p-14">
        <Link
          href="/"
          prefetch={false}
          className="flex w-fit items-center gap-2.5 text-body font-semibold focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          <BrandMark className="h-5 w-auto" />
          <span>{brand.name}</span>
        </Link>

        <div className="my-10">
          <div className="relative overflow-hidden rounded-2xl border border-[#364237] bg-[#111916]">
            <div className="aspect-[2/1]">
              <WorldPoster label={t(($) => $.login_shell.map_label)} />
            </div>
            <span className="absolute left-4 top-4 rounded-full border border-white/10 bg-[#0A0B0E]/75 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#E8E1D5]/70 backdrop-blur-sm">
              {t(($) => $.login_shell.preview)}
            </span>
          </div>
          <p
            className={`landing-serif mt-8 max-w-[560px] text-balance text-[2.35rem] text-[#E8E1D5] xl:text-[2.8rem] ${
              isCjk
                ? "leading-[1.25] tracking-normal"
                : "leading-[1.12] tracking-[-0.02em]"
            } ${copyBreakClass}`}
          >
            {brand.value}
          </p>
          <p
            className={`mt-4 max-w-[42ch] text-[15px] leading-[1.7] text-[#E8E1D5]/60 ${copyBreakClass}`}
          >
            {brand.intro}
          </p>
        </div>

        <Link
          href="/"
          prefetch={false}
          className="flex w-fit items-center gap-2 text-label text-[#E8E1D5]/60 transition-colors hover:text-[#E8E1D5] focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t(($) => $.login_shell.back)}
        </Link>
      </aside>

      <main className="landing-light flex min-h-[calc(100svh-4rem)] flex-col items-center justify-center bg-[#F4EFE6] px-4 py-8 sm:px-8 lg:min-h-svh">
        <div className="w-full max-w-sm">{children}</div>
        <p
          className={`mt-5 max-w-[360px] text-center text-caption leading-relaxed text-[#6B655C] ${copyBreakClass}`}
        >
          {t(($) => $.login_shell.legal)}{" "}
          <a
            href="/privacy"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4 transition-colors hover:text-[#14161A] focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {t(($) => $.login_shell.privacy)}
          </a>
        </p>
      </main>
    </div>
  );
}
