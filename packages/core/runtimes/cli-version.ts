/** Pull `cli_version` off a runtime row's loosely-typed metadata bag. */
export function readRuntimeCliVersion(metadata: Record<string, unknown> | undefined): string {
  const v = metadata?.cli_version;
  return typeof v === "string" ? v : "";
}

/** Daemon capability for isolated local repository worktrees. */
export const LOCAL_WORKTREE_CAPABILITY = "local-worktree-v1";

/** Minimal runtime shape this module needs; keeps callers from importing types. */
type RuntimeCapabilityRow = {
  daemon_id?: string | null;
  last_seen_at?: string | null;
  metadata?: unknown;
};

/** Read worktree support from the most recently seen runtime for a daemon. */
export function runtimeAdvertisesLocalWorktree(
  runtimes: RuntimeCapabilityRow[],
  daemonId: string | null | undefined,
): boolean {
  if (!daemonId) return false;
  let newest: RuntimeCapabilityRow | undefined;
  for (const rt of runtimes) {
    if (rt.daemon_id !== daemonId) continue;
    if (!newest) {
      newest = rt;
      continue;
    }
    // A row that never reported sorts oldest, so a live row always wins.
    const candidateSeen = rt.last_seen_at ?? "";
    const currentSeen = newest.last_seen_at ?? "";
    if (candidateSeen > currentSeen) newest = rt;
  }
  const metadata = newest?.metadata;
  if (!metadata || typeof metadata !== "object") return false;
  const caps = (metadata as { capabilities?: unknown }).capabilities;
  return Array.isArray(caps) && caps.includes(LOCAL_WORKTREE_CAPABILITY);
}
