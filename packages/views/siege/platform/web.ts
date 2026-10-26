import { paintCannon } from "../workshop/cannon-painter";
import {
  WorkshopDraftSchema,
  canonicalDrawing,
  type Drawing,
  type SiegePlatform,
  type WorkshopDraft,
} from "@auro/core/siege";

import type { StorageAdapter } from "@auro/core/types";
import { scopedSiegeStorage } from "@auro/core/siege";
import { siegeAssetUrl } from "../assets";

/** Browser capabilities bound to the identity that owns this mounted page. */
export function createWebSiegePlatform(storage: StorageAdapter, namespace: string): SiegePlatform {
  let pendingSave: Promise<void> = Promise.resolve();
  return {
    assetUrl: siegeAssetUrl,
    preferences: scopedSiegeStorage(storage, namespace),
    loadDraft: () => loadDraft(namespace),
    saveDraft: draft => {
      const write = pendingSave.catch(() => {}).then(() => saveDraft(namespace, draft));
      pendingSave = write; return write;
    },
    randomId: () => crypto.randomUUID(),
    drawingHash: async drawing => {
      const bytes = new TextEncoder().encode(canonicalDrawing(drawing));
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join("");
    },
    download,
    exportImage: (drawing, cannon, filename) => {
      const canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = 1024;
      const ctx = canvas.getContext("2d"); if (!ctx) return;
      ctx.fillStyle = "#f6f2e6"; ctx.fillRect(0, 0, 1024, 1024);
      if (cannon) { ctx.translate(230, 512); ctx.scale(180, 180); paintCannon(ctx, cannon); }
      else {
        ctx.scale(0.25, 0.25);
        for (const stroke of drawing.strokes) {
          ctx.lineWidth = stroke.width; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#283f35"; ctx.beginPath();
          stroke.points.forEach((point, i) => i ? ctx.lineTo(point[0], point[1]) : ctx.moveTo(point[0], point[1])); ctx.stroke();
        }
      }
      canvas.toBlob(blob => { if (blob) download(blob, filename); });
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

async function saveDraft(namespace: string, draft: WorkshopDraft): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      tx.objectStore("drafts").put(draft, namespace);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function loadDraft(namespace: string): Promise<WorkshopDraft | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("drafts", "readonly").objectStore("drafts").get(namespace);
      request.onsuccess = () => {
        const value: unknown = request.result;
        const parsed = WorkshopDraftSchema.safeParse(value);
        resolve(parsed.success ? parsed.data : null);
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export type { Drawing };

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
