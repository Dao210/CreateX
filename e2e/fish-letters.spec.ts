import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import catalog from "../packages/core/fish/catalog.json" with { type: "json" };
import { TestApiClient } from "./fixtures";

const run = `${Date.now().toString(36)}-${process.pid}`;
let api: TestApiClient, visitor: TestApiClient, pool: pg.Pool;
let world: Awaited<ReturnType<TestApiClient["createWorkspace"]>>;
let visitorWorld: typeof world;
const headers = () => ({ Authorization: `Bearer ${api.getToken()}`, "X-Workspace-ID": world.id });

test.use({ viewport: { width: 1440, height: 980 }, launchOptions: { args: ["--enable-unsafe-swiftshader"] } });
test.beforeAll(async () => {
  api = new TestApiClient();
  await api.login(`fish-letter-${run}@auro.ai`, "Fish letter owner");
  world = await api.createWorkspace("Fish letters QA", `fish-letter-${run}`);
  await api.markUserOnboarded();
  visitor = new TestApiClient();
  await visitor.login(`fish-letter-visitor-${run}@auro.ai`, "Fish observer");
  visitorWorld = await visitor.createWorkspace("Other fish letters", `fish-letter-other-${run}`);
  await visitor.markUserOnboarded();
  await api.addMemberByEmail(visitor.getEmail());
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
});
test.afterAll(async () => {
  if (world) { api.setWorkspaceId(world.id); await api.deleteWorkspace(); }
  if (visitorWorld) { visitor.setWorkspaceId(visitorWorld.id); await visitor.deleteWorkspace(); }
  if (world && pool) {
    for (const table of ["fish_exploration_state", "fish_publication", "world_inbox_event", "inbox_item"]) {
      expect((await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE workspace_id=$1`, [world.id])).rows[0].count).toBe(0);
    }
  }
  await pool?.end();
});

async function release(request: APIRequestContext, name: string) {
  const draft = structuredClone(catalog.examples[0]!);
  draft.name = name;
  draft.behavior.depth = 100;
  draft.motion.speed = 150;
  const saved = await request.post("/api/fish/v1/fish", { headers: headers(), data: { requestId: randomUUID(), draft } });
  expect(saved.ok()).toBe(true);
  const fish = await saved.json();
  const released = await request.post("/api/fish/v1/residents", { headers: headers(), data: { requestId: randomUUID(), destination: "public", fishId: fish.id, revision: fish.revision, contentHash: fish.contentHash } });
  expect(released.ok()).toBe(true);
  return (await released.json()).resident;
}

test("a closed ocean keeps exploring and delivers a private daily letter through the actual inbox", async ({ page, request, baseURL }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.context().addCookies([{ name: "auro-locale", value: "zh-Hans", url: baseURL! }]);
  await page.addInitScript(value => { if (location.protocol === "http:" || location.protocol === "https:") localStorage.setItem("auro_token", value); }, api.getToken()!);
  const resident = await release(request, "来信小蓝");
  // No game page or client simulation is mounted while these facts are recorded.
  await page.goto("about:blank");
  const letters = async () => {
    const response = await request.get("/api/inbox", { headers: headers() });
    expect(response.ok()).toBe(true);
    return (await response.json()).filter((item: { type: string }) => item.type === "fish_letter");
  };
  await expect.poll(async () => (await letters()).length, { timeout: 45_000 }).toBe(1);
  const letter = (await letters())[0];
  expect(letter.content.entries[0]).toMatchObject({ subjectId: resident.id, name: "来信小蓝", kind: "fish_letter" });
  expect(letter.content.entries[0].sightings).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "discovery", place: "deep_water" })]));
  const before = (await pool.query("SELECT state->'position' AS position FROM fish_exploration_state WHERE resident_id=$1", [resident.id])).rows[0].position;
  await expect.poll(async () => (await pool.query("SELECT state->'position' AS position FROM fish_exploration_state WHERE resident_id=$1", [resident.id])).rows[0].position, { timeout: 15_000 }).not.toEqual(before);

  await page.goto(`/${world.slug}/inbox?category=creations`);
  const row = page.getByRole("button").filter({ hasText: "「来信小蓝」寄来了海洋来信" });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await expect(page.getByText("我探索了较深的水域。", { exact: true })).toBeVisible();
  const destination = page.getByRole("link", { name: "去看这条鱼", exact: true });
  await expect(destination).toHaveAttribute("href", `/${world.slug}/fish?resident=${resident.id}`);
  await expect.poll(async () => (await letters())[0].read).toBe(true);
  await page.screenshot({ path: "test-results/fish-letters/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/fish-letters/phone.png", fullPage: true });
  await page.evaluate(() => localStorage.setItem("theme", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByText("我探索了较深的水域。", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/fish-letters/phone-dark.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.getByRole("button", { name: "归档", exact: true }).click();
  await page.getByRole("button", { name: "已归档", exact: true }).click();
  await page.getByRole("button").filter({ hasText: "「来信小蓝」寄来了海洋来信" }).click();
  await page.getByRole("button", { name: "取消归档", exact: true }).click();
  await page.goto(`/${world.slug}/inbox?category=creations&item=${letter.id}`);
  await page.getByRole("link", { name: "去看这条鱼", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${world.slug}/fish\\?resident=${resident.id}`));
  await expect(page.getByTestId("fish-scene")).toBeVisible();
  const other = await request.get("/api/inbox", { headers: { Authorization: `Bearer ${visitor.getToken()}`, "X-Workspace-ID": world.id } });
  expect(await other.json()).toEqual([]);
  const second = await release(request, "同日第二条鱼");
  await expect.poll(async () => (await pool.query("SELECT state->'known' AS known FROM fish_exploration_state WHERE resident_id=$1", [second.id])).rows[0]?.known?.["area/deep_water"], { timeout: 20_000 }).toBeTruthy();
  expect(await letters()).toHaveLength(1);
  const recalled = await request.post("/api/fish/v1/residents/recall", { headers: headers(), data: { requestId: randomUUID(), destination: "public", residentId: resident.id, expectedResidentRevision: resident.revision } });
  expect(recalled.ok()).toBe(true);
  expect((await pool.query("SELECT count(*)::int AS count FROM fish_exploration_state WHERE resident_id=$1", [resident.id])).rows[0].count).toBe(0);
  expect(errors).toEqual([]);
});
