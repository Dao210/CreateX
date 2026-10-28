import type { Metadata } from "next";
import { Instrument_Serif } from "next/font/google";

// Instrument Serif is the landing display face and is Latin-only. The full
// `--font-serif` stack (Instrument Serif + the per-locale CJK serif tail) is
// composed in static CSS in app/custom.css, not here — same reasoning as
// `--font-sans` in app/globals.css: the CJK tail must be overridable per
// `<html lang>`, and a hashed next/font family can only be referenced from CSS
// through its variable.
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  preload: false,
  variable: "--font-instrument-serif",
});

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
      <div className={`${instrumentSerif.variable} landing-light h-full overflow-x-hidden overflow-y-auto bg-white`}>
        {children}
      </div>
    </>
  );
}
