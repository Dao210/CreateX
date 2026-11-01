import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { TestApiClient } from "./fixtures";

const run = `${Date.now().toString(36)}-${process.pid}`;
let api: TestApiClient;
let neighbor: TestApiClient;
let workspace: Awaited<ReturnType<TestApiClient["createWorkspace"]>>;
let otherWorld: Awaited<ReturnType<TestApiClient["createWorkspace"]>>;
let token: string;
let pool: pg.Pool;
const draft = { profile: "tank-defense@1", name: "Inbox 赤狐", parts: { chassis: "light", armor: "light", cannon: "rapid" }, appearance: { body: "#26834a", accent: "#d6ef91", pattern: "stripe" } };

test.use({ viewport: { width: 1440, height: 980 } });
test.beforeAll(async () => {
  api = new TestApiClient();
  await api.login(`inbox-world-${run}@auro.ai`, "Inbox creator");
  workspace = await api.createWorkspace("Inbox world QA", `inbox-world-${run}`);
  await api.markUserOnboarded();
  token = api.getToken()!;
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  neighbor = new TestApiClient();
  const account = await neighbor.login(`inbox-neighbor-${run}@auro.ai`, "Inbox neighbor");
  otherWorld = await neighbor.createWorkspace("Other inbox world", `inbox-other-${run}`);
  await neighbor.markUserOnboarded();
  await pool.query("INSERT INTO member(workspace_id,user_id,role) VALUES($1,$2,'member')", [workspace.id, account.user.id]);
});
test.afterAll(async () => {
  if (workspace) { api.setWorkspaceId(workspace.id); api.setWorkspaceSlug(workspace.slug); await api.deleteWorkspace(); }
  if (otherWorld) { neighbor.setWorkspaceId(otherWorld.id); neighbor.setWorkspaceSlug(otherWorld.slug); await neighbor.deleteWorkspace(); }
  await api?.cleanup();
  await neighbor?.cleanup();
  await pool?.end();
});

test("MCP creation arrives live, an immutable whole-world digest includes another member, and archive/read stay independent", async ({ page, request, baseURL }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.context().addCookies([{ name: "auro-locale", value: "zh-Hans", url: baseURL! }]);
  await page.addInitScript(value => localStorage.setItem("auro_token", value), token);
  const headers = { Authorization: `Bearer ${token}`, "X-Workspace-ID": workspace.id, Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" };
  await page.goto(`/${workspace.slug}/inbox`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "收件箱", exact: true })).toBeVisible({ timeout: 45000 });
  const saved = await request.post("/api/tanks/mcp", { headers, data: { jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name: "tank_save_character", arguments: { requestId: randomUUID(), draft } } } });
  expect(saved.status()).toBe(200);
  const rpc = await saved.json();
  expect(rpc.result.isError).toBeFalsy();
  const character = rpc.result.structuredContent;
  const creation = page.getByRole("button").filter({ hasText: "「Inbox 赤狐」已准备好" });
  await expect(creation).toBeVisible({ timeout: 20000 });
  await creation.click();
  await expect(page.getByRole("link", { name: "查看角色", exact: true })).toHaveAttribute("href", `/${workspace.slug}/tanks?character=${character.id}`);
  await expect.poll(async () => {
    const response = await request.get("/api/inbox", { headers });
    return (await response.json()).find((item: { type: string }) => item.type === "creation_ready")?.read;
  }).toBe(true);
  await page.getByRole("button", { name: "标为未读", exact: true }).click();
  await expect(page.getByRole("button", { name: "标为已读", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "归档", exact: true }).click();
  await page.getByRole("button", { name: "已归档", exact: true }).click();
  await page.getByRole("button").filter({ hasText: "「Inbox 赤狐」已准备好" }).click();
  await page.getByRole("button", { name: "取消归档", exact: true }).click();
  await page.getByRole("button", { name: "收件箱", exact: true }).click();

  const neighborSaved = await request.post("/api/tanks/v1/characters", { headers: { Authorization: `Bearer ${neighbor.getToken()}`, "X-Workspace-ID": workspace.id }, data: { requestId: randomUUID(), draft: { ...draft, name: "邻居的侦察者" } } });
  expect(neighborSaved.status()).toBe(200);
  // Only this test world's committed facts and membership timestamps are
  // moved into a closed window; the actual background projector builds it.
  await pool.query("UPDATE member SET created_at=date_trunc('hour',now())-interval '2 hours' WHERE workspace_id=$1", [workspace.id]);
  await pool.query("UPDATE world_inbox_event SET occurred_at=date_trunc('hour',now())-interval '30 minutes' WHERE workspace_id=$1", [workspace.id]);
  await page.getByRole("button", { name: "世界摘要", exact: true }).click();
  await expect(page).toHaveURL(/category=world/);
  const digestRow = page.getByRole("button").filter({ hasText: "新增创作 2 件" });
  await expect(digestRow).toBeVisible({ timeout: 20000 });
  await digestRow.click();
  await expect(page.getByText("邻居的侦察者 · 新创作", { exact: true })).toBeVisible();
  await expect(page.getByText("Inbox 赤狐 · 新创作", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/inbox/world-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await expect(page.getByRole("button").filter({ hasText: "「Inbox 赤狐」已准备好" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "世界摘要", exact: true }).click();
  await page.getByRole("button").filter({ hasText: "新增创作 2 件" }).click();
  await expect(page.getByText("邻居的侦察者 · 新创作", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/inbox/world-phone.png", fullPage: true });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.screenshot({ path: "test-results/inbox/world-phone-dark.png", fullPage: true });
  await page.getByRole("button", { name: "收件箱", exact: true }).last().click();
  await expect(page.getByRole("button").filter({ hasText: "新增创作 2 件" })).toBeVisible();
  const other = await request.get("/api/inbox", { headers: { Authorization: `Bearer ${neighbor.getToken()}`, "X-Workspace-ID": otherWorld.id } });
  expect(await other.json()).toEqual([]);
  expect(errors).toEqual([]);
});
