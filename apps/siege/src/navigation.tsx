import { useMemo, type ReactNode } from "react";
import { NavigationProvider, type NavigationAdapter } from "@auro/views/navigation";

/**
 * The standalone shell has no router: /siege/ and /siege/play/ are plain
 * documents. Shared views still navigate through AppLink, so this adapter
 * bridges them onto full page loads.
 *
 * Auro web and desktop supply their own adapters; this file exists only for
 * `make up C=siege` and must not be imported by them.
 */
export function StandaloneNavigation({ children }: { children: ReactNode }) {
  const value = useMemo<NavigationAdapter>(
    () => ({
      push: (path) => window.location.assign(path),
      replace: (path) => window.location.replace(path),
      back: () => window.history.back(),
      pathname: window.location.pathname,
      searchParams: new URLSearchParams(window.location.search),
      hash: window.location.hash,
      getShareableUrl: (path) => new URL(path, window.location.origin).toString(),
    }),
    [],
  );
  return <NavigationProvider value={value}>{children}</NavigationProvider>;
}
