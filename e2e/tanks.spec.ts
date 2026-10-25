import { test, expect, type Page } from "@playwright/test";
import { TestApiClient } from "./fixtures";

type Workspace = Awaited<ReturnType<TestApiClient["createWorkspace"]>>;
const run = `${Date.now().toString(36)}-${process.pid}`;
let api: TestApiClient;
let primary: Workspace;
let secondary: Workspace;
let token: string;
let userId: string;
const created: Workspace[] = [];

test.use({ viewport: { width: 1440, height: 980 } });

test.beforeAll(async () => {
  api = new TestApiClient();
  const login = await api.login(`tanks-${run}@auro.ai`, "Tank QA");
  userId = login.user.id;
  token = api.getToken()!;
  primary = await api.createWorkspace("Tank QA Alpha", `tank-alpha-${run}`); created.push(primary);
  secondary = await api.createWorkspace("Tank QA Beta", `tank-beta-${run}`); created.push(secondary);
  await api.markUserOnboarded();
});

test.afterAll(async () => {
  if (!api) return;
  for (const workspace of created) {
    api.setWorkspaceId(workspace.id); api.setWorkspaceSlug(workspace.slug);
    await api.deleteWorkspace();
  }
  await api.cleanup();
});

test.beforeEach(async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: "auro-locale", value: "zh-Hans", url: baseURL! }]);
  await page.addInitScript(authToken => {
    localStorage.setItem("auro_token", authToken);
  }, token);
});

async function openGame(page: Page, workspace = primary) {
  await page.goto(`/${workspace.slug}/tanks`);
  await expect(page.getByRole("heading", { name: "坦克守城", exact: true })).toBeVisible({ timeout: 45000 });
  await expect(page.getByTestId("tank-battlefield")).toHaveAttribute("data-phase", "ready");
}

