import { ApplicationShell } from "@/components/application-shell";
import { LocaleProvider } from "@/features/landing/i18n";
import { getRequestLocale } from "@/lib/request-locale";

export default async function LegacyLandingLayout({ children }: { children: React.ReactNode }) {
  const locale = await getRequestLocale();
  return (
    <ApplicationShell>
      <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>
    </ApplicationShell>
  );
}
