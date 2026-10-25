// @vitest-environment node
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createQueryRefreshScheduler } from "./query-refresh-scheduler";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("coalesces a burst by query key without postponing a continuous stream", async () => {
  const qc = new QueryClient();
  const invalidate = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
  const scheduler = createQueryRefreshScheduler(qc);
  scheduler.schedule(["pending", "a"]);
  await vi.advanceTimersByTimeAsync(90);
  scheduler.schedule(["pending", "a"]);
  scheduler.schedule(["pending", "b"]);
  await vi.advanceTimersByTimeAsync(10);
  expect(invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: ["pending", "a"] }, { cancelRefetch: false });
  await vi.advanceTimersByTimeAsync(90);
  expect(invalidate).toHaveBeenCalledTimes(2);
  scheduler.dispose();
});

it("serializes slow refreshes and retains one trailing refresh for later events", async () => {
  const qc = new QueryClient();
  let finish!: () => void;
  const invalidate = vi.spyOn(qc, "invalidateQueries").mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue();
  const scheduler = createQueryRefreshScheduler(qc);
  scheduler.schedule(["messages", "a"]);
  await vi.advanceTimersByTimeAsync(100);
  scheduler.schedule(["messages", "a"]);
  scheduler.schedule(["messages", "a"]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(invalidate).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(100);
  expect(invalidate).toHaveBeenCalledTimes(2);
  scheduler.dispose();
});

it("disposes timers and does not arm a trailing refresh after cleanup", async () => {
  const qc = new QueryClient();
  let finish!: () => void;
  const invalidate = vi.spyOn(qc, "invalidateQueries").mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  const scheduler = createQueryRefreshScheduler(qc);
  scheduler.schedule(["messages", "a"]);
  await vi.advanceTimersByTimeAsync(100);
  scheduler.schedule(["messages", "a"]);
  scheduler.schedule(["pending", "b"]);
  scheduler.dispose();
  finish();
  await vi.advanceTimersByTimeAsync(1000);
  expect(invalidate).toHaveBeenCalledTimes(1);
});