async function switchWorkspace(page: Page, workspace: Workspace) {
  await page.getByRole("button", { name: /Tank QA (Alpha|Beta)/ }).first().click();
  await page.getByRole("menuitem", { name: new RegExp(workspace.name) }).click();
  await expect(page).toHaveURL(new RegExp(`/${workspace.slug}/`));
  await page.getByRole("link", { name: "坦克守城", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${workspace.slug}/tanks$`));
}

test("tank defense is a direct workspace item and preserves the shell after reload", async ({ page, baseURL }) => {
  await page.goto(`/${primary.slug}/issues`);
  const entry = page.getByRole("link", { name: "坦克守城", exact: true });
  await expect(entry).toHaveAttribute("href", `/${primary.slug}/tanks`, { timeout: 45000 });
  await entry.click();
  await expect(page).toHaveURL(`${baseURL}/${primary.slug}/tanks`, { timeout: 45000 });
  await expect(page.getByRole("heading", { name: "坦克守城", exact: true })).toBeVisible();
  await expect(entry).toHaveAttribute("data-active", "");
  await expect(page.getByRole("link", { name: "涂鸦攻城", exact: true })).toBeVisible();
  await expect(page).toHaveTitle(/坦克守城/);
  await page.reload();
  await expect(page.getByTestId("tank-battlefield")).toHaveAttribute("data-phase", "ready");
  await expect(entry).toBeVisible();
});

test("real movement, brick impacts and pause stay within workspace game controls", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await openGame(page);
  const battlefield = page.getByTestId("tank-battlefield");
  await page.getByRole("button", { name: "开始守卫", exact: true }).click();
  const before = Number(await battlefield.getAttribute("data-player-y"));
  await page.keyboard.down("ArrowUp");
  await expect.poll(async () => Number(await battlefield.getAttribute("data-player-y"))).toBeLessThan(before - 10);
  await page.keyboard.up("ArrowUp");
  await page.keyboard.down("Space");
  await expect.poll(async () => Number(await battlefield.getAttribute("data-bricks")), { timeout: 7000 }).toBeGreaterThanOrEqual(2);
  await page.keyboard.up("Space");
  await page.keyboard.press("p");
  await expect(battlefield).toHaveAttribute("data-paused", "true");
  const stopped = await battlefield.getAttribute("data-player-y");
  await page.waitForTimeout(250);
  expect(await battlefield.getAttribute("data-player-y")).toBe(stopped);
  await page.keyboard.press("Escape");
  await expect(battlefield).toHaveAttribute("data-paused", "false");

  await page.getByRole("button", { name: "关闭音效", exact: true }).click();
  const shots = await battlefield.getAttribute("data-shots");
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "关闭音效", exact: true })).toBeVisible();
  expect(await battlefield.getAttribute("data-shots")).toBe(shots);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(battlefield).toHaveAttribute("data-paused", "true");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "继续战斗", exact: true }).first().click();
  await expect(battlefield).toHaveAttribute("data-paused", "false");
  const board = await battlefield.boundingBox(); expect(board!.y + board!.height).toBeLessThanOrEqual(980);
  await page.screenshot({ path: "test-results/tanks/tank-defense-workspace.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("records survive refresh and stay isolated when switching real workspaces", async ({ page }) => {
  await openGame(page);
  await page.evaluate(({ account, first, second }) => {
    const key = (workspace: string) => `auro:tanks:${encodeURIComponent(account)}:${encodeURIComponent(workspace)}`;
    localStorage.setItem(key(first), JSON.stringify({ version: 1, best: 1234, unlocked: 3, sound: false }));
    localStorage.setItem(key(second), JSON.stringify({ version: 1, best: 100, unlocked: 2, sound: true }));
  }, { account: userId, first: primary.id, second: secondary.id });
  await page.reload();
  await expect(page.getByTestId("tank-best")).toHaveText("001234");
  await expect(page.getByRole("button", { name: /钢铁围城/ })).toBeEnabled();
  await switchWorkspace(page, secondary);
  await expect(page.getByTestId("tank-best")).toHaveText("000100");
  await expect(page.getByRole("button", { name: /钢铁围城/ })).toBeDisabled();
  await expect(page.getByTestId("tank-battlefield")).toHaveAttribute("data-phase", "ready");
  await switchWorkspace(page, primary);
  await expect(page.getByTestId("tank-best")).toHaveText("001234");
});

test("arcade modes expose six maps, equipment guides and a paused blitz timer", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await openGame(page);
  await expect(page.getByRole("button", { name: /最后堡垒/ })).toBeDisabled();
  await page.getByRole("button", { name: /90 秒突击/ }).click();
  for (const name of ["红砖前线", "冰河渡口", "钢铁围城", "军需仓库", "脉冲回廊", "最后堡垒"]) {
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: /军需仓库/ }).click();
  await page.getByText("传送带", { exact: true }).click();
  await expect(page.getByText("沿箭头推动敌我坦克，可逆向操纵抵消。")).toBeVisible();
  await page.getByRole("button", { name: "开始守卫", exact: true }).click();
  const battlefield = page.getByTestId("tank-battlefield");
  await expect(battlefield).toHaveAttribute("data-mode", "blitz");
  const board = await battlefield.boundingBox();
  expect(board!.y).toBeGreaterThanOrEqual(55); expect(board!.y + board!.height).toBeLessThanOrEqual(980);
  await expect.poll(async () => Number(await battlefield.getAttribute("data-time-left"))).toBeLessThan(90);
  await page.keyboard.press("p");
  await expect(battlefield).toHaveAttribute("data-paused", "true");
  const time = await battlefield.getAttribute("data-time-left"); await page.waitForTimeout(1100);
  expect(await battlefield.getAttribute("data-time-left")).toBe(time);
  await expect(page.getByRole("button", { name: /无尽防守/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /最后堡垒/ })).toBeDisabled();
  await page.getByRole("button", { name: "继续战斗", exact: true }).first().click();
  await page.screenshot({ path: "test-results/tanks/tank-depot-blitz.png", fullPage: true });
  await page.keyboard.press("p");
  await page.getByRole("button", { name: "结束本局", exact: true }).click();
  await page.getByRole("button", { name: /无尽防守/ }).click();
  await page.getByRole("button", { name: /脉冲回廊/ }).click();
  await page.getByRole("button", { name: "开始守卫", exact: true }).click();
  await expect(battlefield).toHaveAttribute("data-mode", "survival");
  await expect(battlefield).toHaveAttribute("data-wave", "1");
  await expect(page.getByRole("timer")).toHaveCount(0);
  await page.waitForTimeout(5100);
  await page.screenshot({ path: "test-results/tanks/tank-pulse-survival.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("difficulty persists and native fullscreen keeps the current run", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await openGame(page);
  const board = page.getByTestId("tank-battlefield"), game = page.getByTestId("tank-defense-page");
  await expect(board).toHaveAttribute("data-difficulty", "casual");
  await expect(board).toHaveAttribute("data-lives", "5"); await expect(board).toHaveAttribute("data-player-hp", "2");
  await page.getByRole("button", { name: "标准", exact: true }).click();
  await expect(board).toHaveAttribute("data-lives", "3"); await expect(board).toHaveAttribute("data-base-hp", "1");
  await page.reload(); await expect(board).toHaveAttribute("data-difficulty", "standard");
  await page.getByRole("button", { name: "休闲", exact: true }).click();
  await page.getByRole("button", { name: "开始守卫", exact: true }).click();
  await page.keyboard.press("Space");
  await expect.poll(async () => Number(await board.getAttribute("data-shots"))).toBeGreaterThan(0);
  const shots = Number(await board.getAttribute("data-shots")), before = await board.boundingBox();
  await page.getByRole("button", { name: "游戏全屏", exact: true }).click();
  await expect(game).toHaveAttribute("data-fullscreen", "true");
  expect(await page.evaluate(() => document.fullscreenElement?.getAttribute("data-testid"))).toBe("tank-defense-page");
  await expect(page.locator(".tank-sidebar")).toBeHidden();
  await expect(board).toBeFocused();
  const x = Number(await board.getAttribute("data-player-x"));
  await page.keyboard.down("ArrowLeft");
  await expect.poll(async () => Number(await board.getAttribute("data-player-x"))).toBeLessThan(x - 8);
  await page.keyboard.up("ArrowLeft");
  const fullscreenBoard = await board.boundingBox(); expect(fullscreenBoard!.width).toBeGreaterThan(before!.width);
  expect(fullscreenBoard!.y).toBeGreaterThanOrEqual(0); expect(fullscreenBoard!.y + fullscreenBoard!.height).toBeLessThanOrEqual(980);
  await page.screenshot({ path: "test-results/tanks/tank-fullscreen-desktop.png", fullPage: true });
  await page.keyboard.press("Escape");
  await expect(game).toHaveAttribute("data-fullscreen", "false");
  await expect(board).toHaveAttribute("data-phase", "running"); await expect(board).toHaveAttribute("data-paused", "true");
  expect(Number(await board.getAttribute("data-shots"))).toBeGreaterThanOrEqual(shots);
  await expect(board).toHaveAttribute("data-lives", "5");
  await page.getByRole("button", { name: "继续战斗", exact: true }).first().click();
  await page.keyboard.press("f"); await expect(game).toHaveAttribute("data-fullscreen", "true");
  await page.getByRole("button", { name: "退出全屏", exact: true }).click();
  await expect(game).toHaveAttribute("data-fullscreen", "false"); await expect(board).toHaveAttribute("data-paused", "true");
  expect(errors).toEqual([]);
});

test.describe("phone controls inside the workspace", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("fits the content pane and supports short taps, held movement and scrolling", async ({ page }) => {
    await openGame(page);
    await page.getByRole("button", { name: "开始守卫", exact: true }).tap();
    const battlefield = page.getByTestId("tank-battlefield");
    await page.getByRole("button", { name: "开火", exact: true }).tap();
    await expect.poll(async () => Number(await battlefield.getAttribute("data-shots"))).toBeGreaterThanOrEqual(1);
    const before = Number(await battlefield.getAttribute("data-player-y"));
    const up = page.getByRole("button", { name: "向上移动", exact: true });
    const bounds = await up.boundingBox(); expect(bounds).not.toBeNull();
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2); await page.mouse.down();
    await expect.poll(async () => Number(await battlefield.getAttribute("data-player-y"))).toBeLessThan(before - 8);
    await page.mouse.up();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const name of ["向上移动", "向下移动", "向左移动", "向右移动", "开火"]) {
      const box = await page.getByRole("button", { name, exact: true }).boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: "test-results/tanks/tank-defense-phone.png", fullPage: true });
    const records = page.getByText("进度和纪录保存在此设备，按账号和创作区隔离。", { exact: true });
    await records.scrollIntoViewIfNeeded();
    await expect(records).toBeInViewport();
    await expect(page.getByRole("heading", { name: "坦克守城", exact: true })).toBeInViewport();
  });
  test("fullscreen keeps touch controls visible in portrait and landscape", async ({ page }) => {
    await openGame(page);
    const game = page.getByTestId("tank-defense-page"), board = page.getByTestId("tank-battlefield");
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      // Chromium's window protocol requires leaving native fullscreen before resizing.
      if (await game.getAttribute("data-fullscreen") === "true") {
        await page.getByRole("button", { name: "退出全屏", exact: true }).tap();
        await expect(game).toHaveAttribute("data-fullscreen", "false");
      }
      await page.setViewportSize(viewport);
      await page.getByRole("button", { name: "游戏全屏", exact: true }).tap();
      await expect(game).toHaveAttribute("data-fullscreen", "true");
      if (await board.getAttribute("data-phase") === "ready") await page.getByRole("button", { name: "开始守卫", exact: true }).tap();
      else await page.getByRole("button", { name: "继续战斗", exact: true }).first().tap();
      await page.getByRole("button", { name: "开火", exact: true }).tap();
      await expect.poll(async () => Number(await board.getAttribute("data-shots"))).toBeGreaterThan(0);
      for (const target of [page.getByTestId("tank-battlefield"), page.getByRole("button", { name: "向上移动", exact: true }), page.getByRole("button", { name: "开火", exact: true })]) {
        await expect(target).toBeInViewport();
        const box = await target.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width); expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
      }
      await page.screenshot({ path: `test-results/tanks/tank-fullscreen-${viewport.width}.png`, fullPage: true });
    }
    await page.getByRole("button", { name: "退出全屏", exact: true }).tap();
    await expect(page.getByTestId("tank-battlefield")).toHaveAttribute("data-paused", "true");
  });

});
