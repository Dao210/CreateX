import type { Metadata } from "next";
import { TermsPageClient } from "@/features/landing/components/terms-page-client";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The ground rules for using Weave a World: your account, your creations, and how we run the service.",
  openGraph: {
    title: "Terms of Service — Weave a World",
    description:
      "The ground rules for using Weave a World: your account, your creations, and how we run the service.",
    url: "/terms",
  },
  alternates: {
    canonical: "/terms",
  },
};

export default function TermsPage() {
  return <TermsPageClient />;
}
