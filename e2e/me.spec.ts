import { test, expect } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { TestApiClient } from "./fixtures";
import { SAMPLES, canonicalDrawing, sampleSpec } from "../packages/core/siege";

let api: TestApiClient;
let workspace: Awaited<ReturnType<TestApiClient["createWorkspace"]>>;
let token: string;
let workspaceId: string;
const run = `${Date.now().toString(36)}-${process.pid}`;
const tankDraft = { profile: "tank-defense@1", name: "MCP 收藏坦克", parts: { chassis: "light", armor: "standard", cannon: "rapid" }, appearance: { body: "#26b36a", accent: "#e5f79b", pattern: "stripe" } };

test.use({ viewport: { width: 1440, height: 980 } });
test.beforeAll(async () => {
  api = new TestApiClient();
  await api.login(`me-${run}@auro.ai`, "My Space QA");
  workspace = await api.createWorkspace("My Space QA", `me-${run}`);
  await api.markUserOnboarded();
  token = api.getToken()!;
  workspaceId = workspace.id;
});
test.afterAll(async () => {
  if (workspace) await api.deleteWorkspace();
  await api?.cleanup();
});
test.beforeEach(async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: "auro-locale", value: "zh-Hans", url: baseURL! }]);
  await page.addInitScript(value => { localStorage.setItem("auro_token", value); }, token);
});

function headers() { return { Authorization: `Bearer ${token}`, "X-Workspace-ID": workspaceId, Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" }; }
async function rpc(request: import("@playwright/test").APIRequestContext, method: string, params: object = {}) {
  const response = await request.post("/api/tanks/mcp", { headers: headers(), data: { jsonrpc: "2.0", id: randomUUID(), method, params } });
  expect(response.status()).toBe(200);
  const body = await response.json(); expect(body.error).toBeUndefined(); return body.result;
}

test("collects MCP characters, saved blueprints and merged progress", async ({ page, request, baseURL }) => {
  await rpc(request, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "me-e2e", version: "1" } });
  await request.post("/api/tanks/mcp", { headers: headers(), data: { jsonrpc: "2.0", method: "notifications/initialized" } });
  const savedTank = await rpc(request, "tools/call", { name: "tank_save_character", arguments: { requestId: randomUUID(), draft: tankDraft } });
  expect(savedTank.isError).toBe(false);
  expect(savedTank.structuredContent.origin).toBe("mcp");

  const sessionResponse = await request.post("/api/siege/sessions", { headers: headers(), data: { requestId: randomUUID() } });
  expect(sessionResponse.status()).toBe(201);
  const session = await sessionResponse.json();
  const drawing = structuredClone(SAMPLES[0]!.drawing);
  const hash = createHash("sha256").update(canonicalDrawing(drawing)).digest("hex");
  const spec = sampleSpec(SAMPLES[0]!, hash);
  const saveResponse = await request.post(`/api/siege/sessions/${session.id}/blueprints`, { headers: headers(), data: { requestId: randomUUID(), expectedVersion: session.version, name: "我的旋转锤", drawing, spec, cannonDesign: null } });
  expect(saveResponse.status()).toBe(200);

  const libraryResponse = await request.get("/api/siege/library", { headers: headers() });
  expect(libraryResponse.status()).toBe(200);
  const library = await libraryResponse.json();
  expect(library.blueprints.map((item: { name: string }) => item.name)).toContain("我的旋转锤");
  expect(library.blueprints[0].sessionId).toBe(session.id);

  expect((await request.put("/api/game-progress/siege", { headers: headers(), data: { stars: [3, 2, 0, 0, 0, 0, 0, 0] } })).status()).toBe(200);
  expect((await request.put("/api/game-progress/tanks", { headers: headers(), data: { best: 1234, unlocked: 3 } })).status()).toBe(200);
  const progressResponse = await request.get("/api/game-progress", { headers: headers() });
  expect(progressResponse.status()).toBe(200);
  const progress = await progressResponse.json();
  expect(progress.workspaceId).toBe(workspaceId);
  expect(progress.siege.stars).toEqual([3, 2, 0, 0, 0, 0, 0, 0]);
  expect(progress.tanks).toMatchObject({ best: 1234, unlocked: 3 });

  const mineResponse = await request.get("/api/tanks/v1/characters?mine=1", { headers: headers() });
  expect(mineResponse.status()).toBe(200);
  const mine = await mineResponse.json();
  expect(mine.characters).toHaveLength(1);
  expect(mine.characters[0].origin).toBe("mcp");

  await page.goto(`/${workspace.slug}/me`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "我的", exact: true })).toBeVisible({ timeout: 45000 });
  await expect(page.getByText("MCP 收藏坦克", { exact: true })).toBeVisible();
  await expect(page.getByText("我的旋转锤", { exact: true })).toBeVisible();
  await expect(page.getByText("MCP", { exact: true })).toBeVisible();
  await expect(page.getByText("5 / 24", { exact: true })).toBeVisible();
  await expect(page.getByText("5 / 24 星", { exact: true })).toBeVisible();
  await expect(page.getByText("最高分 001234", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/me/my-space-desktop.png", fullPage: true });

  const workshopLink = page.getByRole("link", { name: "去工坊", exact: true });
  await expect(workshopLink).toHaveAttribute("href", new RegExp(`/${workspace.slug}/siege\\?blueprint=`));
  const garageLink = page.getByRole("link", { name: "去车库", exact: true });
  await expect(garageLink).toHaveAttribute("href", new RegExp(`/${workspace.slug}/tanks\\?character=`));
  await expect(page.getByRole("link", { name: "继续闯关", exact: true })).toHaveAttribute("href", `/${workspace.slug}/siege/campaign?level=3`);
  await expect(page.getByRole("link", { name: "继续守城", exact: true })).toHaveAttribute("href", `/${workspace.slug}/tanks?stage=3`);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/me/my-space-phone.png", fullPage: true });
});
