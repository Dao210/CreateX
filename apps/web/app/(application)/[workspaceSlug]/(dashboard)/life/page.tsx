import { LifePage } from "@auro/views/agent-life";
import type { Metadata } from "next";
import en from "@auro/views/locales/en/life.json";
import zhHans from "@auro/views/locales/zh-Hans/life.json";
import ja from "@auro/views/locales/ja/life.json";
import ko from "@auro/views/locales/ko/life.json";
import fr from "@auro/views/locales/fr/life.json";
import { getRequestLocale } from "@/lib/request-locale";

const locales = { en, "zh-Hans": zhHans, ja, ko, fr };
export async function generateMetadata(): Promise<Metadata> { return { title: locales[await getRequestLocale()].title }; }
export default function Page() { return <LifePage />; }
