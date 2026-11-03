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
  await pool?.end();
});

test("MCP creation arrives live, an immutable whole-world digest includes another member, and archive/read stay independent", async ({ page, request, baseURL }) => {
  test.setTimeout(120000);
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
  await expect(page).toHaveURL(/\?item=/);
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
  await expect(page.getByText("作者：Inbox neighbor", { exact: true })).toBeVisible();
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
  // Persist the theme and reload through the real provider so its native
  // control color scheme stays in sync with the dark semantic tokens.
  await page.evaluate(() => localStorage.setItem("theme", "dark"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByText("邻居的侦察者 · 新创作", { exact: true })).toBeVisible();
  expect(await page.locator("html").evaluate(element => getComputedStyle(element).colorScheme)).toBe("dark");
  const foreground = await page.getByRole("heading", { name: "世界摘要", exact: true }).evaluate(element => getComputedStyle(element).color);
  for (const name of ["世界摘要", "已归档", "归档", "标为未读"]) {
    const action = page.getByRole("button", { name, exact: true });
    expect(await action.evaluate(element => getComputedStyle(element).color), `Dark ${name} text uses the foreground token`).toBe(foreground);
  }
  await page.screenshot({ path: "test-results/inbox/world-phone-dark.png", fullPage: true });
  await page.getByRole("button", { name: "收件箱", exact: true }).last().click();
  await expect(page.getByRole("button").filter({ hasText: "新增创作 2 件" })).toBeVisible();
  const other = await request.get("/api/inbox", { headers: { Authorization: `Bearer ${neighbor.getToken()}`, "X-Workspace-ID": otherWorld.id } });
  expect(await other.json()).toEqual([]);
  await page.goto(`/${workspace.slug}/settings?tab=notifications`, { waitUntil: "domcontentloaded" });
  const digestSubscription = page.getByRole("switch", { name: "世界摘要", exact: true });
  await expect(digestSubscription).toBeChecked();
  await digestSubscription.click();
  await expect.poll(async () => (await (await request.get("/api/notification-preferences", { headers })).json()).preferences.world_digests).toBe("muted");
  const nextSave = await request.post("/api/tanks/mcp", { headers, data: { jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name: "tank_save_character", arguments: { requestId: randomUUID(), draft: { ...draft, name: "订阅验证坦克" } } } } });
  expect(nextSave.status()).toBe(200);
  const nextRpc = await nextSave.json();
  expect(nextRpc.result.isError).toBeFalsy();
  const nextCharacter = nextRpc.result.structuredContent;
  await pool.query("UPDATE world_inbox_event SET occurred_at=date_trunc('hour',now())-interval '90 minutes' WHERE workspace_id=$1 AND subject_id=$2", [workspace.id, nextCharacter.id]);
  await expect.poll(async () => (await pool.query("SELECT summarized_at IS NOT NULL AS done FROM world_inbox_event WHERE workspace_id=$1 AND subject_id=$2", [workspace.id, nextCharacter.id])).rows[0]?.done, { timeout: 20000 }).toBe(true);
  const notices = await (await request.get("/api/inbox", { headers })).json();
  expect(notices.filter((item: { type: string }) => item.type === "world_digest")).toHaveLength(1);
  expect(notices.some((item: { type: string; content?: { entries?: { subjectId: string }[] } }) => item.type === "creation_ready" && item.content?.entries?.[0]?.subjectId === nextCharacter.id)).toBe(true);
  expect(notices.every((item: Record<string, unknown>) => item.issue_id === null && item.issue_status === null && item.issue_priority === null)).toBe(true);
  const digestNotice = notices.find((item: { type: string }) => item.type === "world_digest");
  expect((await request.post(`/api/inbox/${digestNotice.id}/archive`, { headers })).status()).toBe(200);
  const plainArchive = await (await request.get("/api/inbox/archived/page", { headers })).json();
  expect(plainArchive.items).toHaveLength(1);
  for (const dimension of ["statuses=done", "priorities=high"]) {
    const filtered = await (await request.get(`/api/inbox/archived/page?${dimension}`, { headers })).json();
    expect(filtered).toMatchObject({ items: [], has_more: false, next_cursor: null });
    const facets = await (await request.get(`/api/inbox/archived/facets?${dimension}`, { headers })).json();
    expect(facets).toEqual({ statuses: {}, priorities: {}, actors: {}, unread_count: 0 });
  }
  expect(errors).toEqual([]);
});
