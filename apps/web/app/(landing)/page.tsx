import type { Metadata } from "next";
import { ReachLanding } from "@/features/reach/components/reach-landing";
import { getRequestLocale } from "@/lib/request-locale";
import { gameStructuredData, publicPageMetadata } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  return publicPageMetadata("/", await getRequestLocale());
}

export default async function LandingPage() {
  const locale = await getRequestLocale();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(gameStructuredData(locale)).replace(/</g, "\\u003c") }} />
      <ReachLanding />
    </>
  );
}
