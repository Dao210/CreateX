"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@auro/core/auth";
import { paths } from "@auro/core/paths";
import { OnboardingFlow } from "@auro/views/onboarding";

/** Auth shell; shared onboarding prepares the workspace before replacing this route. */
export default function OnboardingPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  useEffect(() => {
    if (!isLoading && !user) router.replace(paths.login());
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;
  return (
    <div className="h-full overflow-y-auto bg-background">
      <OnboardingFlow
        onComplete={(ws) => {
          router.replace(ws ? paths.workspace(ws.slug).root() : paths.root());
        }}
      />
    </div>
  );
}
