"use client";

import { useQuery } from "@tanstack/react-query";
import {
  runtimeListOptions,
  readRuntimeCliVersion,
  chatProjectContextSupported,
} from "@auro/core/runtimes";

/**
 * Whether the active agent's daemon is new enough to inject a chat session's
 * project description into the run brief. `null` means "cannot tell" (no
 * agent, no bound runtime, or the runtime row not in cache yet) and must NOT
 * warn: this is a soft gate, and a spurious warning is worse than a
 * description an old daemon drops.
 *
 * Resolved in one place so the chat controller and the agent builder cannot
 * drift on the rule.
 */
export function useChatProjectContextSupport(
  wsId: string,
  agent: { runtime_id?: string | null } | null | undefined,
): boolean | null {
  const { data: runtimes = [] } = useQuery({ ...runtimeListOptions(wsId), enabled: !!wsId });
  if (!agent?.runtime_id) return null;
  const runtime = runtimes.find((r) => r.id === agent.runtime_id);
  if (!runtime) return null;
  return chatProjectContextSupported(readRuntimeCliVersion(runtime.metadata));
}
