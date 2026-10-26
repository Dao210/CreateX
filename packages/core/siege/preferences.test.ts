// @vitest-environment node
import { expect, it } from "vitest";
import { scopedSiegeStorage, siegePreferencesKey } from "./preferences";

it("isolates all records across users and workspaces without reading unowned records", () => {
  const values = new Map<string, string>([["siege.session", "unowned"]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const first = scopedSiegeStorage(storage, siegePreferencesKey("alice", "alpha"));
  const second = scopedSiegeStorage(storage, siegePreferencesKey("alice", "beta"));
  const other = scopedSiegeStorage(storage, siegePreferencesKey("bob", "alpha"));
  expect(first.getItem("siege.session")).toBeNull();
  first.setItem("siege.session", "owned");
  expect(first.getItem("siege.session")).toBe("owned");
  expect(second.getItem("siege.session")).toBeNull();
  expect(other.getItem("siege.session")).toBeNull();
  second.removeItem("siege.session");
  expect(first.getItem("siege.session")).toBe("owned");
  expect(() => siegePreferencesKey("", "alpha")).toThrow();
});
