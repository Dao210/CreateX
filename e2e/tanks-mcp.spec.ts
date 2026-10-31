import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { TestApiClient } from "./fixtures";

let api: TestApiClient;
let workspace: Awaited<ReturnType<TestApiClient["createWorkspace"]>>;
let token: string;
let userId: string;
let authUser: Awaited<ReturnType<TestApiClient["login"]>>["user"];
const run = `${Date.now().toString(36)}-${process.pid}`;
const draft = { profile: "tank-defense@1", name: "MCP 森林侦察者", parts: { chassis: "light", armor: "light", cannon: "rapid" }, appearance: { body: "#26b36a", accent: "#e5f79b", pattern: "stripe" } };

test.use({ viewport: { width: 1440, height: 980 } });
test.beforeAll(async () => {
  api = new TestApiClient();
  const loggedIn = await api.login(`tank-mcp-${run}@auro.ai`, "Tank MCP QA"); token = api.getToken()!; userId = loggedIn.user.id; authUser = loggedIn.user;
  workspace = await api.createWorkspace("Tank MCP QA", `tank-mcp-${run}`);
  await api.markUserOnboarded();
});
test.afterAll(async () => {
  if (workspace) { api.setWorkspaceId(workspace.id); api.setWorkspaceSlug(workspace.slug); await api.deleteWorkspace(); }
  await api?.cleanup();
});
test.beforeEach(async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: "auro-locale", value: "zh-Hans", url: baseURL! }]);
  await page.addInitScript(value => { localStorage.setItem("auro_token", value); }, token);
});

