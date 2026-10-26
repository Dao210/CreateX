"use client";

import { lazy, Suspense, useMemo } from "react";
import { Gamepad2 } from "lucide-react";
import { useAuthStore } from "@auro/core/auth";
import { useCurrentWorkspace } from "@auro/core/paths";
import { siegePreferencesKey } from "@auro/core/siege";
import type { SiegeScope } from "@auro/core/siege/queries";
import type { StorageAdapter } from "@auro/core/types";
import { PageHeader } from "../layout/page-header";
import { useT } from "../i18n";
import { AppLink } from "../navigation";
import { createWebSiegePlatform } from "./platform/web";

const Workshop = lazy(() => import("./siege-workshop").then(module => ({ default: module.SiegeWorkshop })));
const Campaign = lazy(() => import("./campaign/campaign-app").then(module => ({ default: module.CampaignApp })));

export function SiegePage({ storage, campaign = false }: { storage: StorageAdapter; campaign?: boolean }) {
  const workspace = useCurrentWorkspace();
  const userId = useAuthStore(state => state.user?.id);
  if (!workspace || !userId) return null;
  const namespace = siegePreferencesKey(userId, workspace.id);
  return <ScopedSiegePage key={`${namespace}:${campaign}`} storage={storage} namespace={namespace} campaign={campaign}
    scope={{ workspaceId: workspace.id, workspaceSlug: workspace.slug, userId }} />;
}

function ScopedSiegePage({ storage, namespace, campaign, scope }: { storage: StorageAdapter; namespace: string; campaign: boolean; scope: SiegeScope }) {
  const { t } = useT("layout");
  const platform = useMemo(() => createWebSiegePlatform(storage, namespace), [storage, namespace]);
  const workshopHref = `/${scope.workspaceSlug}/siege`;
  const campaignHref = `${workshopHref}/campaign`;
  return <div className="siege-page" data-testid="siege-page">
    <PageHeader>
      <Gamepad2 className="size-4 text-muted-foreground" aria-hidden />
      <h1 className="min-w-0 flex-1 truncate text-body font-medium">{t($ => $.nav.siege)}</h1>
      <AppLink className="text-label text-muted-foreground hover:text-foreground" href={campaign ? workshopHref : campaignHref}>
        {campaign ? t($ => $.siege.workshop) : t($ => $.siege.campaign)}
      </AppLink>
    </PageHeader>
    <div className="siege-content">
      <Suspense fallback={<div className="p-6 text-body text-muted-foreground" role="status">{t($ => $.siege.loading)}</div>}>
        {campaign ? <Campaign platform={platform} scope={scope} workshopHref={workshopHref} />
          : <Workshop platform={platform} scope={scope} campaignHref={campaignHref} />}
      </Suspense>
    </div>
  </div>;
}
