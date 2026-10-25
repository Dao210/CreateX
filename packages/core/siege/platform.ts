import type { StorageAdapter } from "../types/storage";
import type { Drawing, WorkshopDraft } from "./schema";

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
  /**
   * How the workshop reaches `/api/siege`.
   *
   * Hosted (web, desktop) this is the shared client's authenticated fetch, so
   * requests carry the workspace slug and whichever credential the host uses —
   * a cookie plus CSRF token on web, a bearer token on desktop. The standalone
   * shell passes an unauthenticated fetch because it serves the game with no
   * Auro session at all.
   */
  request: typeof fetch;
  /**
   * Base URL the arena art lives under, with a trailing slash. Web serves it
   * from /siege/art/; standalone mode's Vite build has the same layout because
   * that is what base: "/siege/" produces. A host that bundles assets
   * elsewhere overrides this.
   */
  assetBase: string;
}
