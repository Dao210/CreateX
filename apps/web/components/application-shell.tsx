import { ThemeProvider } from "@/components/theme-provider";
import { WebProviders } from "@/components/web-providers";
import { Toaster } from "@auro/ui/components/ui/sonner";
import { RESOURCES } from "@auro/views/locales";
import { getRequestLocale } from "@/lib/request-locale";
import { resolveBrowserApiBaseUrl, resolveBrowserWsUrl } from "@/config/runtime-urls";

/** Only application routes initialize authentication, queries and realtime. */
export async function ApplicationShell({ children }: { children: React.ReactNode }) {
  const locale = await getRequestLocale();
  return (
    <ThemeProvider>
      <WebProviders
        locale={locale}
        resources={{ [locale]: RESOURCES[locale] }}
        apiBaseUrl={resolveBrowserApiBaseUrl(process.env)}
        wsUrl={resolveBrowserWsUrl(process.env)}
      >
        {children}
      </WebProviders>
      <Toaster />
    </ThemeProvider>
  );
}
