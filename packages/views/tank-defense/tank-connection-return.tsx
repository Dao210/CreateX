"use client";

import { api } from "@auro/core/api";
import { buildTankMCPContext, buildTankMCPInstructions } from "@auro/core/tank-defense";
import { useNavigation } from "../navigation";
import { useT } from "../i18n";
import { AIConnectionReturn } from "../common/ai-connection-return";

export function TankConnectionReturn({ workspace, userId }: { workspace: { id: string; slug: string; name?: string }; userId: string }) {
  const navigation = useNavigation();
  const { t } = useT("common");
  const context = buildTankMCPContext({ appUrl: navigation.getShareableUrl("/"), serverUrl: api.getBaseUrl(), workspaceId: workspace.id, workspaceSlug: workspace.slug, workspaceName: workspace.name, userId });
  return <AIConnectionReturn source="tank-connect" className="tank-connection-return" instructions={buildTankMCPInstructions(context, t($ => $.ai_tools.continue_prompt))} />;
}
