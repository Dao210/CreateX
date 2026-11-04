// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "./client";
import { FISH_EXAMPLES } from "../fish/schema";
const ws="11111111-1111-4111-8111-111111111111", id="22222222-2222-4222-8222-222222222222", oceanId="33333333-3333-4333-8333-333333333333";
const fish={id,workspaceId:ws,ownerId:id,revision:1,contentHash:`sha256:${"a".repeat(64)}`,compilerVersion:1,rulesVersion:1,draft:FISH_EXAMPLES[0],origin:"mcp",createdAt:"2026-11-03T00:00:00Z"};
const resident={id,oceanId,revision:1,seed:17,fish};
const ocean={id:oceanId,workspaceId:ws,ownerId:id,visibility:"private",revision:1,capacity:50,residents:[resident]};
function response(data:unknown){const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify(data),{headers:{"Content-Type":"application/json"}}));vi.stubGlobal("fetch",fetcher);return fetcher;}
afterEach(()=>vi.unstubAllGlobals());
it("reads scoped creations and allows a missing ocean without inventing residents",async()=>{const fetcher=response({fish:[fish]});const api=new ApiClient("https://api.example.invalid");expect((await api.listFish(ws))[0]?.draft.name).toBe(fish.draft?.name);expect(new Headers(fetcher.mock.calls[0]![1].headers).get("X-Workspace-ID")).toBe(ws);response({ocean:null});expect(await api.getFishOcean(ws)).toBeNull();response({ocean});expect((await api.getFishOcean(ws,oceanId))?.residents).toHaveLength(1);});
it.each([{}, {fish:[{}]}, {fish:[{...fish,workspaceId:id}]}, {fish:[{...fish,compilerVersion:2}]}, {fish:[{...fish,draft:{...fish.draft,script:"run()"}}]}])("rejects malformed fish libraries and unsupported compilers",async raw=>{response(raw);await expect(new ApiClient("https://api.example.invalid").listFish(ws)).rejects.toThrow("invalid_fish_response");});
it.each([{...ocean,id}, {...ocean,residents:[{...resident,oceanId:id}]}, {...ocean,residents:[resident,resident]}, {...ocean,residents:[{...resident,fish:{...fish,workspaceId:id}}]}])("rejects mismatched ocean and resident scope",async value=>{response({ocean:value});await expect(new ApiClient("https://api.example.invalid").getFishOcean(ws,oceanId)).rejects.toThrow("invalid_fish_response");});
it("rejects substituted releases and revision applications",async()=>{response({resident,oceanUrl:"https://app.example.invalid/w/fish"});const api=new ApiClient("https://api.example.invalid");const input={requestId:id,oceanId,fishId:id,revision:2,contentHash:fish.contentHash};await expect(api.releaseFish(ws,input)).rejects.toThrow("invalid_fish_response");response({resident:{...resident,fish:{...fish,revision:2}},oceanUrl:"https://app.example.invalid/w/fish"});await expect(api.applyFishRevision(ws,{...input,residentId:id,expectedResidentRevision:1})).rejects.toThrow("invalid_fish_response");});

it("accepts a resolved ocean for an implicit release and checks explicit destinations", async () => {
  const api = new ApiClient("https://api.example.invalid");
  const input = { requestId: id, fishId: id, revision: 1, contentHash: fish.contentHash };
  const oceanUrl = "https://app.example.invalid/w/fish";

  response({ resident, oceanUrl });
  await expect(api.releaseFish(ws, input)).resolves.toMatchObject({ resident: { oceanId } });

  response({ resident: { ...resident, oceanId: "" }, oceanUrl });
  await expect(api.releaseFish(ws, input)).rejects.toThrow("invalid_fish_response");

  response({ resident, oceanUrl });
  await expect(api.releaseFish(ws, { ...input, oceanId: id })).rejects.toThrow("invalid_fish_response");
});
