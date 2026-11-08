"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { parseWithFallback } from "@auro/core/api/schema";
import { AnalyticsPublicConfigSchema } from "@auro/core/analytics/config";

type Analytics = typeof import("@auro/core/analytics");
let boot: Promise<Analytics | null> | null = null;
let lastRoute: string | null = null;

function loadAnalytics(): Promise<Analytics | null> {
  if (!boot) {
    boot = fetch("/api/config", { credentials: "same-origin", signal: AbortSignal.timeout(8000) })
      .then(response => response.ok ? response.json() : null)
      .then(async raw => {
        const config = parseWithFallback(raw, AnalyticsPublicConfigSchema, null as {
          posthog_key?: string; posthog_host?: string; analytics_environment?: string;
        } | null, { endpoint: "/api/config:analytics", redact: true });
        if (!config?.posthog_key) return null;
        const analytics = await import("@auro/core/analytics");
        analytics.captureSignupSource();
        analytics.initAnalytics({ key: config.posthog_key, host: config.posthog_host ?? "", environment: config.analytics_environment });
        return analytics;
      }).catch(() => { boot = null; return null; });
  }
  return boot;
}

/** Marketing and application routes share identity without application providers. */
export function SiteAnalytics() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname) return;
    const pageview = () => {
      if (lastRoute === pathname) return;
      lastRoute = pathname;
      void loadAnalytics().then(analytics => {
        if (!analytics) { if (lastRoute === pathname) lastRoute = null; return; }
        const route = analytics.analyticsPath(pathname);
        analytics.captureEvent("$pageview", {
          $current_url: `${window.location.origin}${route}`,
          $pathname: route,
          page: route,
          language: document.documentElement.lang,
        });
      });
    };
    pageview();
    window.addEventListener("online", pageview);
    return () => window.removeEventListener("online", pageview);
  }, [pathname]);

  useEffect(() => {
    const click = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-analytics-cta]") : null;
      const cta = element?.dataset.analyticsCta;
      if (!cta) return;
      void loadAnalytics().then(analytics => analytics?.captureEvent("cta_clicked", {
        cta, page: analytics.analyticsPath(window.location.pathname), language: document.documentElement.lang,
      }, { sendInstantly: true }));
    };
    document.addEventListener("click", click);
    return () => document.removeEventListener("click", click);
  }, []);
  return null;
}
