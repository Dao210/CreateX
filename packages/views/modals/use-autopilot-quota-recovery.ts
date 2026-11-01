"use client";
import { useCallback } from "react";
import { useWorkspaceId } from "@auro/core/hooks";
import { useModalStore } from "@auro/core/modals";
export function useAutopilotQuotaRecovery(): () => void {
  const wsId = useWorkspaceId();
  return useCallback(() => useModalStore.getState().showAutopilotQuotaRecovery(wsId), [wsId]);
}
