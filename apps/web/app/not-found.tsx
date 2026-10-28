import Link from "next/link";
import { NOT_FOUND_COPY } from "@auro/views/locales";
import { getRequestLocale } from "@/lib/request-locale";
import { localizedHref } from "@/lib/marketing-urls";

export default async function NotFound() {
  const locale = await getRequestLocale();
  const copy = NOT_FOUND_COPY[locale];
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <p className="text-body font-medium text-muted-foreground">404</p>
      <h1 className="text-display-sm font-semibold tracking-tight">{copy.title}</h1>
      <p className="max-w-md text-body text-muted-foreground">{copy.description}</p>
      <Link href={localizedHref("/", locale)} className="mt-2 inline-flex items-center justify-center rounded-lg bg-foreground px-4 py-2 text-body font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-4">{copy.back_to_auro}</Link>
    </main>
  );
}
