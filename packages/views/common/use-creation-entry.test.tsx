import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCreationEntry } from "./use-creation-entry";
const navigation = vi.hoisted(() => ({ pathname: "/world/fish", searchParams: new URLSearchParams(), hash: "#ocean", replace: vi.fn() }));
vi.mock("../navigation", () => ({ useNavigation: () => navigation }));
beforeEach(() => { navigation.searchParams = new URLSearchParams(); navigation.replace.mockClear(); });
afterEach(cleanup);
it("opens the real dialog once and consumes only the creation intent", () => {
  navigation.searchParams = new URLSearchParams("create=1&fish=selected");
  const { result, rerender } = renderHook(() => useCreationEntry());
  expect(result.current[0]).toBe(true);
  expect(navigation.replace).toHaveBeenCalledExactlyOnceWith("/world/fish?fish=selected#ocean");
  navigation.searchParams = new URLSearchParams("fish=selected"); rerender();
  act(() => result.current[1](false));
  expect(result.current[0]).toBe(false);
  expect(navigation.replace).toHaveBeenCalledOnce();
});
it("waits until creation is available before consuming the entry", () => {
  navigation.searchParams = new URLSearchParams("create=1");
  const { result, rerender } = renderHook(({ enabled }) => useCreationEntry(enabled), { initialProps: { enabled: false } });
  expect(result.current[0]).toBe(false); expect(navigation.replace).not.toHaveBeenCalled();
  rerender({ enabled: true }); expect(result.current[0]).toBe(true);
});
it("lets ordinary dialog actions work without navigating", () => {
  const { result } = renderHook(() => useCreationEntry());
  act(() => result.current[1](true)); expect(result.current[0]).toBe(true);
  expect(navigation.replace).not.toHaveBeenCalled();
});
