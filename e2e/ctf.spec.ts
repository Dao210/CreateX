import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { TestApiClient } from "./fixtures";
import {
  StateSchema,
  StrategyRecordSchema,
  MatchRecordSchema,
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
  await expect(page.locator(".ctf-unit-roster button")).toHaveCount(6);
  await expect(page.locator(".ctf-inspector")).toContainText("观察到了什么");
  await expect(page.locator("textarea, pre, code")).toHaveCount(0);
  await page.getByRole("button", { name: "单步", exact: true }).click();
  await expect(page.locator(".ctf-stage-meta")).toContainText("1 / 1920");
  await page.getByRole("button", { name: "导入策略", exact: true }).click();
  const importDialog = page.getByRole("dialog", {
    name: "导入策略",
    exact: true,
  });
  await importDialog.locator('input[type="file"]').setInputFiles({
    name: "全攻全守 Max 0.2 版-行为验证.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        engine: "local reconstruction",
        strategy_sha256: "a".repeat(64),
        results: [],
      }),
    ),
  });
  await expect(importDialog.getByRole("alert")).toContainText(
    "这是行为验证报告",
  );
  await page.screenshot({
    path: "test-results/ctf/import-report.png",
    animations: "disabled",
  });
  await expect(
    importDialog.getByRole("button", { name: "导入并保存", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".ctf-stage-meta")).toContainText("1 / 1920");
  await importDialog.locator('input[type="file"]').setInputFiles({
    name: "Scout.strategy",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(red)),
  });
  await expect(importDialog.getByText("可导入", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/ctf/import-preview.png",
    animations: "disabled",
  });
  await expect(
    importDialog.locator("textarea, pre, code, input:not([type=file])"),
  ).toHaveCount(0);
  const savedResponse = page.waitForResponse(
    (r) =>
      r.url().includes("/api/ctf/v1/strategies") &&
      r.request().method() === "POST",
  );
  await importDialog
    .getByRole("button", { name: "导入并保存", exact: true })
    .click();
  saved = StrategyRecordSchema.parse(await (await savedResponse).json());
  await expect(importDialog).not.toBeVisible();
  await expect(
    page.getByRole("region", { name: "红方当前策略", exact: true }),
  ).toContainText("Scout");
  await page.getByRole("button", { name: "批量试炼", exact: true }).click();
  await expect(page.locator(".ctf-trial-results tbody tr")).toHaveCount(1, {
    timeout: 15000,
  });
  await page.getByRole("button", { name: "复盘对局", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "返回试炼", exact: true }),
  ).toBeVisible();
  const localSlider = page.getByRole("slider", { name: "回放", exact: true });
  await localSlider.focus();
  await localSlider.press("End");
  await expect(page.locator(".ctf-event-timeline")).toContainText("战斗时间线");
  await page.getByRole("button", { name: "返回试炼", exact: true }).click();
  const hidden = await opponent.ctfRequest(`strategies/${saved.id}?revision=1`);
  expect(hidden.status).toBe(404);
  await page.getByRole("button", { name: "报名", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("完整策略文件");
  await page.getByRole("button", { name: "公开并报名", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const ownCard = page
    .locator(".ctf-cards article")
    .filter({ has: page.getByRole("button", { name: "报名", exact: true }) })
    .filter({ hasText: "Scout" });
  await expect(ownCard).toContainText("策略已公开");
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
  await ownCard
    .getByRole("button", { name: "上传新版本", exact: true })
    .click();
  const versionDialog = page.getByRole("dialog", {
    name: "上传新版本",
    exact: true,
  });
  await expect(versionDialog).toContainText("当前报名仍使用已报名的版本");
  await versionDialog.locator('input[type="file"]').setInputFiles({
    name: "Private revision.strategy",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(blue)),
  });
  const versionResponse = page.waitForResponse(
    (r) =>
      r.url().includes("/api/ctf/v1/strategies") &&
      r.request().method() === "POST",
  );
  await versionDialog
    .getByRole("button", { name: "导入并保存", exact: true })
    .click();
  const edited = StrategyRecordSchema.parse(
    await (await versionResponse).json(),
  );
  expect(edited.id).toBe(saved.id);
  expect(edited.revision).toBe(2);
  await expect(versionDialog).not.toBeVisible();
  const afterUpload = StateSchema.parse(
    await (await owner.ctfRequest("state")).json(),
  );
  expect(
    afterUpload.entries.find((e) => e.ownerId === saved.ownerId)?.revision,
  ).toBe(1);
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
  expect(
    (await owner.ctfRequest("batches", { requestId: randomUUID() })).status,
  ).toBe(409);
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
  const rawOfficial = await (
    await owner.ctfRequest(`matches/${state.matches[0]!.id}`)
  ).json();
  expect(rawOfficial.frames[0]).toHaveProperty("events");
  const official = MatchRecordSchema.parse(rawOfficial);
  // Entry order can swap the fixtures; the reverse pairing has no actual attacks.
  const hasAttacks = official.frames.some((frame) =>
    frame.events.some((event) => event.kind === "attack"),
  );
  expect(hasAttacks).toBe(official.red.name === "Scout");
  await expect(page.getByRole("img", { name: /夺旗战场/ })).toBeVisible();
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
    await page.getByRole("link", { name: "查看策略", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "红方当前策略", exact: true }),
    ).toContainText("Private revision");
    await expect(page.locator("textarea, pre, code")).toHaveCount(0);
    const strategyDownloadEvent = page.waitForEvent("download");
    await page
      .getByRole("region", { name: "红方当前策略", exact: true })
      .getByRole("button", { name: "下载策略文件", exact: true })
      .click();
    const exported = await strategyDownloadEvent;
    expect(exported.suggestedFilename()).toBe("Private revision.strategy");
    const exportedPath = await exported.path();
    expect(exportedPath).not.toBeNull();
    const exportedBytes = readFileSync(exportedPath!);
    expect(JSON.parse(exportedBytes.toString("utf8"))).toEqual(blue);
    await page.getByRole("button", { name: "导入策略", exact: true }).click();
    const roundTrip = page.getByRole("dialog", {
      name: "导入策略",
      exact: true,
    });
    await roundTrip
      .locator('input[type="file"]')
      .setInputFiles({
        name: exported.suggestedFilename(),
        mimeType: "application/json",
        buffer: exportedBytes,
      });
    await expect(roundTrip.getByText("可导入", { exact: true })).toBeVisible();
    await roundTrip.getByRole("button", { name: "取消", exact: true }).click();
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "AI 规则包", exact: true }).click();
    const rules = await downloadEvent;
    expect(rules.suggestedFilename()).toBe("ctf-rules.zip");
    expect(await rules.failure()).toBeNull();
    await page.getByLabel("速度", { exact: true }).selectOption("30");
    await page.getByRole("button", { name: "开始", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "暂停", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const text = await page
          .locator(".ctf-stage-meta > span")
          .nth(1)
          .textContent();
        return Number.parseInt(text ?? "0");
      })
      .toBeGreaterThanOrEqual(120);
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    await page.locator(".ctf-unit-roster button").last().click();
    await expect(page.locator(".ctf-inspector h2")).toHaveText("弓箭手");
    const beforeFullscreen = await page
      .locator(".ctf-stage-meta")
      .textContent();
    const canvasHandle = await page.locator(".ctf-canvas").elementHandle();
    await page.getByRole("button", { name: "全屏", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => !!document.fullscreenElement))
      .toBe(true);
    await page.getByRole("button", { name: "全屏", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => !!document.fullscreenElement))
      .toBe(false);
    expect(await page.locator(".ctf-stage-meta").textContent()).toBe(
      beforeFullscreen,
    );
    expect(
      await page.evaluate(
        (el) => el === document.querySelector(".ctf-canvas"),
        canvasHandle,
      ),
    ).toBe(true);
    await page.locator(".ctf-scroll").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({
      path: "test-results/ctf/trial.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1366, height: 900 });
    await expect(page.locator(".ctf-unit-roster")).toBeInViewport({ ratio: 1 });
    await expect(page.locator(".ctf-inspector")).toBeInViewport();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.screenshot({
      path: "test-results/ctf/compact-dark.png",
      animations: "disabled",
    });
    await page.evaluate(() =>
      document.documentElement.classList.remove("dark"),
    );
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
