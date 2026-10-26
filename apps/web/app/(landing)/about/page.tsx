import type { Metadata } from "next";
import { AboutPageClient } from "@/features/landing/components/about-page-client";
import { getRequestLocale } from "@/lib/request-locale";
import { publicPageMetadata } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  return publicPageMetadata("/about", await getRequestLocale());
}

export default function AboutPage() {
  return <AboutPageClient />;
}
