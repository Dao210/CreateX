import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../auth";
import { useConfigStore } from "../config";
import type { Workspace } from "../types";
import { useCreateWorkspace } from "../workspace/mutations";
import { workspaceListOptions } from "../workspace/queries";
import { completeOnboarding } from "./store";

type Stage = "loading" | "creating" | "entering" | "ready" | "blocked" | "error";

/** Prepare the first workspace before completing onboarding and navigating. */
export function useCivilizationOnboarding(identity: { name: string; slug: string }) {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  const creationDisabled = useConfigStore((s) => s.workspaceCreationDisabled);
  const { mutateAsync: createWorkspace } = useCreateWorkspace();
  const [stage, setStage] = useState<Stage>("loading");
  const [error, setError] = useState<string | null>(null);
  const workspace = useRef<Workspace | null>(null);
  const mounted = useRef(false);
  const running = useRef(false);
  const started = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = useCallback(async () => {
    if (!userId || running.current) return;
    running.current = true;
    started.current = true;
    const active = () => mounted.current && useAuthStore.getState().user?.id === userId;
    setError(null);
    setStage("loading");

    try {
      // A fresh list also recovers a create whose response was lost. Never
      // interpret an unavailable list as permission to create another workspace.
      let target = workspace.current;
      if (!target) {
        const workspaces = await queryClient.fetchQuery({
          ...workspaceListOptions(),
          staleTime: 0,
          retry: false,
        });
        if (!active()) return;
        target = workspaces[0] ?? null;
        if (!target) {
          if (creationDisabled) {
            setStage("blocked");
            return;
          }
          setStage("creating");
          target = await createWorkspace(identity);
        }
        workspace.current = target;
      }

      if (!active()) return;
      setStage("entering");
      if (!useAuthStore.getState().user?.onboarded_at) {
        await completeOnboarding("workspace_ready", target.id);
      }
      if (active()) setStage("ready");
    } catch (cause) {
      if (!active()) return;
      setError(cause instanceof Error ? cause.message : null);
      setStage("error");
    } finally {
      running.current = false;
    }
  }, [userId, queryClient, creationDisabled, createWorkspace, identity]);

  useEffect(() => {
    // React Strict Mode replays effects; keep one preparation in flight.
    if (!started.current) void run();
  }, [run]);

  return { stage, error, workspace: workspace.current, retry: run };
}
