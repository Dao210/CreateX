"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import type { SignupSourceContext } from "@auro/core/analytics";

type Analytics = typeof import("@auro/core/analytics");
let boot: Promise<Analytics | null> | null = null;
let lastRoute: string | null = null;

function loadAnalytics(entry: SignupSourceContext): Promise<Analytics | null> {
  if (!boot) {
    boot = import("./load-site-analytics").then(module => module.loadSiteAnalytics(entry))
      .catch(() => { boot = null; return null; });
  }
  return boot;
}

/** Marketing and application routes share identity without application providers. */
export function SiteAnalytics() {
  const pathname = usePathname();
  const entry = useRef<SignupSourceContext | null>(null);
  const flushPageview = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!pathname) return;
    entry.current ??= { search: window.location.search, referrer: document.referrer, origin: window.location.origin };
    const source = entry.current;
    const language = document.documentElement.lang;
    const pageview = () => {
      if (lastRoute === pathname) return;
      lastRoute = pathname;
      void loadAnalytics(source).then(analytics => {
        if (!analytics) { if (lastRoute === pathname) lastRoute = null; return; }
        const route = analytics.analyticsPath(pathname);
        analytics.captureEvent("$pageview", {
          $current_url: `${window.location.origin}${route}`,
          $pathname: route,
          page: route,
          language,
        });
      });
    };
    flushPageview.current = pageview;
    const video = pathname === "/" ? document.querySelector("[data-gameplay] video") : null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ready = () => { clearTimeout(timer); video?.removeEventListener("playing", ready); pageview(); };
    if (video instanceof HTMLVideoElement && video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      video.addEventListener("playing", ready, { once: true });
      timer = setTimeout(ready, 4000);
    } else pageview();
    window.addEventListener("online", pageview);
    return () => {
      clearTimeout(timer); video?.removeEventListener("playing", ready); window.removeEventListener("online", pageview);
      if (window.location.pathname !== pathname) pageview();
      flushPageview.current = null;
    };
  }, [pathname]);

  useEffect(() => {
    const click = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-analytics-cta]") : null;
      const cta = element?.dataset.analyticsCta;
      if (!cta) return;
      flushPageview.current?.();
      const source = entry.current;
      if (!source) return;
      const pathname = window.location.pathname;
      const language = document.documentElement.lang;
      void loadAnalytics(source).then(analytics => analytics?.captureEvent("cta_clicked", {
        cta, page: analytics.analyticsPath(pathname), language,
      }, { sendInstantly: true }));
    };
    document.addEventListener("click", click);
    return () => document.removeEventListener("click", click);
  }, []);
  return null;
}
