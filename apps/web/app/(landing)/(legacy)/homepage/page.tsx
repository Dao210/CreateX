import type { Metadata } from "next";
import { AuroLanding } from "@/features/landing/components/auro-landing";

export const metadata: Metadata = {
  title: "Homepage",
  description:
    "Auro — source-available platform that turns coding agents into real teammates. Assign tasks, track progress, compound skills.",
  openGraph: {
    title: "Auro — Project Management for Human + Agent Teams",
    description:
      "Manage your human + agent workforce in one place.",
    url: "/homepage",
  },
  alternates: {
    canonical: "/homepage",
  },
};

export default function HomepagePage() {
  return <AuroLanding />;
}
