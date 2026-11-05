"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@auro/core/auth";
import { paths } from "@auro/core/paths";
import { useWorkspaceList } from "@auro/core/workspace";
import { AppLoading } from "@auro/views/common/app-loading";
import { OnboardingFlow } from "@auro/views/onboarding";
import { useT } from "@auro/views/i18n";
import { Button } from "@auro/ui/components/ui/button";

function PublicOceanEntry() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useAuthStore(state => state.user);
  const isLoading = useAuthStore(state => state.isLoading);
  const worlds = useWorkspaceList({ enabled: !isLoading && !!user });
  const { t } = useT("fish");
  const params = new URLSearchParams();
  const resident = searchParams.get("resident");
  if (resident) params.set("resident", resident);
  const search = params.size ? "?" + params.toString() : "";
  const firstWorld = worlds.workspaces[0];

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace(paths.login() + "?next=" + encodeURIComponent(paths.publicOcean() + search));
    } else if (worlds.ready && firstWorld && user.onboarded_at != null) {
      router.replace(paths.workspace(firstWorld.slug).fish() + search);
    }
  }, [isLoading, user, worlds.ready, firstWorld, router, search]);

  if (worlds.unavailable) return <div className="flex min-h-svh flex-col items-center justify-center gap-4">
    <p role="alert">{t($ => $.load_failed)}</p>
    <Button onClick={() => void worlds.refetch()}>{t($ => $.retry)}</Button>
  </div>;

  if (user && worlds.ready && (!firstWorld || user.onboarded_at == null)) return <OnboardingFlow onComplete={world => {
    if (world) router.replace(paths.workspace(world.slug).fish() + search);
  }} />;

  return <AppLoading label={t($ => $.loading)} />;
}

export default function OceanEntryPage() {
  return <Suspense fallback={<AppLoading />}><PublicOceanEntry /></Suspense>;
}
