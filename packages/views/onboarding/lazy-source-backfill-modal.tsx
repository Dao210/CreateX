"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { useAuthStore } from "@auro/core/auth";
import { needsSourceBackfill } from "@auro/core/onboarding";
import { useSourceBackfillDismissCount } from "./source-backfill-dismiss";

const SourceBackfillContent = lazy(() => import("./source-backfill-modal").then((module) => ({ default: module.SourceBackfillModal })));

export function SourceBackfillModal() {
  const user = useAuthStore((state) => state.user);
  const [dismissCount] = useSourceBackfillDismissCount(user?.id);
  const [loadedForUser, setLoadedForUser] = useState<string | null>(null);
  const eligible = needsSourceBackfill(user, dismissCount);
  useEffect(() => {
    if (user && eligible) setLoadedForUser(user.id);
  }, [user, eligible]);
  // Keep an opened dialog mounted through submit; its own eligibility gate
  // owns closing it after the authoritative user update.
  return user && loadedForUser === user.id
    ? <Suspense fallback={null}><SourceBackfillContent /></Suspense>
    : null;
}
