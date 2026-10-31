"use client";

import { Progress } from "@auro/ui/components/ui/progress";
import { tankGrowth } from "@auro/core/tank-defense";
import { useT } from "../i18n";

export function TankGrowth({ xp = 0 }: { xp?: number }) {
  const { t } = useT("tanks");
  const growth = tankGrowth(xp);
  const label = growth.required ? t($ => $.growth.experience, { earned: growth.earned, required: growth.required }) : t($ => $.growth.max_level);
  return <div className="space-y-1.5" data-testid="tank-growth">
    <div className="flex flex-wrap items-center justify-between gap-2 text-caption"><strong>{t($ => $.growth.level, { level: growth.level })}</strong><span>{label}</span></div>
    <Progress value={growth.required ? growth.earned / growth.required * 100 : 100} aria-label={label} />
  </div>;
}
