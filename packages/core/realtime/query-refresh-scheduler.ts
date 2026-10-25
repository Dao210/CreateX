import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { createLogger } from "../logger";

const logger = createLogger("query-refresh");

/** Bound burst traffic without cancelling slow requests or starving final state. */
export function createQueryRefreshScheduler(qc: QueryClient, delayMs = 100) {
  type Pending = { queryKey: QueryKey; timer?: ReturnType<typeof setTimeout>; running: boolean; dirty: boolean };
  const pending = new Map<string, Pending>();
  let disposed = false;

  const arm = (key: string, entry: Pending) => {
    entry.timer = setTimeout(async () => {
      entry.timer = undefined;
      entry.running = true;
      entry.dirty = false;
      try {
        await qc.invalidateQueries({ queryKey: entry.queryKey }, { cancelRefetch: false });
      } catch (error) {
        logger.warn("refresh failed", error);
      } finally {
        entry.running = false;
        if (!disposed && entry.dirty) arm(key, entry);
        else pending.delete(key);
      }
    }, delayMs);
  };

  return {
    schedule(queryKey: QueryKey) {
      if (disposed) return;
      const key = JSON.stringify(queryKey);
      const existing = pending.get(key);
      if (existing) {
        if (existing.running) existing.dirty = true;
        return;
      }
      const entry: Pending = { queryKey, running: false, dirty: false };
      pending.set(key, entry);
      arm(key, entry);
    },
    dispose() {
      disposed = true;
      for (const entry of pending.values()) clearTimeout(entry.timer);
      pending.clear();
    },
  };
}
