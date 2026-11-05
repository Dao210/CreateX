import { writeFile } from "node:fs/promises";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import catalog from "../packages/core/fish/catalog.json" with { type: "json" };
import { TestApiClient } from "./fixtures";
let api:TestApiClient, workspace:Awaited<ReturnType<TestApiClient["createWorkspace"]>>, token:string;
const run=`${Date.now().toString(36)}-${process.pid}`;
test.setTimeout(120000);
test.use({viewport:{width:1440,height:1000},launchOptions:{args:["--enable-unsafe-swiftshader"]}});
test.beforeAll(async()=>{api=new TestApiClient();await api.login(`fish-${run}@auro.ai`,"Fish QA");token=api.getToken()!;workspace=await api.createWorkspace("Fish ocean QA",`fish-${run}`);await api.markUserOnboarded();});
test.afterAll(async()=>{if(workspace){api.setWorkspaceId(workspace.id);api.setWorkspaceSlug(workspace.slug);await api.deleteWorkspace();}});
test.beforeEach(async({page,baseURL})=>{await page.context().addCookies([{name:"auro-locale",value:"zh-Hans",url:baseURL!}]);await page.addInitScript(value=>localStorage.setItem("auro_token",value),token);});
const headers=(worldId=workspace.id)=>({Authorization:`Bearer ${token}`,"X-Workspace-ID":worldId,Accept:"application/json, text/event-stream","MCP-Protocol-Version":"2025-11-25"});
async function tool(request:APIRequestContext,name:string,args:object={},worldId=workspace.id){const response=await request.post("/api/fish/mcp",{headers:headers(worldId),data:{jsonrpc:"2.0",id:randomUUID(),method:"tools/call",params:{name,arguments:args}}});expect(response.status()).toBe(200);const body=await response.json();expect(body.error).toBeUndefined();expect(body.result.isError,JSON.stringify(body.result)).toBe(false);return body.result.structuredContent;}
test("MCP creates a persistent fish, applies an exact revision and recalls without deleting the creation",async({request,page})=>{
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 page.on("console", message => {
  if (message.type() === "error" && message.text().includes("THREE.WebGLProgram")) errors.push(message.text());
 });
 const anonymous=await request.get("/api/fish/v1/catalog");expect(anonymous.status()).toBe(401);
 const contract=await tool(request,"fish_get_catalog");expect(contract.profile).toBe("fish@1");
 const invalid=await tool(request,"fish_validate",{draft:{...catalog.examples[0],body:{...catalog.examples[0]!.body,lengthMm:9999}}});expect(invalid.valid).toBe(false);
 const listed = await request.post("/api/fish/mcp", {
  headers: headers(),
  data: { jsonrpc: "2.0", id: randomUUID(), method: "tools/list" },
 });
 expect(listed.ok()).toBe(true);
 const { result } = await listed.json();
 expect(result.tools).toEqual(expect.arrayContaining([
  expect.objectContaining({ name: "fish_release", inputSchema: expect.objectContaining({
   required: ["requestId", "fishId", "revision", "contentHash"],
   properties: expect.objectContaining({ oceanId: expect.objectContaining({ format: "uuid" }) }),
  }) }),
  expect.objectContaining({ name: "fish_apply_revision", inputSchema: expect.objectContaining({
   required: expect.arrayContaining(["oceanId", "residentId", "expectedResidentRevision"]),
  }) }),
 ]));
 expect((await tool(request, "fish_get_ocean")).ocean).toBeNull();
 const intent={requestId:randomUUID(),draft:{...catalog.examples[0],name:"MCP 蓝帆鱼"}};
 const saved=await tool(request,"fish_save",intent),replay=await tool(request,"fish_save",intent);expect(replay.id).toBe(saved.id);
 const placement={requestId:randomUUID(),fishId:saved.id,revision:saved.revision,contentHash:saved.contentHash};
 const released=await tool(request,"fish_release",placement),again=await tool(request,"fish_release",placement);
 expect(again).toEqual(released);
 const oceanId = released.resident.oceanId;
 expect(oceanId).toBeTruthy();
 expect(new URL(released.oceanUrl).searchParams.get("ocean")).toBe(oceanId);
 await page.goto(released.oceanUrl);await expect(page.getByTestId("fish-scene").locator("canvas")).toBeVisible({timeout:60000});await expect(page.getByText("MCP 蓝帆鱼").first()).toBeVisible();await expect(page.getByRole("button",{name:"收回",exact:true})).toBeVisible();
 await page.reload();await expect(page.getByRole("button",{name:"收回",exact:true})).toBeVisible({timeout:30000});
 await expect(page.getByTestId("fish-scene").locator("canvas")).toHaveAttribute("data-ready","true",{timeout:60000});
 const liveCanvas = await page.getByTestId("fish-scene").locator("canvas").elementHandle();
 await page.getByRole("button",{name:"全屏",exact:true}).click();
 await expect(page.getByRole("button",{name:"退出全屏",exact:true})).toBeVisible();
 await expect(page.getByRole("button",{name:"创造一条鱼",exact:true})).not.toBeVisible();
 await page.getByRole("button",{name:"退出全屏",exact:true}).click();
 expect(await liveCanvas!.evaluate(node=>node.isConnected)).toBe(true);
 await expect(page.getByRole("button",{name:"继续",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"继续",exact:true}).click();
 await page.screenshot({path:"test-results/fish/ocean.png",fullPage:true});
 const second=await tool(request,"fish_save",{requestId:randomUUID(),fishId:saved.id,expectedRevision:1,draft:{...saved.draft,name:"MCP 长尾蓝帆鱼",tail:{...saved.draft.tail,length:600}}});
 const before=await tool(request,"fish_get_ocean",{oceanId});expect(before.ocean.residents[0].fish.revision).toBe(1);
 const applied=await tool(request,"fish_apply_revision",{requestId:randomUUID(),oceanId,fishId:saved.id,revision:2,contentHash:second.contentHash,residentId:released.resident.id,expectedResidentRevision:1});expect(applied.resident.id).toBe(released.resident.id);
 await expect(page.getByText("MCP 长尾蓝帆鱼").first()).toBeVisible({timeout:15000});
 await page.goto(`/${workspace.slug}/me?filter=fish`);await expect(page.getByRole("group",{name:"MCP 长尾蓝帆鱼"})).toBeVisible();await page.getByRole("link",{name:"前往海洋",exact:true}).click();await expect(page.getByTestId("fish-scene").locator("canvas")).toBeVisible();
 await tool(request,"fish_recall",{requestId:randomUUID(),residentId:applied.resident.id,expectedResidentRevision:applied.resident.revision});expect((await tool(request,"fish_get_ocean",{oceanId})).ocean.residents).toHaveLength(0);expect((await tool(request,"fish_list")).fish.some((f:{id:string})=>f.id===saved.id)).toBe(true);
 expect(errors).toEqual([]);
});
test("creates and releases through the UI, supports a narrow viewport, and protects private oceans",async({page,request})=>{
 const world = await api.createWorkspace("Fish first release UI", `fish-ui-${run}`);
 try {
  await page.goto(`/${world.slug}/fish`);
  await page.getByRole("button", { name: "创造一条鱼", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("canvas")).toBeVisible({ timeout: 30000 });
  await dialog.getByRole("textbox", { name: "名字", exact: true }).fill("UI 珍珠鱼");
  await dialog.getByRole("button", { name: "保存鱼", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await tool(request, "fish_get_ocean", {}, world.id)).ocean).toBeNull();

  const writes: string[] = [];
  page.on("request", outgoing => {
   const path = new URL(outgoing.url()).pathname;
   if (outgoing.method() === "POST" && path.startsWith("/api/fish/v1/")) writes.push(path);
  });
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "UI 珍珠鱼", exact: true }) });
  const sent = page.waitForRequest(outgoing => outgoing.method() === "POST" && new URL(outgoing.url()).pathname === "/api/fish/v1/residents");
  await card.getByRole("button", { name: "放入海洋", exact: true }).click();
  expect((await sent).postDataJSON()).not.toHaveProperty("oceanId");
  await expect(page.getByRole("button", { name: "收回", exact: true })).toBeVisible();
  expect(writes).toEqual(["/api/fish/v1/residents"]);
  const ocean = (await tool(request, "fish_get_ocean", {}, world.id)).ocean;
  await expect.poll(() => new URL(page.url()).searchParams.get("ocean")).toBe(ocean.id);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/fish/mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const outsider = new TestApiClient();
  await outsider.login(`fish-visitor-${run}@auro.ai`, "Visitor");
  const response = await request.get(`/api/fish/v1/ocean?id=${ocean.id}`, {
   headers: { Authorization: `Bearer ${outsider.getToken()}`, "X-Workspace-ID": world.id },
  });
  expect([403, 404]).toContain(response.status());
  await page.getByRole("button", { name: "收回", exact: true }).click();
  await expect(page.getByRole("button", { name: "收回", exact: true })).not.toBeVisible();
 } finally {
  await api.deleteWorkspace();
 }
});

