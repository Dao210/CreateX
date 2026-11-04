import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { TestApiClient } from "./fixtures";

// The test owns the singleton in the checkout's explicitly selected database.
// It refuses an existing simulation and never replaces another world's state.
test.skip(process.env.LIFE_E2E !== "1", "Set LIFE_E2E=1 against a migrated API/Web environment with no existing Life world.");
test.setTimeout(120_000);
test.use({ viewport: { width: 1440, height: 1000 } });
let api: TestApiClient;
let outsider: TestApiClient;
let world: Awaited<ReturnType<TestApiClient["createWorkspace"]>>;
let other: Awaited<ReturnType<TestApiClient["createWorkspace"]>>;
let pool: pg.Pool;
let tickBefore: number;
const run = promisify(execFile);

async function restartAPI(bootstrap?: string) {
  await run("make", ["down", "ARGS=--components api"], { timeout: 30_000 });
  await run("make", ["up", "C=api", ...(bootstrap ? [`AGENT_LIFE_WORKSPACE_ID=${bootstrap}`] : [])], { timeout: 60_000 });
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
  await expect(page.getByRole("heading", { name: "世界事件", exact: true })).toBeInViewport();
  await expect.poll(tick).toBeGreaterThan(tickBefore);
  await page.screenshot({ path: "test-results/agent-life/world-desktop.png", fullPage: true });
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
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("heading", { name: "世界事件", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("heading", { name: "世界事件", exact: true })).toBeInViewport();
  await page.screenshot({ path: "test-results/agent-life/world-mobile.png", fullPage: true });
  const audit = (await pool.query(`SELECT count(*) AS missing FROM life_action a LEFT JOIN life_event e ON e.action_id=a.id WHERE a.world_id=(SELECT id FROM life_world WHERE workspace_id=$1) AND a.status<>'running' AND e.action_id IS NULL`, [world.id])).rows[0];
  expect(audit.missing).toBe("0");

});
