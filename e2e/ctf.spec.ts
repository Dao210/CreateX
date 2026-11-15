import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { TestApiClient } from "./fixtures";
import {
  StateSchema,
  StrategyRecordSchema,
} from "../packages/core/capture-the-flag/schema";
import { readFileSync } from "node:fs";
const red = JSON.parse(
  readFileSync(
    new URL("../packages/core/capture-the-flag/ZS01.json", import.meta.url),
    "utf8",
  ),
);
const blue = JSON.parse(
  readFileSync(
    new URL("../packages/core/capture-the-flag/ZS02.json", import.meta.url),
    "utf8",
  ),
);
const run = `${Date.now().toString(36)}-${process.pid}`;
let owner: TestApiClient,
  opponent: TestApiClient,
  world: Awaited<ReturnType<TestApiClient["createWorkspace"]>>;
let saved: ReturnType<typeof StrategyRecordSchema.parse>;
const worlds: (typeof world)[] = [];
test.use({ viewport: { width: 1440, height: 1000 } });
test.beforeAll(async () => {
  owner = new TestApiClient();
  opponent = new TestApiClient();
  await owner.login(`ctf-owner-${run}@auro.ai`, "Flag author");
  await opponent.login(`ctf-other-${run}@auro.ai`, "Flag rival");
  world = await owner.createWorkspace("Flag QA", `ctf-${run}`);
  worlds.push(world);
  await owner.addMemberByEmail(opponent.getEmail()!);
  opponent.setWorkspaceId(world.id);
  opponent.setWorkspaceSlug(world.slug);
  await owner.markUserOnboarded();
  await opponent.markUserOnboarded();
});
test.afterAll(async () => {
  for (const w of worlds) {
    owner.setWorkspaceId(w.id);
    owner.setWorkspaceSlug(w.slug);
    await owner.deleteWorkspace();
  }
});
test.beforeEach(async ({ page, baseURL }) => {
  await page
    .context()
    .addCookies([{ name: "auro-locale", value: "zh-Hans", url: baseURL! }]);
  await page.addInitScript(
    (token) => localStorage.setItem("auro_token", token),
    owner.getToken()!,
  );
});
test("strategy import, explicit publication, official score and replay", async ({
  page,
}) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/${world.slug}/ctf`);
  await expect(
    page.getByRole("heading", { name: "夺旗", exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await expect(
    page.getByRole("link", { name: "夺旗", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle(/夺旗/);
  await page.getByRole("button", { name: "单步", exact: true }).click();
  await expect(page.locator(".ctf-stage-meta")).toContainText("1 / 1920");
  await page.locator('input[type="file"]').setInputFiles({
    name: "Scout.strategy",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(red)),
  });
  await expect(page.getByRole("textbox", { name: "策略名称" })).toHaveValue(
    "Scout",
  );
  await page.getByRole("button", { name: "批量试炼", exact: true }).click();
  await expect(page.locator(".ctf-trial-results tbody tr")).toHaveCount(1, {
    timeout: 15000,
  });
  const savedResponse = page.waitForResponse(
    (r) =>
      r.url().includes("/api/ctf/v1/strategies") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "保存版本", exact: true }).click();
  saved = StrategyRecordSchema.parse(await (await savedResponse).json());
  const hidden = await opponent.ctfRequest(`strategies/${saved.id}?revision=1`);
  expect(hidden.status).toBe(404);
  await page.getByRole("button", { name: "报名", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("完整源码");
  await page.getByRole("button", { name: "公开并报名", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const ownCard=page.locator(".ctf-cards article").filter({has:page.getByRole("button",{name:"报名",exact:true})}).filter({hasText:"Scout"});
  await expect(ownCard).toContainText("已公开源码");
  const publicVersion = StrategyRecordSchema.parse(
    await (
      await opponent.ctfRequest(`strategies/${saved.id}?revision=1`)
    ).json(),
  );
  expect(publicVersion.hash).toBe(saved.hash);
  const second = StrategyRecordSchema.parse(
    await (
      await opponent.ctfRequest("strategies", {
        requestId: randomUUID(),
        expectedRevision: 0,
        name: "Rival",
        strategy: blue,
      })
    ).json(),
  );
  expect(
    (
      await opponent.ctfRequest("entries", {
        requestId: randomUUID(),
        id: second.id,
        revision: 1,
        hash: second.hash,
        publish: true,
      })
    ).ok,
  ).toBeTruthy();
  expect(
    (await opponent.ctfRequest("batches", { requestId: randomUUID() })).status,
  ).toBe(403);
  const edited = await owner.ctfRequest("strategies", {
    requestId: randomUUID(),
    id: saved.id,
    expectedRevision: 1,
    name: "Private revision",
    strategy: blue,
  });
  expect(edited.ok).toBeTruthy();
  expect(
    (await opponent.ctfRequest(`strategies/${saved.id}?revision=2`)).status,
  ).toBe(404);
  await page.getByRole("link", { name: "竞技场", exact: true }).click();
  await expect(page.getByRole("button", { name: "发起正式比赛" })).toBeEnabled({
    timeout: 15000,
  });
  await page.getByRole("button", { name: "发起正式比赛" }).click();
  await expect
    .poll(
      async () =>
        StateSchema.parse(await (await owner.ctfRequest("state")).json())
          .batches[0]?.status,
      { timeout: 30000 },
    )
    .toBe("completed");
  const state = StateSchema.parse(
    await (await owner.ctfRequest("state")).json(),
  );
  expect(state.leaderboard).toHaveLength(2);
  expect((await owner.ctfRequest("batches",{requestId:randomUUID()})).status).toBe(409);
  expect(state.matches[0]?.red.revision).toBe(1);
  expect(state.leaderboard.every((r) => r.games === 1)).toBeTruthy();
  await expect(
    page
      .locator(".ctf-section")
      .filter({ has: page.getByRole("heading", { name: "世界排行榜" }) })
      .locator("tbody tr"),
  ).toHaveCount(2, { timeout: 15000 });
  await page
    .getByRole("link", { name: "查看比赛", exact: true })
    .first()
    .click();
  await expect(page.getByRole("img", { name: "回放" })).toBeVisible();
  await page.getByRole("button", { name: "回放", exact: true }).click();
  await page.screenshot({
    path: "test-results/ctf/replay.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);

  await test.step("My Creations and world isolation", async () => {
    await page.goto(`/${world.slug}/me?filter=ctf`);
    await expect(
      page.getByText("Private revision", { exact: true }),
    ).toBeVisible({ timeout: 60000 });
    await page.getByRole("link", { name: "策略 JSON", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "策略名称" })).toHaveValue(
      "Private revision",
    );
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "AI 规则包", exact: true }).click();
    const rules = await downloadEvent;
    expect(rules.suggestedFilename()).toBe("ctf-rules.zip");
    expect(await rules.failure()).toBeNull();
    await page.getByRole("button", { name: "开始", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "暂停", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    await page.screenshot({
      path: "test-results/ctf/trial.png",
      fullPage: true,
    });
    const other = await owner.createWorkspace(
      "Other Flag QA",
      `ctf-other-${run}`,
    );
    worlds.push(other);
    expect(
      (await owner.ctfRequest(`strategies/${saved.id}?revision=1`)).status,
    ).toBe(404);
    const state = StateSchema.parse(
      await (await owner.ctfRequest("state")).json(),
    );
    expect(state.mine).toEqual([]);
    expect(state.library).toEqual([]);
    owner.setWorkspaceId(world.id);
    owner.setWorkspaceSlug(world.slug);
  });
  expect(errors).toEqual([]);
});
