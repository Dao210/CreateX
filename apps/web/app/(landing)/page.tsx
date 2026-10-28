import type { Metadata } from "next";
import { ReachLanding } from "@/features/reach/components/reach-landing";
import { getRequestLocale } from "@/lib/request-locale";
import { gameStructuredData, publicPageMetadata } from "@/lib/seo";
import { StructuredData } from "@/components/structured-data";

export async function generateMetadata(): Promise<Metadata> {
  return publicPageMetadata("/", await getRequestLocale());
}

export default async function LandingPage() {
  const locale = await getRequestLocale();
  return (
    <>
      <StructuredData data={gameStructuredData(locale)} />
      <ReachLanding locale={locale} />
    </>
  );
}