function headers() { return { Authorization: `Bearer ${token}`, "X-Workspace-ID": workspace.id, Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" }; }
async function rpc(request: APIRequestContext, method: string, params: object = {}) {
  const response = await request.post("/api/tanks/mcp", { headers: headers(), data: { jsonrpc: "2.0", id: randomUUID(), method, params } });
  expect(response.status()).toBe(200);
  const body = await response.json(); expect(body.error).toBeUndefined(); return body.result;
}
async function tool(request: APIRequestContext, name: string, args: object = {}) {
  const result = await rpc(request, "tools/call", { name, arguments: args });
  expect(result.isError, JSON.stringify(result.content)).toBe(false); return result.structuredContent;
}

test("authenticated MCP handshake, schemas and tenant boundary", async ({ request }) => {
  const initialized = await rpc(request, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "tank-e2e", version: "1" } });
  expect(initialized.serverInfo.name).toBe("auro-tanks");
  const notice = await request.post("/api/tanks/mcp", { headers: headers(), data: { jsonrpc: "2.0", method: "notifications/initialized" } }); expect(notice.status()).toBe(202);
  const list = await rpc(request, "tools/list"); expect(list.tools).toHaveLength(8);
  const catalog = await tool(request, "tank_get_catalog"); expect(catalog.profile).toBe("tank-defense@1"); expect(catalog.maps).toHaveLength(6); expect(catalog.modes).toContain("survival");
  const anonymous = await request.post("/api/tanks/mcp", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" } }); expect(anonymous.status()).toBe(401);
  const outsider = await request.post("/api/tanks/mcp", { headers: { ...headers(), "X-Workspace-ID": randomUUID() }, data: { jsonrpc: "2.0", id: 2, method: "tools/list" } }); expect([403, 404]).toContain(outsider.status());
  const origin = await request.post("/api/tanks/mcp", { headers: { ...headers(), Origin: "https://evil.invalid" }, data: { jsonrpc: "2.0", id: 3, method: "tools/list" } }); expect(origin.status()).toBe(403);
  const invalid = await tool(request, "tank_validate_character", { draft: { ...draft, parts: { chassis: "light", armor: "heavy", cannon: "rapid" } } }); expect(invalid.valid).toBe(false); expect(invalid.errors[0].code).toBe("character_budget_exceeded");
});

for (const method of ["an existing session", "a Google callback"] as const) {
test(`connector authorization redirects the browser after ${method} without leaking credentials or starting a battle`, async ({ page, baseURL, request }) => {
  const connector = await import(pathToFileURL(resolve("apps/web/public/.well-known/tanks-mcp/connect.mjs")).href);
  const root = await mkdtemp(resolve(tmpdir(), "tank-connection-return-"));
  let showLogin!: (url: string) => void;
  const loginUrl = new Promise<string>(ready => { showLogin = ready; });
  const before = await tool(request, "tank_list_characters");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const navigationHeaders: Promise<Record<string, string>>[] = [];
  page.on("request", req => {
    const url = new URL(req.url());
    if (req.isNavigationRequest() && url.pathname === `/${workspace.slug}/tanks` && url.searchParams.get("from") === "tank-connect") navigationHeaders.push(req.allHeaders());
  });
  const authorization = connector.login({ appUrl: baseURL!, serverUrl: baseURL!, workspaceId: workspace.id, userId }, root, { browser: showLogin, timeout: 25000 });
  void authorization.catch(() => {});
  try {
    const signIn = new URL(await loginUrl);
    if (method === "a Google callback") {
      // Exercise the real OAuth callback page with a fixture exchange, never a Google account.
      await page.route("**/auth/google", route => route.fulfill({
        status: route.request().method() === "OPTIONS" ? 204 : 200,
        contentType: "application/json", body: JSON.stringify({ token, user: authUser }),
        headers: { "access-control-allow-origin": new URL(baseURL!).origin, "access-control-allow-credentials": "true", "access-control-allow-headers": route.request().headers()["access-control-request-headers"] ?? "content-type", "access-control-allow-methods": "POST, OPTIONS" },
      }));
      const callback = new URL("/auth/callback", baseURL!);
      callback.searchParams.set("code", "fixture-google-code");
      callback.searchParams.set("state", `cli_callback:${encodeURIComponent(signIn.searchParams.get("cli_callback")!)},cli_state:${encodeURIComponent(signIn.searchParams.get("cli_state")!)}`);
      await page.goto(callback.href);
    } else {
      await page.goto(signIn.href);
      await page.getByRole("button", { name: "授权", exact: true }).click();
    }
    const completed = await authorization;
    const destination = `${baseURL}/${workspace.slug}/tanks?from=tank-connect`;
    expect(completed.gameUrl).toBe(destination);
    await expect(page).toHaveURL(destination);
    await expect(page.getByTestId("tank-battlefield")).toHaveAttribute("data-phase", "ready", { timeout: 45000 });
    await expect(page.getByRole("status", { name: "连接 Agent", exact: true })).toContainText("Agent 完成连接后");
    expect(new URL(page.url()).searchParams.has("token")).toBe(false);
    expect(new URL(page.url()).searchParams.has("state")).toBe(false);
    expect(navigationHeaders.length).toBeGreaterThan(0);
    for (const headers of await Promise.all(navigationHeaders)) {
      expect(headers.authorization).toBeUndefined();
      expect(headers.referer).toBeUndefined();
    }
    const after = await tool(request, "tank_list_characters");
    expect(after.characters.map((item: { id: string }) => item.id)).toEqual(before.characters.map((item: { id: string }) => item.id));
    expect(errors).toEqual([]);
    await page.screenshot({ path: "test-results/tanks/connection-return.png", fullPage: true });
  } finally {
    await authorization.catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
}

test("MCP creates a real playable tank and later edits cannot alter its frozen session", async ({ request, page, baseURL }) => {
  const validation = await tool(request, "tank_validate_character", { draft }); expect(validation.valid).toBe(true); expect(validation.blueprint.speed).toBe(106);
  const save = { requestId: randomUUID(), draft };
  const character = await tool(request, "tank_save_character", save);
  const retry = await tool(request, "tank_save_character", save); expect(retry.id).toBe(character.id);
  const reused = await rpc(request, "tools/call", { name: "tank_save_character", arguments: { ...save, draft: { ...draft, name: "different intent" } } });
  expect(reused.isError).toBe(true); expect(reused.structuredContent).toBeUndefined(); expect(JSON.parse(reused.content[0].text).error.code).toBe("idempotency_key_reused");
  const ref = { characterId: character.id, revision: character.revision, contentHash: character.contentHash, mapId: "frontline", mode: "campaign" };
  const compatibility = await tool(request, "tank_check_compatibility", ref); expect(compatibility.compatible).toBe(true);
  const input = { ...ref, requestId: randomUUID() };
  const session = await tool(request, "tank_create_session", input);
  const sessionRetry = await tool(request, "tank_create_session", input); expect(sessionRetry.id).toBe(session.id);
  expect(new URL(session.playUrl).origin).toBe(new URL(baseURL!).origin);
  expect(session.playUrl).not.toContain(token);
  await page.goto(session.playUrl);
  await expect(page.getByTestId("tank-frozen-character")).toHaveText("本局：MCP 森林侦察者 · v1", { timeout: 45000 });
  const board = page.getByTestId("tank-battlefield");
  await expect(board).toHaveAttribute("data-character-id", `${character.id}@1`);
  await expect(board).toHaveAttribute("data-player-speed", "106");
  await page.getByRole("button", { name: "开始守卫", exact: true }).click();
  const before = Number(await board.getAttribute("data-player-y"));
  await page.keyboard.down("ArrowUp"); await expect.poll(async () => Number(await board.getAttribute("data-player-y"))).toBeLessThan(before - 8); await page.keyboard.up("ArrowUp");
  await page.keyboard.press("j"); await expect.poll(async () => Number(await board.getAttribute("data-shots"))).toBeGreaterThan(0);
  await expect.poll(() => board.evaluate(canvas => { const ctx = (canvas as HTMLCanvasElement).getContext("2d")!; const data = ctx.getImageData(0, 0, 1040, 1040).data; let pixels = 0; for (let i = 0; i < data.length; i += 4) if (data[i] === 38 && data[i + 1] === 179 && data[i + 2] === 106) pixels++; return pixels; })).toBeGreaterThan(20);
  const second = await tool(request, "tank_save_character", { requestId: randomUUID(), characterId: character.id, expectedRevision: 1, draft: { ...draft, parts: { ...draft.parts, chassis: "heavy" }, appearance: { ...draft.appearance, body: "#4664cc" } } }); expect(second.revision).toBe(2);
  await expect(board).toHaveAttribute("data-player-speed", "106");
  const frozen = await tool(request, "tank_get_session", { sessionId: session.id }); expect(frozen.character.revision).toBe(1);
  await page.reload();
  await expect(page.getByTestId("tank-frozen-character")).toHaveText("本局：MCP 森林侦察者 · v1", { timeout: 45000 });
  await expect(board).toHaveAttribute("data-character-id", `${character.id}@1`); await expect(board).toHaveAttribute("data-player-speed", "106");
  await page.getByRole("button", { name: "开始守卫", exact: true }).click();
  await page.screenshot({ path: "test-results/tanks/tank-mcp-character.png", fullPage: true });
  await page.getByRole("button", { name: "连接 Agent", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "手动配置", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("[mcp_servers.auro_tanks]");
  await expect(page.getByRole("dialog")).toContainText(workspace.id);
  expect(await page.getByRole("dialog").innerText()).not.toContain(token);
});

test("phone character editor saves a version and deploys through the same API", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${workspace.slug}/tanks`);
  await page.getByRole("button", { name: "创造坦克", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("坦克名称", { exact: true }).fill("手机守卫");
  await dialog.getByRole("combobox", { name: "底盘", exact: true }).selectOption("heavy");
  await dialog.getByRole("button", { name: "保存角色", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "开始新对局", exact: true }).click();
  await expect(page.getByTestId("tank-frozen-character")).toHaveText("本局：手机守卫 · v1");
  await expect(page.getByTestId("tank-battlefield")).toHaveAttribute("data-player-speed", "66");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/tanks/tank-mcp-phone.png", fullPage: true });
});

test("a preselected tank starts from the battlefield button with its saved identity and paint", async ({ request, page }) => {
  const character = await tool(request, "tank_save_character", { requestId: randomUUID(), draft: { ...draft, name: "黑曜出战回归", parts: { chassis: "heavy", armor: "heavy", cannon: "heavy" }, appearance: { body: "#000000", accent: "#000000", pattern: "solid" } } });
  await page.goto(`/${workspace.slug}/tanks?character=${character.id}`);
  await expect(page.getByRole("combobox", { name: "出战角色", exact: true })).toHaveValue(character.id, { timeout: 45000 });
  await expect(page.getByRole("img", { name: "黑曜出战回归", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "开始守卫", exact: true }).click();
  const board = page.getByTestId("tank-battlefield");
  await expect(page).toHaveURL(/\?session=/);
  await expect(board).toHaveAttribute("data-character-id", `${character.id}@1`);
  await expect(board).toHaveAttribute("data-phase", "running");
  await expect(board).toHaveAttribute("data-player-speed", "50");
  await expect.poll(() => board.evaluate(canvas => {
    const data = (canvas as HTMLCanvasElement).getContext("2d")!.getImageData(0, 0, 1040, 1040).data;
    let black = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 255) black++;
    return black;
  })).toBeGreaterThan(100);
  await board.screenshot({ path: "test-results/tanks/black-tank-battlefield.png" });
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await page.screenshot({ path: "test-results/tanks/selected-black-tank.png", fullPage: true });
});

test("my creations offers a battle-rendered preview and a direct playable entry", async ({ request, page }) => {
  const character = await tool(request, "tank_save_character", { requestId: randomUUID(), draft: { ...draft, name: "收藏出战回归", parts: { chassis: "heavy", armor: "heavy", cannon: "heavy" }, appearance: { body: "#000000", accent: "#000000", pattern: "solid" } } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${workspace.slug}/me?filter=mcp`);
  const card = page.getByRole("group", { name: "收藏出战回归", exact: true });
  const preview = card.getByRole("img", { name: "收藏出战回归", exact: true });
  await expect(preview).toHaveAttribute("data-character-id", `${character.id}@1`, { timeout: 45000 });
  await expect.poll(() => preview.evaluate(canvas => {
    const data = (canvas as HTMLCanvasElement).getContext("2d")!.getImageData(0, 0, 160, 160).data;
    let painted = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 255) painted++;
    return painted;
  })).toBeGreaterThan(100);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/tanks/creation-play-entry.png", fullPage: true });
  await card.getByRole("button", { name: "进入游戏", exact: true }).click();
  const board = page.getByTestId("tank-battlefield");
  await expect(page).toHaveURL(/\?session=/);
  await expect(board).toHaveAttribute("data-character-id", `${character.id}@1`);
  await expect(board).toHaveAttribute("data-phase", "ready");
  await page.getByRole("button", { name: "开始守卫", exact: true }).click();
  await expect(board).toHaveAttribute("data-phase", "running");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("the built CLI exposes the same writable MCP tools over stdio", async ({ baseURL }) => {
  const messages = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "stdio-agent-test", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "tank_save_character", arguments: { requestId: randomUUID(), draft: { ...draft, name: "STDIO 守卫" } } } },
  ];
  const stdout = execFileSync(resolve("server/bin/auro"), ["--server-url", baseURL!, "--workspace-id", workspace.id, "tanks", "mcp"], {
    input: messages.map(message => JSON.stringify(message)).join("\n") + "\n",
    encoding: "utf8", timeout: 20000,
    env: { PATH: process.env.PATH, AURO_TOKEN: token },
  });
  const results = stdout.trim().split("\n").map(line => JSON.parse(line));
  expect(results.map(result => result.id)).toEqual([1, 2, 3]);
  expect(results[1].result.tools).toHaveLength(8);
  expect(results[2].result.isError).toBe(false);
  expect(results[2].result.structuredContent.draft.name).toBe("STDIO 守卫");
  expect(stdout).not.toContain(token);
});
