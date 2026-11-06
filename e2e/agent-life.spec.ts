import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { createServer } from "node:http";
import { TestApiClient } from "./fixtures";

// The test owns the singleton in the checkout's explicitly selected database.
// It refuses an existing simulation and never replaces another world's state.
test.skip(process.env.LIFE_E2E !== "1", "Set LIFE_E2E=1 against a migrated API/Web environment with no existing Life world.");
test.setTimeout(240_000);
test.use({ actionTimeout: 15_000, viewport: { width: 1440, height: 1000 } });
let api: TestApiClient;
let outsider: TestApiClient;
let world: Awaited<ReturnType<TestApiClient["createWorkspace"]>>;
let other: Awaited<ReturnType<TestApiClient["createWorkspace"]>>;
let pool: pg.Pool;
let tickBefore: number;
const run = promisify(execFile);

async function restartAPI(bootstrap?: string, modelEnv: Record<string, string> = {}) {
  await run("make", ["down", "ARGS=--components api"], { timeout: 30_000 });
  await run("make", ["up", "C=api", ...(bootstrap ? [`AGENT_LIFE_WORKSPACE_ID=${bootstrap}`] : [])], { timeout: 60_000, env: { ...process.env, ...modelEnv } });
}
async function health() {
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || `http://localhost:${process.env.PORT || "8080"}`}/health`);
  return response.json() as Promise<{ pid: number; life: string }>;
}
async function computePID(parent: number) {
  const { stdout } = await run("ps", ["-axo", "pid=,ppid=,command="]);
  for (const line of stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (match && Number(match[2]) === parent && match[3]?.includes("runtime/life/engine.mjs")) return Number(match[1]);
  }
  return 0;
}
async function tick() { return Number((await pool.query("SELECT tick FROM life_world WHERE workspace_id=$1", [world.id])).rows[0]?.tick ?? -1); }

test.beforeAll(async () => {
  const origin = new URL(process.env.NEXT_PUBLIC_API_URL || `http://localhost:${process.env.PORT || "8080"}`);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) throw new Error("Life E2E requires a local managed environment");
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  if ((await pool.query("SELECT count(*)::int AS n FROM life_world")).rows[0].n !== 0) throw new Error("Refusing to run Life E2E over an existing simulation");
  const run = `${Date.now().toString(36)}-${process.pid}`;
  api = new TestApiClient(); await api.login(`life-${run}@auro.ai`, "Life QA");
  world = await api.createWorkspace("Life QA", `life-${run}`); await api.markUserOnboarded();
  outsider = new TestApiClient(); await outsider.login(`life-other-${run}@auro.ai`, "Other QA");
  other = await outsider.createWorkspace("Other QA", `life-other-${run}`); await outsider.markUserOnboarded();
  await restartAPI(world.id);
  // No viewer or player is connected while the integrated service advances.
  await expect.poll(tick, { timeout: 20_000 }).toBeGreaterThanOrEqual(3);
  tickBefore = await tick();
});
test.afterAll(async () => {
  if (other) await outsider.deleteWorkspace();
  if (world) await api.deleteWorkspace(); await pool?.end();
});

