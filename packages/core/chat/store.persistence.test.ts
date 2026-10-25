// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatStore } from "./store";
import { setCurrentWorkspace } from "../platform/workspace-storage";
import { clearRegisteredWorkspaceDrafts, resetAllRegisteredDrafts } from "../drafts/cleanup-registry";
import type { StorageAdapter } from "../types/storage";

function storageFixture() {
  const values = new Map<string, string>();
  const storage: StorageAdapter = {
    getItem: (key) => values.get(key) ?? null,
    setItem: vi.fn((key, value) => { values.set(key, value); }),
    removeItem: (key) => { values.delete(key); },
  };
  return storage;
}

beforeEach(async () => {
  setCurrentWorkspace(null, null);
  await Promise.resolve();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("chat draft persistence", () => {
  it("updates memory immediately while batching consecutive typing writes", () => {
    const storage = storageFixture();
    const store = createChatStore({ storage });
    store.getState().setInputDraft("a", "one", { deferPersistence: true });
    store.getState().setInputDraft("a", "two", { deferPersistence: true });
    expect(store.getState().inputDrafts.a).toBe("two");
    expect(storage.setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.getItem("auro:chat:drafts")!)).toEqual({ a: "two" });
  });

  it("flushes typing before switching sessions and preserves immediate programmatic restores", () => {
    const storage = storageFixture();
    const store = createChatStore({ storage });
    store.getState().setInputDraft("a", "typed", { deferPersistence: true });
    store.getState().setActiveSession("b");
    expect(JSON.parse(storage.getItem("auro:chat:drafts")!)).toEqual({ a: "typed" });
    store.getState().setInputDraft("b", "restored");
    expect(JSON.parse(storage.getItem("auro:chat:drafts")!)).toEqual({ a: "typed", b: "restored" });
  });

  it("writes pending text to its original workspace before rehydrating the next", async () => {
    setCurrentWorkspace("first", "ws-first");
    await Promise.resolve();
    const storage = storageFixture();
    const store = createChatStore({ storage });
    store.getState().setInputDraft("a", "first workspace", { deferPersistence: true });
    setCurrentWorkspace("second", "ws-second");
    await Promise.resolve();
    vi.advanceTimersByTime(300);
    expect(JSON.parse(storage.getItem("auro:chat:drafts:first")!)).toEqual({ a: "first workspace" });
    expect(storage.getItem("auro:chat:drafts:second")).toBeNull();
    expect(store.getState().inputDrafts).toEqual({});
  });

  it("does not resurrect a sent draft or a workspace's deleted drafts", async () => {
    setCurrentWorkspace("first", "ws-first");
    await Promise.resolve();
    const storage = storageFixture();
    const store = createChatStore({ storage });
    store.getState().setInputDraft("a", "send", { deferPersistence: true });
    store.getState().clearInputDraft("a");
    vi.advanceTimersByTime(300);
    expect(storage.getItem("auro:chat:drafts:first")).toBeNull();
    store.getState().setInputDraft("a", "delete", { deferPersistence: true });
    clearRegisteredWorkspaceDrafts(storage, "first");
    vi.advanceTimersByTime(300);
    expect(storage.getItem("auro:chat:drafts:first")).toBeNull();
  });

  it("cancels pending writes when logout resets the stores", () => {
    const storage = storageFixture();
    const store = createChatStore({ storage });
    store.getState().setInputDraft("a", "private", { deferPersistence: true });
    resetAllRegisteredDrafts();
    vi.advanceTimersByTime(300);
    expect(storage.getItem("auro:chat:drafts")).toBeNull();
    expect(store.getState().inputDrafts).toEqual({});
  });
  it("keeps a failed write available for a later lifecycle flush", () => {
    const storage = storageFixture();
    const store = createChatStore({ storage });
    const setItem = vi.mocked(storage.setItem);
    setItem.mockImplementationOnce(() => { throw new Error("Storage unavailable"); });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    store.getState().setInputDraft("a", "recover", { deferPersistence: true });
    vi.advanceTimersByTime(300);
    expect(storage.getItem("auro:chat:drafts")).toBeNull();
    store.getState().flushInputDrafts();
    expect(JSON.parse(storage.getItem("auro:chat:drafts")!)).toEqual({ a: "recover" });
    warning.mockRestore();
  });

});
