import { test, expect } from "@playwright/test";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import path from "node:path";
import pg from "pg";
import { TestApiClient } from "./fixtures";

// The test owns the singleton in the checkout's explicitly selected database.
// It refuses an existing simulation and never replaces another world's state.
test.skip(process.env.LIFE_E2E !== "1", "Set LIFE_E2E=1 against a migrated API/Web environment with no existing Life world.");
test.use({ viewport: { width: 1440, height: 1000 } });
let api: TestApiClient;
let outsider: TestApiClient;
let world: Awaited<ReturnType<TestApiClient["createWorkspace"]>>;
let other: Awaited<ReturnType<TestApiClient["createWorkspace"]>>;
let worker: ChildProcess | undefined;
let pool: pg.Pool;
let tickBefore: number;
let managedWorker = false;
const run = promisify(execFile);

function startWorker() {
  worker = spawn(process.execPath, [path.resolve("apps/agent-life-worker/dist/main.mjs")], {
    env: { ...process.env, AGENT_LIFE_WORKSPACE_ID: world.id }, stdio: "ignore",
  });
}
async function stopWorker(signal: NodeJS.Signals = "SIGTERM") {
  if (!worker || worker.exitCode !== null) return;
  const exited = once(worker, "exit"); worker.kill(signal); await exited;
  worker = undefined;
}
async function tick() { return Number((await pool.query("SELECT tick FROM life_world WHERE workspace_id=$1", [world.id])).rows[0]?.tick ?? -1); }

test.beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  if ((await pool.query("SELECT count(*)::int AS n FROM life_world")).rows[0].n !== 0) throw new Error("Refusing to run Life E2E over an existing simulation");
  const run = `${Date.now().toString(36)}-${process.pid}`;
  api = new TestApiClient(); await api.login(`life-${run}@auro.ai`, "Life QA");
  world = await api.createWorkspace("Life QA", `life-${run}`); await api.markUserOnboarded();
  outsider = new TestApiClient(); await outsider.login(`life-other-${run}@auro.ai`, "Other QA");
  other = await outsider.createWorkspace("Other QA", `life-other-${run}`); await outsider.markUserOnboarded();
  startWorker();
  // No viewer or player is connected while the headless worker advances.
  await expect.poll(tick, { timeout: 20_000 }).toBeGreaterThanOrEqual(3);
  tickBefore = await tick();
});
test.afterAll(async () => {
  await stopWorker();
  if (managedWorker) await run("make", ["down", "ARGS=--components life"], { timeout: 20_000 });
  if (other) await outsider.deleteWorkspace();
  if (world) await api.deleteWorkspace();
  await outsider?.cleanup(); await api?.cleanup(); await pool?.end();
});

test("headless simulation, real snapshot viewer, workspace isolation and worker restart", async ({ page, request, baseURL }) => {
  const headers = { Authorization: `Bearer ${api.getToken()}`, "X-Workspace-ID": world.id };
  expect((await request.get("/api/life")).status()).toBe(401);
  const denied = await request.get("/api/life", { headers: { Authorization: `Bearer ${outsider.getToken()}`, "X-Workspace-ID": world.id } });
  expect(denied.status()).toBe(404);
  const empty = await request.get("/api/life", { headers: { Authorization: `Bearer ${outsider.getToken()}`, "X-Workspace-ID": other.id } });
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
  await expect(page.getByRole("heading", { name: "世界事件", exact: true })).toBeInViewport();
  await expect.poll(tick).toBeGreaterThan(tickBefore);
  await page.screenshot({ path: "test-results/agent-life/world-desktop.png", fullPage: true });
  await stopWorker("SIGKILL"); const committed = await tick();
  await page.waitForTimeout(2_300); expect(await tick()).toBe(committed);
  startWorker(); await expect.poll(tick, { timeout: 15_000 }).toBeGreaterThan(committed);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("heading", { name: "世界事件", exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("heading", { name: "世界事件", exact: true })).toBeInViewport();
  await page.screenshot({ path: "test-results/agent-life/world-mobile.png", fullPage: true });
  const audit = (await pool.query(`SELECT count(*) AS missing FROM life_action a LEFT JOIN life_event e ON e.action_id=a.id WHERE a.world_id=(SELECT id FROM life_world WHERE workspace_id=$1) AND a.status<>'running' AND e.action_id IS NULL`, [world.id])).rows[0];
  expect(audit.missing).toBe("0");
  await stopWorker(); const lastTick = await tick();
  managedWorker = true;
  await run("make", ["up", "C=life", `AGENT_LIFE_WORKSPACE_ID=${world.id}`], { timeout: 45_000 });
  await expect.poll(tick, { timeout: 10_000 }).toBeGreaterThan(lastTick);
});
