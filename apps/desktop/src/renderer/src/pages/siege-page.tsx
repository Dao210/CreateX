import "@auro/views/siege/siege.css";

import { useParams } from "react-router-dom";
import { CampaignApp, SiegeWorkshop } from "@auro/views/siege";
import { createWebSiegePlatform } from "@auro/views/siege/platform/web";

/**
 * Doodle Siege inside the desktop shell.
 *
 * The renderer runs from `file://…/index.html` in a packaged build, where a
 * root-absolute asset URL resolves against the filesystem root. `./siege/`
 * resolves against index.html in both modes — the dev server serves
 * `src/renderer/public` at the origin root, and the packaged build copies the
 * same files next to index.html.
 */
const platform = createWebSiegePlatform({ assetBase: "./siege/" });

export function SiegePage() {
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  return (
    <SiegeWorkshop
      platform={platform}
      campaignHref={workspaceSlug ? `/${workspaceSlug}/siege/campaign` : undefined}
    />
  );
}

export function SiegeCampaignPage() {
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  return (
    <CampaignApp
      platform={platform}
      workshopHref={workspaceSlug ? `/${workspaceSlug}/siege` : undefined}
    />
  );
}