test("headless simulation, real snapshot viewer, workspace isolation and main-service and compute-process restart", async ({ page, request, baseURL }) => {
  let commitFrames = 0;
  page.on("websocket", (socket) => socket.on("framereceived", (frame) => {
    try { if (JSON.parse(frame.payload.toString()).type === "life:updated") commitFrames++; } catch { /* Ignore non-JSON dev-server frames. */ }
  }));
  const headers = { Authorization: `Bearer ${api.getToken()}`, "X-Workspace-ID": world.id };
  expect((await request.get("/api/life")).status()).toBe(401);
  const denied = await request.get("/api/life", { headers: { Authorization: `Bearer ${outsider.getToken()}`, "X-Workspace-ID": world.id } });
  expect(denied.status()).toBe(404);
  const empty = await request.get("/api/life", { headers: { Authorization: `Bearer ${outsider.getToken()}`, "X-Workspace-ID": other.id } });
  expect(empty.status()).toBe(200);
  expect((await empty.json()).world).toBeNull();
  const snapshot = await request.get("/api/life", { headers });
  expect(snapshot.status()).toBe(200); expect((await snapshot.json()).agents).toHaveLength(20);
  await page.context().addCookies([{ name: "auro-locale", value: "zh-Hans", url: baseURL! }]);
  await page.addInitScript((token) => localStorage.setItem("auro_token", token), api.getToken()!);
  await page.goto(`/${world.slug}/life`);
  await expect(page.getByRole("heading", { name: "居民生活", exact: true })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "世界事件", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mika", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Rowan", exact: true }).click();
  await expect(page).toHaveURL(/resident=a11fe000-0000-4000-8000-000000000002/);
  await expect(page.getByRole("heading", { name: "Rowan", exact: true })).toBeVisible();
  const visibleTick = async () => Number((await page.getByTestId("life-tick").innerText()).replace(/\D/g, ""));
  const firstVisibleTick = await visibleTick();
  await expect.poll(visibleTick, { timeout: 10_000 }).toBeGreaterThan(firstVisibleTick);
  await expect.poll(() => commitFrames).toBeGreaterThan(0);
  await page.getByRole("heading", { name: "世界事件", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("heading", { name: "世界事件", exact: true })).toBeInViewport();
  await expect.poll(tick).toBeGreaterThan(tickBefore);
  await page.getByRole("heading", { name: "居民生活", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/agent-life/world-desktop.png", fullPage: true });
  const commandHeaders = { Authorization: `Bearer ${api.getToken()}`, "X-Workspace-ID": world.id };
  await page.getByRole("button", { name: "迎接新居民", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "名字", exact: true }).fill("测试诗人");
  await dialog.getByRole("textbox", { name: "背景（选填）", exact: true }).fill("喜欢读书，也喜欢认识邻居。");
  await dialog.getByRole("button", { name: "加入小镇", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "测试诗人", exact: true })).toBeAttached();
  const created = await request.get("/api/life", { headers: commandHeaders });
  expect((await created.json()).agents).toHaveLength(21);
  await page.getByRole("button", { name: "Mika", exact: true }).click();
  await page.getByRole("button", { name: "提议一场活动", exact: true }).click();
  await dialog.getByRole("textbox", { name: "活动名字", exact: true }).fill("QA 邻里读书会");
  await dialog.getByLabel("地点", { exact: true }).selectOption("square");
  await dialog.getByRole("button", { name: "提出建议", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("QA 邻里读书会", { exact: true })).toBeVisible();
  const afterCommand = await (await request.get("/api/life", { headers: commandHeaders })).json();
  expect(afterCommand.town.activities).toEqual(expect.arrayContaining([expect.objectContaining({ title: "QA 邻里读书会", status: "scheduled" })]));
  const forbiddenCommand = await request.post("/api/life/commands", { headers: { Authorization: `Bearer ${outsider.getToken()}`, "X-Workspace-ID": world.id }, data: { requestId: crypto.randomUUID(), kind: "message", residentId: afterCommand.agents[0].id, text: "Hello" } });
  expect(forbiddenCommand.status()).toBe(404);
  await expect(page.getByRole("textbox", { name: "和 Mika 聊聊", exact: true })).toBeDisabled();
  await page.getByTestId("town-map").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/agent-life/town-desktop.png", fullPage: true });
  const returnUrl = page.url();
  await page.goto(`/${world.slug}/me`);
  const away = await request.post("/api/life/commands", { headers: commandHeaders, data: { requestId: crypto.randomUUID(), kind: "activity", residentId: "a11fe000-0000-4000-8000-000000000002", title: "QA 自然漫步", interest: "nature", place: "square", startsIn: 180, duration: 60 } });
  expect(away.ok()).toBe(true);
  await page.goto(returnUrl);
  await expect(page.getByRole("heading", { name: "你离开以后", exact: true })).toBeVisible();
  await page.getByRole("heading", { name: "居民生活", exact: true }).scrollIntoViewIfNeeded();
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  const foreground = await page.locator(".town-page").evaluate(node => getComputedStyle(node).color);
  await expect.poll(() => page.locator(".town-resident-list button[aria-pressed=false]").first().evaluate(node => getComputedStyle(node).color)).toBe(foreground);
  await page.screenshot({ path: "test-results/agent-life/town-dark.png", fullPage: true });
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  const apiPID = (await health()).pid;
  const child = await computePID(apiPID); expect(child).toBeGreaterThan(0);
  const committed = await tick(); process.kill(child, "SIGKILL");
  await expect.poll(async () => { const pid = await computePID(apiPID); return pid > 0 && pid !== child; }, { timeout: 15_000 }).toBe(true);
  await expect.poll(tick, { timeout: 15_000 }).toBeGreaterThan(committed);
  expect((await health()).pid).toBe(apiPID);
  const beforeRestart = await tick();
  await restartAPI();
  await expect.poll(tick, { timeout: 15_000 }).toBeGreaterThan(beforeRestart);
  expect((await health()).life).toBe("running");
  const recovered = await (await request.get("/api/life", { headers: commandHeaders })).json();
  expect(recovered.agents).toHaveLength(21);
  expect(recovered.town.activities.some((activity: { title: string }) => activity.title === "QA 邻里读书会")).toBe(true);
  const model = createServer(async (incoming, outgoing) => {
    let body = ""; for await (const chunk of incoming) body += chunk;
    const requestBody = JSON.parse(body);
    const userMessage = requestBody.messages.findLast((message: { role: string }) => message.role === "user");
    const context = JSON.parse(userMessage.content);
    const decision = { reply: "我记得你提议的读书会。", answer: "一起去吧。", slots: context.kind === "plan" ? [{ start: 480, end: 600, place: "library", purpose: "read", reason: "Read with neighbors" }] : [], reflection: "", evidence: [], shareActivityIds: [], accept: true };
    outgoing.writeHead(200, { "Content-Type": "application/json" });
    outgoing.end(JSON.stringify({ id: "town-fixture", object: "chat.completion", created: 1, model: "fixture-town", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(decision) } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
  });
  await new Promise<void>(resolve => model.listen(0, "127.0.0.1", resolve));
  try {
    const address = model.address(); if (!address || typeof address === "string") throw new Error("Fixture model did not bind");
    await restartAPI(undefined, { AGENT_LIFE_MODEL_MODE: "llm", AGENT_LIFE_MODEL_RESIDENTS: "3", AGENT_LIFE_MODEL_DAILY_LIMIT: "30", AURO_LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`, AURO_LLM_API_KEY: "fixture-key", AURO_LLM_DEFAULT_MODEL: "fixture-town", AURO_LLM_MAX_RETRIES: "0", AURO_LLM_DISABLE_THINKING: "false" });
    await page.reload();
    await expect(page.getByRole("textbox", { name: "和 Mika 聊聊", exact: true })).toBeEnabled({ timeout: 20000 });
    await page.getByRole("textbox", { name: "和 Mika 聊聊", exact: true }).fill("你还记得读书会吗？");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.locator(".town-conversation-list")).toContainText("你还记得读书会吗？", { timeout: 30000 });
    await expect(page.locator(".town-conversation-list")).toContainText("我记得你提议的读书会。");
    const modelSnapshot = await (await request.get("/api/life", { headers: commandHeaders })).json();
    expect(modelSnapshot.town.model.mode).toBe("llm");
    expect(modelSnapshot.town.model.calls).toBeGreaterThan(0);
    expect(modelSnapshot.town.conversations.some((c: { source: string; lines: { text: string }[] }) => c.source === "model" && c.lines.some(l => l.text === "你还记得读书会吗？"))).toBe(true);
  } finally {
    await restartAPI(undefined, { AGENT_LIFE_MODEL_MODE: "rules", AURO_LLM_API_KEY: "", AURO_LLM_BASE_URL: "" });
    await new Promise<void>((resolve, reject) => model.close(error => error ? reject(error) : resolve()));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("heading", { name: "居民生活", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/agent-life/town-mobile-top.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("heading", { name: "世界事件", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("heading", { name: "世界事件", exact: true })).toBeInViewport();
  await page.screenshot({ path: "test-results/agent-life/world-mobile.png", fullPage: true });
  const audit = (await pool.query(`SELECT count(*) AS missing FROM life_action a LEFT JOIN life_event e ON e.action_id=a.id WHERE a.world_id=(SELECT id FROM life_world WHERE workspace_id=$1) AND a.status<>'running' AND e.action_id IS NULL`, [world.id])).rows[0];
  expect(audit.missing).toBe("0");

});
