import type { Metadata } from "next";
import { LicensingPageClient } from "@/features/landing/components/licensing-page-client";

export const metadata: Metadata = {
  title: "Licensing",
  description:
    "When you can use Auro for free and when you need a commercial license, explained with common scenarios.",
  openGraph: {
    title: "Licensing — Auro",
    description:
      "Free to self-host inside your organization. Offering Auro to others as a hosted service needs a commercial license.",
    url: "/licensing",
  },
  alternates: {
    canonical: "/licensing",
  },
};

export default function LicensingPage() {
  return <LicensingPageClient />;
}
