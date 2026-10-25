import { authenticatedFetch } from "@auro/core/api";
import {
  DEFAULT_CANNON,
  FreehandDraftSchema,
  WorkshopDraftSchema,
  canonicalDrawing,
  type Drawing,
  type SiegePlatform,
  type WorkshopDraft,
} from "@auro/core/siege";

/**
 * The web/desktop implementation of SiegePlatform.
 *
 * Electron's renderer is Chromium, so desktop reuses this unchanged — only a
 * native client needs a different one.
 *
 * `request` deliberately goes through the shared API client rather than a bare
 * `fetch`: every /api/siege route is workspace-scoped, so a request without
 * the workspace slug and the host's credential is rejected before it reaches
 * the game. When no client exists (the standalone shell) that helper falls
 * back to a plain fetch, which is exactly what standalone needs.
 */
export function createWebSiegePlatform(options?: { assetBase?: string }): SiegePlatform {
  return {
    assetBase: options?.assetBase ?? "/siege/",
    request: authenticatedFetch,
    preferences: {
      getItem: key => {
        try {
          return localStorage.getItem(key);
        } catch {
          return null;
        }
      },
      setItem: (key, value) => {
        try {
          localStorage.setItem(key, value);
        } catch {
          /* Preferences are optional. */
        }
      },
      removeItem: key => {
        try {
          localStorage.removeItem(key);
        } catch {
          /* Preferences are optional. */
        }
      },
    },
    loadDraft,
    saveDraft,
    randomId: () => crypto.randomUUID(),
    drawingHash: async drawing => {
      const bytes = new TextEncoder().encode(canonicalDrawing(drawing));
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join("");
    },
    download: (blob, filename) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("siege-drafts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveDraft(draft: WorkshopDraft): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      tx.objectStore("drafts").put(draft, "current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function loadDraft(): Promise<WorkshopDraft | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("drafts", "readonly").objectStore("drafts").get("current");
      request.onsuccess = () => {
        const value: unknown = request.result;
        const workspace = WorkshopDraftSchema.safeParse(value);
        if (workspace.success) return resolve(workspace.data);
        // Restore existing freehand drafts into the separated workshop slots.
        const freehand = FreehandDraftSchema.safeParse(value);
        resolve(
          freehand.success
            ? { mode: "drawing", cannonDesign: { ...DEFAULT_CANNON }, cannonName: "林地守卫炮", freehand: freehand.data }
            : null,
        );
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export type { Drawing };
