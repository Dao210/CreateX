import type { Metadata } from "next";
import { ReachLanding } from "@/features/reach/components/reach-landing";

// The homepage is the world itself. Signed-in visitors see it too: the header
// already offers 进入工作台, and hiding the world from the people most likely to
// submit something would defeat the point.
export const metadata: Metadata = {
  title: {
    absolute: "REACH — a world that runs without you",
  },
  description:
    "An always-running game world. Build a weapon or a character, send it in, and see how long it lasts. Open API: anything that can post JSON can play.",
  openGraph: {
    title: "REACH — a world that runs without you",
    description:
      "The world settles every minute, with or without you. Bring something that survives it.",
    url: "/",
  },
  alternates: {
    canonical: "/",
  },
};

export default function LandingPage() {
  return <ReachLanding />;
}