test("fifty distinct fish remain stable throughout the soak",async({page,request},testInfo)=>{
 test.skip(process.env.FISH_SOAK !== "1", "Set FISH_SOAK=1 for the ten-minute browser soak.");
 test.setTimeout(720000);
 const ocean=await tool(request,"fish_create_ocean",{requestId:randomUUID()});
 for(let i=0;i<50;i++){
  const draft=structuredClone(catalog.examples[i%6]!);draft.name=`Soak ${i+1}`;draft.body.lengthMm+=i;draft.appearance.body=`#${(0x368b9a+i*997).toString(16).padStart(6,"0")}`;
  const fish=await tool(request,"fish_save",{requestId:randomUUID(),draft});
  await tool(request,"fish_release",{requestId:randomUUID(),oceanId:ocean.id,fishId:fish.id,revision:fish.revision,contentHash:fish.contentHash});
 }
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(`/${workspace.slug}/fish?ocean=${ocean.id}`);
 const canvas=page.getByTestId("fish-scene").locator("canvas");await expect(canvas).toHaveAttribute("data-ready","true",{timeout:60000});
 const before=await canvas.getAttribute("data-geometries");
 const soakMs=Math.max(60000, Math.min(600000, Number(process.env.FISH_SOAK_MS ?? 600000)));
 const measurements=await page.evaluate(async(duration)=>{
  const samples:number[]=[];const started=performance.now();let previous=started;
  await new Promise<void>((resolve,reject)=>{const frame=(now:number)=>{if(!document.querySelector('[data-testid="fish-scene"] canvas')||document.querySelector(".fish-scene-error")){reject(new Error(`Ocean scene disappeared after ${Math.round((now-started)/1000)} seconds`));return;}if(now-started>2000)samples.push(now-previous);previous=now;if(now-started>=duration)resolve();else requestAnimationFrame(frame);};requestAnimationFrame(frame);});
  samples.sort((a,b)=>a-b);return {durationMs:performance.now()-started,frames:samples.length,p50Ms:samples[Math.floor(samples.length*0.5)],p95Ms:samples[Math.floor(samples.length*0.95)],userAgent:navigator.userAgent};
 },soakMs);
 const after = await canvas.getAttribute("data-geometries");
 // The first close pass may upload one additional mesh per resident.
 expect(Number(after)).toBeLessThanOrEqual(Number(before) + 50);expect(errors).toEqual([]);
 const report=JSON.stringify({...measurements,drawCalls:await canvas.getAttribute("data-draw-calls"),geometriesBefore:before,geometriesAfter:after},null,2);
 await writeFile("test-results/fish/soak.json",report);
 await testInfo.attach("fish-soak.json",{body:report,contentType:"application/json"});
 await page.screenshot({path:"test-results/fish/soak.png",fullPage:true});
});
