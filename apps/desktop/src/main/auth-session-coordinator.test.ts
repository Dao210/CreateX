// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  AuthSessionCoordinator,
  parseAuthSessionUserId,
} from "./auth-session-coordinator";

describe("AuthSessionCoordinator", () => {
  it("invalidates account-scoped work once per session transition", () => {
    const coordinator = new AuthSessionCoordinator();

    expect(coordinator.reportMain("user-a")).toBe(false);
    expect(coordinator.reportMain("user-a")).toBe(false);
    expect(coordinator.reportMain(null)).toBe(true);
    expect(coordinator.reportMain(null)).toBe(false);
    expect(coordinator.reportMain("user-b")).toBe(true);
  });


});

describe("parseAuthSessionUserId", () => {
  it("accepts a bounded user id or explicit logged-out state", () => {
    expect(parseAuthSessionUserId(" user-a ")).toBe("user-a");
    expect(parseAuthSessionUserId(null)).toBeNull();
    expect(parseAuthSessionUserId(" ")).toBeUndefined();
    expect(parseAuthSessionUserId(42)).toBeUndefined();
    expect(parseAuthSessionUserId("x".repeat(257))).toBeUndefined();
  });
});
