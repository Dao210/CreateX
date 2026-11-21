import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { instrumentSerif } from "@/lib/landing-font";

// Game pages opt in individually; inherited marketing pages stay unlisted.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default async function LandingLayout({
  children,
}: {
  children: React.ReactNode;
}) {

  return (
    <>
      <div className={`${instrumentSerif.variable} landing-light h-full overflow-x-hidden overflow-y-auto bg-white`} style={{ "--font-instrument-fallback": instrumentSerif.style.fontFamily.split(",").slice(1).join(",") } as CSSProperties}>
        {children}
      </div>
    </>
  );
}
