import type { StorageAdapter } from "@auro/core/types";

export const gameStorage: StorageAdapter = {
  getItem: (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* The game still works without durable preferences. */
    }
  },
  removeItem: (key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* Storage may be disabled. */
    }
  },
};
