import type { Metadata } from "next";
import { AboutPage } from "@/features/reach/components/about-page";
import { getRequestLocale } from "@/lib/request-locale";
import { gameStructuredData, publicPageMetadata } from "@/lib/seo";
import { StructuredData } from "@/components/structured-data";

export async function generateMetadata(): Promise<Metadata> {
  return publicPageMetadata("/about", await getRequestLocale());
}

export default async function AboutRoute() {
  const locale = await getRequestLocale();
  return (
    <>
      <StructuredData data={gameStructuredData(locale, "/about")} />
      <AboutPage locale={locale} />
    </>
  );
}
