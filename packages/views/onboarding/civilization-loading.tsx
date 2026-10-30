"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { matchLocale } from "@auro/core/i18n";
import { useCivilizationOnboarding } from "@auro/core/onboarding";
import { useAuthStore } from "@auro/core/auth";
import type { Workspace } from "@auro/core/types";
import { AuroIcon } from "@auro/ui/components/common/auro-icon";
import { Button } from "@auro/ui/components/ui/button";
import { DragStrip } from "../platform";
import { useT } from "../i18n";
import { randomCelestialWorkspaceIdentity } from "../workspace/slug";
import { OnboardingLogoutButton } from "./components/onboarding-logout-button";

export function CivilizationLoading({ onComplete }: { onComplete: (workspace: Workspace) => void }) {
  const { t, i18n } = useT("onboarding");
  const name = useAuthStore((state) => state.user?.name?.trim());
  const [identity] = useState(() => ({
    ...randomCelestialWorkspaceIdentity(matchLocale([i18n.resolvedLanguage ?? i18n.language])),
    name: name
      ? t(($) => $.civilization.world_name, { name })
      : t(($) => $.civilization.default_world_name),
  }));
  const { stage, error, workspace, retry } = useCivilizationOnboarding(identity);
  const completed = useRef(false);

  useEffect(() => {
    if (stage !== "ready" || !workspace || completed.current) return;
    completed.current = true;
    onComplete(workspace);
  }, [stage, workspace, onComplete]);

  const failed = stage === "error" || stage === "blocked";
  const status = stage === "blocked"
    ? t(($) => $.civilization.creation_disabled)
    : stage === "error"
      ? t(($) => $.civilization.failed)
      : stage === "creating"
        ? t(($) => $.civilization.creating)
        : stage === "entering" || stage === "ready"
          ? t(($) => $.civilization.entering)
          : t(($) => $.civilization.preparing);

  return (
    <div className="relative isolate flex min-h-full flex-col overflow-hidden bg-background text-foreground">
      <DragStrip />
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_42%,var(--muted),transparent_65%)]" />
      <header className="flex items-center justify-between gap-4 px-6 sm:px-10">
        <AuroIcon noSpin className="size-6" aria-hidden />
        <OnboardingLogoutButton inline />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center sm:py-16">
        <div aria-hidden className="relative mb-10 aspect-square w-56 max-w-full text-foreground sm:w-72">
          <div className="absolute inset-6 rounded-full bg-brand/5 blur-2xl" />
          <svg viewBox="0 0 320 320" fill="none" className="relative size-full">
            <circle cx="160" cy="160" r="150" stroke="currentColor" strokeOpacity=".08" strokeDasharray="2 8" />
            <g stroke="currentColor" strokeWidth=".75">
              <circle cx="160" cy="160" r="108" strokeOpacity=".35" />
              <ellipse cx="160" cy="160" rx="108" ry="38" strokeOpacity=".18" />
              <ellipse cx="160" cy="160" rx="108" ry="76" strokeOpacity=".18" />
              <ellipse cx="160" cy="160" rx="38" ry="108" strokeOpacity=".18" />
              <ellipse cx="160" cy="160" rx="76" ry="108" strokeOpacity=".18" />
              <path d="M52 160h216M160 52v216" strokeOpacity=".18" />
            </g>
            <g className={failed ? "" : "origin-center motion-safe:animate-[spin_24s_linear_infinite]"}>
              <ellipse cx="160" cy="160" rx="148" ry="55" transform="rotate(-32 160 160)" stroke="currentColor" strokeOpacity=".35" />
              <circle cx="285.5" cy="81.6" r="4" fill="currentColor" />
            </g>
            <circle cx="160" cy="160" r="8" className="fill-brand/15" />
            <circle cx="160" cy="160" r="3" className="fill-brand" />
            <path d="M160 4v12m0 288v12M4 160h12m288 0h12" stroke="currentColor" strokeOpacity=".3" />
          </svg>
        </div>
        <h1 className="max-w-lg text-balance font-serif text-display tracking-tight">
          {t(($) => $.civilization.title)}
        </h1>
        <div className="mt-5 flex max-w-md flex-col items-center gap-4">
          <p role={failed ? "alert" : "status"} className="flex items-center justify-center gap-2 text-body text-muted-foreground">
            {!failed && <Loader2 aria-hidden className="size-3.5 shrink-0 motion-safe:animate-spin" />}
            {status}
          </p>
          {stage === "error" && error && <p className="break-words text-body text-destructive">{error}</p>}
          {failed && <Button variant="outline" onClick={() => void retry()}>{t(($) => $.civilization.retry)}</Button>}
        </div>
      </main>
    </div>
  );
}
