import type { Metadata } from "next";
import en from "@auro/views/locales/en/layout.json";
import zhHans from "@auro/views/locales/zh-Hans/layout.json";
import ja from "@auro/views/locales/ja/layout.json";
import ko from "@auro/views/locales/ko/layout.json";
import fr from "@auro/views/locales/fr/layout.json";
import { getRequestLocale } from "@/lib/request-locale";
import { MeClient } from "./me-client";

const layouts = { en, "zh-Hans": zhHans, ja, ko, fr };

export async function generateMetadata(): Promise<Metadata> {
  return { title: layouts[await getRequestLocale()].nav.me };
}

export default function Page() {
  return <MeClient />;
}
