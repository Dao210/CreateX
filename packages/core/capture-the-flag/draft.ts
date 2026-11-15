import { z } from "zod";
import type { StorageAdapter } from "../types";
const DraftSchema = z.object({
  text: z.string().max(256 * 1024),
  name: z.string().max(128),
  source: z
    .object({
      id: z.string().uuid(),
      revision: z.number().int().min(1).max(128),
    })
    .nullable(),
});
export function readCTFDraft(storage: StorageAdapter, key: string) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const result = DraftSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

import { createStore } from "zustand/vanilla";
type Draft = z.infer<typeof DraftSchema>;
export function createCTFDraftStore(
  storage: StorageAdapter,
  key: string,
  text: string,
) {
  const initial = readCTFDraft(storage, key) ?? {
    text,
    name: "",
    source: null,
  };
  return createStore<Draft & { update: (value: Partial<Draft>) => void }>()(
    (set, get) => ({
      ...initial,
      update(value) {
        set(value);
        const current = get();
        try {
          storage.setItem(
            key,
            JSON.stringify({
              text: current.text,
              name: current.name,
              source: current.source,
            }),
          );
        } catch {
          /* Keep editing available when persistence is full. */
        }
      },
    }),
  );
}
