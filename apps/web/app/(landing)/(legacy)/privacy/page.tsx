import type { Metadata } from "next";
import { PrivacyPageClient } from "@/features/landing/components/privacy-page-client";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Weave a World collects, uses, and protects personal information across the website and the hosted service.",
  openGraph: {
    title: "Privacy Policy — Weave a World",
    description:
      "How Weave a World collects, uses, and protects personal information.",
    url: "/privacy",
  },
  alternates: {
    canonical: "/privacy",
  },
};

export default function PrivacyPage() {
  return <PrivacyPageClient />;
}
