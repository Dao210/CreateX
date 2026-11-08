import { parseWithFallback } from "@auro/core/api/schema";
import { AnalyticsPublicConfigSchema } from "@auro/core/analytics/config";
import type { SignupSourceContext } from "@auro/core/analytics";

/** Keep config validation and the SDK outside the first-paint bundle. */
export async function loadSiteAnalytics(entry: SignupSourceContext) {
  const response = await fetch("/api/config", { credentials: "same-origin", signal: AbortSignal.timeout(8000) });
  const raw = response.ok ? await response.json() : null;
  const config = parseWithFallback(raw, AnalyticsPublicConfigSchema, null as {
    posthog_key?: string; posthog_host?: string; analytics_environment?: string;
  } | null, { endpoint: "/api/config:analytics", redact: true });
  if (!config?.posthog_key) return null;
  const analytics = await import("@auro/core/analytics");
  analytics.captureSignupSource(entry);
  analytics.initAnalytics({ key: config.posthog_key, host: config.posthog_host ?? "", environment: config.analytics_environment });
  return analytics;
}
