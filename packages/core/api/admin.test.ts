// @vitest-environment node
import { afterEach,expect,it,vi } from "vitest";
import { ApiClient } from "./client";

afterEach(() => vi.unstubAllGlobals());
const policy = {serviceId:"auro-tanks",enabled:true,disabledTools:[],revision:0};
const service = {id:"auro-tanks",name:"Tank Defense",endpoint:"/api/tanks/mcp",protocolVersion:"2025-11-25",policy,tools:[],stats:{},toolStats:{}};
function respond(data: unknown) { const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(data),{headers:{"Content-Type":"application/json"}}));vi.stubGlobal("fetch",fetcher);return fetcher; }
it("clears workspace routing headers for the global administrator API",async () => {
  const fetcher=respond({isAdmin:true,configured:true});
  expect((await new ApiClient("https://api.example.invalid").getAdminAccess()).isAdmin).toBe(true);
  const headers=new Headers(fetcher.mock.calls[0]![1].headers);
  expect(headers.get("X-Workspace-ID")).toBe("");expect(headers.get("X-Workspace-Slug")).toBe("");
});
it.each([{}, {isAdmin:"true"}, {isAdmin:null}])("never grants administrator access from a malformed response",async data => {
  respond(data);await expect(new ApiClient("https://api.example.invalid").getAdminAccess()).rejects.toThrow("invalid_admin_response");
});
it("accepts additive fields and supplies noncritical statistics defaults",async () => {
  respond({services:[{...service,futureField:true}]});
  const [parsed]=await new ApiClient("https://api.example.invalid").listAdminMCPServices();
  expect(parsed?.stats.calls).toBe(0);expect(parsed?.policy.enabled).toBe(true);
});
it("rejects a policy attached to a different service",async () => {
  respond({services:[{...service,policy:{...policy,serviceId:"another"}}]});
  await expect(new ApiClient("https://api.example.invalid").listAdminMCPServices()).rejects.toThrow("invalid_admin_response");
});
it("preserves the compare-and-swap revision on policy updates",async () => {
  const fetcher=respond({...policy,enabled:false,revision:2});
  await new ApiClient("https://api.example.invalid").updateAdminMCPPolicy("auro-tanks",{enabled:false,disabledTools:[],expectedRevision:1});
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({enabled:false,disabledTools:[],expectedRevision:1});
});
it("rejects activity from a different service",async () => {
  respond({items:[{id:"11111111-1111-4111-8111-111111111111",serviceId:"another",actorId:"11111111-1111-4111-8111-111111111111",kind:"call",outcome:"success",durationMs:1,occurredAt:"2026-10-24T00:00:00Z"}]});
  await expect(new ApiClient("https://api.example.invalid").getAdminMCPActivity("auro-tanks",{})).rejects.toThrow("invalid_admin_response");
});

it("rejects invalid world analysis dates and keeps global routing separate", async () => {
  const fetcher = respond({ from: "not-a-date", items: [] });
  const client = new ApiClient("https://api.example.invalid");
  await expect(client.listWorldOps("segment=visited")).rejects.toThrow("invalid_world_operations_response");
  expect(new Headers(fetcher.mock.calls[0]![1].headers).get("X-Workspace-ID")).toBe("");
});

it("rejects a follow-up from another world and an invalid audit history", async () => {
  const world = "00000000-0000-4000-8000-000000000001";
  const other = "00000000-0000-4000-8000-000000000002";
  const client = new ApiClient("https://api.example.invalid");
  respond({ items: [{
    id: other, workspace_id: other, assignee_id: world, assignee: "Operator", reason: "Check creation",
    due_on: null, version: 1, closed_at: null, created_at: "2026-11-05T04:00:00Z",
  }], more: false });
  await expect(client.listWorldOpsFollowups(world, 0)).rejects.toThrow("invalid_world_operations_response");
  respond({ items: [{ version: "bad" }], more: false });
  await expect(client.listWorldOpsEntries(world, other, 0)).rejects.toThrow("invalid_world_operations_response");
});
