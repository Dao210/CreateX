import { Instrument_Serif } from "next/font/google";

// The locale-specific serif fallback stack lives in app/custom.css.
export const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  preload: false,
  variable: "--font-instrument-serif",
});
