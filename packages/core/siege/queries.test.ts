// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient, setApiInstance } from "../api";
import { createSiegeClient, siegeKeys } from "./queries";

afterEach(() => vi.unstubAllGlobals());
it("pins credentials and workspace headers to the requested scope", async () => {
  const api = new ApiClient("https://api.example.invalid"); api.setToken("test-token"); setApiInstance(api);
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ mode: "disabled", ready: false, rulesVersion: "p0.2", parts: [] })));
  vi.stubGlobal("fetch", fetcher);
  const scope = { workspaceId: "workspace-a", workspaceSlug: "alpha", userId: "alice" };
  await createSiegeClient(scope).status();
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe("https://api.example.invalid/api/siege/status");
  expect(new Headers(init.headers).get("X-Workspace-ID")).toBe("workspace-a");
  expect(new Headers(init.headers).get("X-Workspace-Slug")).toBe("alpha");
  expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-token");
  expect(siegeKeys.session(scope, "same-id")).not.toEqual(siegeKeys.session({ ...scope, userId: "bob" }, "same-id"));
  expect(siegeKeys.session(scope, "same-id")).not.toEqual(siegeKeys.session({ ...scope, workspaceId: "workspace-b" }, "same-id"));
});
