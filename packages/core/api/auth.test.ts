// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client";
import { setSchemaLogger } from "./schema";
import { noopLogger } from "../logger";

afterEach(() => {
  vi.unstubAllGlobals();
  setSchemaLogger(noopLogger);
});

describe("authentication response boundary", () => {
  it("redacts credentials from malformed response diagnostics", async () => {
    const warn = vi.fn();
    setSchemaLogger({ ...noopLogger, warn });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ token: "private-session-token", user: null }))));
    await expect(new ApiClient("https://api.example.test").loginWithPassword("user@example.com", "password")).rejects.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private-session-token");
  });
  it.each([{}, { token: "", user: { id: "u1" } }, { token: "t", user: {} }, { token: 42, user: null }])("rejects malformed auth data without accepting a session", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify(body))));
    const client = new ApiClient("https://api.example.test");
    await expect(client.loginWithPassword("user@example.com", "secret-password")).rejects.toThrow(/invalid sign-in response/i);
    await expect(client.verifyCode("user@example.com", "123456", "new-password")).rejects.toThrow();
    await expect(client.googleLogin("code", "https://app.example.test/callback")).rejects.toThrow();
    expect(client.getToken()).toBeNull();
  });

  it("normalizes missing optional user fields and sends password only when setting it", async () => {
    const request = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ token: "t", user: { id: "u1" } })));
    vi.stubGlobal("fetch", request);
    const client = new ApiClient("https://api.example.test");
    const result = await client.loginWithPassword("user@example.com", " secret ");
    expect(result.user).toMatchObject({ id: "u1", name: "", avatar_url: null });
    await client.verifyCode("user@example.com", "123456");
    await client.verifyCode("user@example.com", "123456", "new-password");
    const bodies = request.mock.calls.map((call) => JSON.parse(call[1].body));
    expect(bodies).toEqual([
      { email: "user@example.com", password: " secret " },
      { email: "user@example.com", code: "123456" },
      { email: "user@example.com", code: "123456", password: "new-password" },
    ]);
  });

  it("keeps a rejected login separate from expiry of an existing session", async () => {
    const onUnauthorized = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: "invalid email or password" }), { status: 401 })));
    const client = new ApiClient("https://api.example.test", { onUnauthorized });
    await expect(client.loginWithPassword("user@example.com", "wrong")).rejects.toThrow(/invalid email or password/);
    expect(onUnauthorized).not.toHaveBeenCalled();
    await expect(client.getMe()).rejects.toThrow();
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});
