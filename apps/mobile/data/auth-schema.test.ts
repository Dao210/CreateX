// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { LoginResponseSchema } from "./schemas";
import { parseWithFallback } from "../lib/parse-response";

describe("mobile authentication response boundary", () => {
  it.each([{}, { token: "", user: { id: "u1" } }, { token: "t", user: {} }, { token: "t", user: null }])("rejects malformed credentials", (body) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(parseWithFallback(body, LoginResponseSchema, null, { endpoint: "POST /auth/login", redact: true })).toBeNull();
      expect(warn.mock.calls[0]?.[1]).not.toHaveProperty("received");
    } finally {
      warn.mockRestore();
    }
  });

  it("accepts authenticated users from older response shapes", () => {
    const result = LoginResponseSchema.parse({ token: "session-token", user: { id: "u1", name: "Alice", email: "alice@example.com" } });
    expect(result).toMatchObject({ token: "session-token", user: { id: "u1", avatar_url: null } });
  });
});
