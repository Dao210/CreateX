"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { paths } from "@auro/core/paths";
import { isSupportedLocale } from "@/lib/locale-routing";

export function useUserLocaleSyncEnabled(): boolean {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Account locale synchronization can reload the page. Finish the single-use
  // OAuth callback before allowing that reload on its destination.
  // Explicit language URLs take precedence over account preferences, as in the
  // proxy. Reloading cannot resolve a mismatch while the URL pins the locale.
  return (
    !!pathname &&
    pathname.replace(/\/+$/, "") !== paths.authCallback() &&
    !isSupportedLocale(searchParams.get("lang"))
  );
}
