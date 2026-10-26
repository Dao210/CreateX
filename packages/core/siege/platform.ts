import type { StorageAdapter } from "../types/storage";
import type { CannonDesign, Drawing, WorkshopDraft } from "./schema";

/**
 * The browser capabilities the workshop needs, injected instead of imported.
 *
 * Before the Auro integration the game called `localStorage`, `indexedDB`,
 * `crypto.randomUUID`, `crypto.subtle.digest` and `document.createElement`
 * directly, which tied every component to a DOM runtime. Web and desktop both
 * provide these, so they share one implementation; a React Native client would
 * provide its own (AsyncStorage, expo-crypto, expo-file-system) without
 * touching component code.
 *
 * `@auro/views/siege` accepts this as a prop and never reaches for a global.
 */
export interface SiegePlatform {
  /** Durable small values (selected session, campaign progress, loadout). */
  preferences: StorageAdapter;
  /** The auto-saved workshop draft. IndexedDB on web, a file on native. */
  loadDraft(): Promise<WorkshopDraft | null>;
  saveDraft(draft: WorkshopDraft): Promise<void>;
  /** A UUID; `crypto.randomUUID` on web. */
  randomId(): string;
  /** SHA-256 of the canonical drawing JSON, hex encoded. */
  drawingHash(drawing: Drawing): Promise<string>;
  /** Hands a generated image to the user (download on web, share on native). */
  download(blob: Blob, filename: string): void;
  /** Render and export a design using the host canvas implementation. */
  exportImage(drawing: Drawing, cannon: CannonDesign | null, filename: string): void;
  /** Resolve a bundled, versioned game asset. */
  assetUrl(id: string): string;
}
