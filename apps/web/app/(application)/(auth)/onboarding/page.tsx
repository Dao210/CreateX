"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@auro/core/auth";
import { paths } from "@auro/core/paths";
import { OnboardingFlow } from "@auro/views/onboarding";
import { creationDestination, parseCreation } from "@/lib/creation-entry";

/** Shared onboarding prepares the world before entering the chosen creation flow. */
function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const creation = parseCreation(searchParams.get("creation"));
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  useEffect(() => {
    if (!isLoading && !user) {
      const next = creation ? `${paths.onboarding()}?creation=${creation}` : paths.onboarding();
      router.replace(`${paths.login()}?${new URLSearchParams({ next })}`);
    }
  }, [isLoading, user, router, creation]);

  if (isLoading || !user) return null;
  return (
    <div className="h-full overflow-y-auto bg-background">
      <OnboardingFlow onComplete={(ws) => router.replace(ws ? creation ? creationDestination(ws.slug, creation) : paths.workspace(ws.slug).root() : paths.root())} />
    </div>
  );
}

export default function OnboardingPage() {
  return <Suspense><OnboardingContent /></Suspense>;
}
