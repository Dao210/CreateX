"use client";

import { Loader2 } from "lucide-react";
import { useT } from "../i18n";

/** Shared feedback while an explicitly opened surface loads its code. */
export function SurfaceLoading() {
  const { t } = useT("common");
  return (
    <div role="status" aria-label={t(($) => $.loading)} className="fixed bottom-4 right-4 z-50 rounded-lg bg-surface-raised p-3 text-muted-foreground shadow-sm">
      <Loader2 aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" />
    </div>
  );
}
