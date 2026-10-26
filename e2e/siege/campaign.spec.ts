import { test, expect } from "./fixtures";

// Browser checks own route and input wiring; combat matrices belong to engine tests.
test("plays real waves, freezes pause, restores a checkpoint and unlocks the next map without AI", async ({ page, game }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install({ time: new Date("2026-10-08T00:00:00Z") }); await page.route("**/api/siege/**", route => route.abort());
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(game.campaignHref);
  await expect(page.getByRole("button", { name: "开始进攻", exact: true })).toBeEnabled();
  await page.clock.pauseAt(new Date("2026-10-08T00:01:00Z"));
  const battle = page.getByTestId("campaign-battle"), build = page.getByRole("button", { name: /^建造 ·/ });
  for (const slot of [1, 4]) { await page.getByRole("button", { name: `阵位 ${slot}`, exact: true }).click(); await build.click(); }
  await expect(page.getByTestId("campaign-gold")).toHaveText("50");
  await page.getByRole("button", { name: "开始进攻", exact: true }).click(); await page.clock.runFor(9000);
  await page.getByRole("button", { name: "暂停布阵", exact: true }).click();
  const tick = await battle.getAttribute("data-tick"); await page.clock.runFor(2000);
  expect(await battle.getAttribute("data-tick")).toBe(tick);
  await page.screenshot({ path: "test-results/siege/campaign-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "继续战斗", exact: true }).first().click();
  await expect.poll(async () => { await page.clock.runFor(1000); return battle.getAttribute("data-completed-waves"); }, { timeout: 15_000, intervals: [0] }).toBe("1");
  await page.getByRole("button", { name: /阵位 1，/ }).click();
  const gold = await page.getByTestId("campaign-gold").innerText(), kills = await battle.getAttribute("data-kills");
  await page.reload();
  await expect.poll(async () => {
    await page.clock.runFor(100);
    const start = page.getByRole("button", { name: "开始下一波", exact: true });
    return await start.count() > 0 && await start.isEnabled();
  }).toBe(true);
  await expect(battle).toHaveAttribute("data-phase", "ready"); await expect(battle).toHaveAttribute("data-completed-waves", "1");
  await expect(page.getByTestId("campaign-gold")).toHaveText(gold); await expect(battle).toHaveAttribute("data-kills", kills!);
  await expect(page.getByRole("button", { name: /阵位 [14]，/ })).toHaveCount(2);
  await page.getByRole("button", { name: "1×", exact: true }).click();
  for (let n = 0; n < 80 && await battle.getAttribute("data-phase") !== "victory"; n++) {
    for (const slot of [1, 4]) {
      await page.getByRole("button", { name: new RegExp(`阵位 ${slot}，`) }).click();
      const upgrade = page.getByRole("button", { name: /^升级 ·/ });
      if (await upgrade.count() && await upgrade.isEnabled()) await upgrade.click();
    }
    const nextWave = page.getByRole("button", { name: "开始下一波", exact: true });
    if (await nextWave.count()) await nextWave.click();
    await page.clock.runFor(3000);
  }
  await expect(battle).toHaveAttribute("data-phase", "victory"); await expect(battle).toHaveAttribute("data-completed-waves", "5");
  await page.getByRole("button", { name: "下一关", exact: true }).click();
  await expect(page.getByRole("heading", { name: "箱子后面", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /选关/ }).click(); await page.clock.runFor(200);
  await expect(page.getByRole("button", { name: /02\s*箱子后面/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: /03\s*跑得太快/ })).toBeDisabled();
});

test("clears a blocked slot and keeps building controls usable at phone width", async ({ page, game }) => {
  await page.addInitScript(namespace => localStorage.setItem(`${namespace}:siege-campaign-progress`, JSON.stringify({ version: 1, stars: [3,0,0,0,0,0,0,0], sound: false, selectedLevel: 2 })), game.namespace);
  await page.clock.install(); await page.setViewportSize({ width: 390, height: 844 }); await page.goto(game.campaignHref);
  await expect(page.getByRole("button", { name: "开始进攻", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "阵位 7", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "阵位 6", exact: true }).click();
  await expect(page.getByRole("region", { name: "阵位操作", exact: true })).toBeVisible();
  const build = page.getByRole("button", { name: /^建造 ·/ });
  const buildRect = (await build.boundingBox())!; expect(buildRect.y + buildRect.height).toBeLessThanOrEqual(844);
  await build.click();
  await page.getByRole("button", { name: "木箱，奖励 35 金币", exact: true }).click();
  await page.getByRole("button", { name: "开始进攻", exact: true }).click(); await page.clock.runFor(12000);
  await expect(page.getByRole("button", { name: "木箱，奖励 35 金币", exact: true })).toHaveCount(0);
  const opened = page.getByRole("button", { name: "阵位 7", exact: true }); await expect(opened).toBeVisible();
  expect((await opened.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  await page.getByRole("button", { name: "暂停布阵", exact: true }).click(); await opened.click();
  await page.getByRole("button", { name: /^建造 ·/ }).click();
  await expect(page.getByRole("button", { name: /阵位 7，林地火炮 1 级/ })).toBeVisible();
  await page.getByRole("button", { name: /^出售 ·/ }).click(); await expect(opened).toBeVisible();
  await page.getByRole("button", { name: "战前改装与蓝图", exact: true }).click();
  const dialog = page.getByRole("dialog"); await expect(dialog.getByLabel("炮管长度")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole("button", { name: "完成改装", exact: true }).click(); await page.clock.runFor(200);
  await page.screenshot({ path: "test-results/siege/campaign-phone.png", fullPage: true });
});

test("imports a saved workshop cannon with its real dimensions and persists future deployments", async ({ page, api, game }) => {
  await page.clock.install(); await page.goto(game.workshopHref);
  await page.getByLabel("炮管长度数值", { exact: true }).fill("3.20"); await page.getByLabel("炮管长度数值", { exact: true }).press("Enter");
  await page.getByLabel("炮管粗细数值", { exact: true }).fill("0.45"); await page.getByLabel("炮管粗细数值", { exact: true }).press("Enter");
  await page.getByLabel("蓝图名称").fill("战役长管火炮"); await page.getByRole("button", { name: "保存蓝图", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "蓝图已保存" })).toBeVisible(); await page.clock.runFor(600);
  await page.getByRole("link", { name: /林地闯关/ }).first().click(); await expect(page.getByRole("button", { name: "开始进攻", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "战前改装与蓝图", exact: true }).click();
  const dialog = page.getByRole("dialog"); await dialog.getByRole("button", { name: "使用蓝图：战役长管火炮", exact: true }).click();
  await expect(dialog.getByLabel("炮管长度")).toHaveValue("3200"); await expect(dialog.getByLabel("炮管粗细")).toHaveValue("450");
  await dialog.getByRole("button", { name: "完成改装", exact: true }).click(); await page.clock.runFor(200);
  await expect(page.locator(".campaign-blueprint-name")).toHaveText("战役长管火炮");
  await expect(page.locator(".campaign-design-facts").first()).toContainText("8.5");
  await page.getByRole("button", { name: "阵位 1", exact: true }).click(); await page.getByRole("button", { name: /^建造 ·/ }).click();
  await expect(page.getByRole("heading", { name: "战役长管火炮", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "战前改装与蓝图", exact: true }).click(); await dialog.getByLabel("炮管长度").press("Home");
  await dialog.getByRole("button", { name: "完成改装", exact: true }).click(); await page.clock.runFor(200);
  await expect(page.getByRole("heading", { name: "战役长管火炮", exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole("button", { name: "开始进攻", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: /阵位 1，/ })).toBeVisible();
  await page.getByRole("button", { name: "阵位 2", exact: true }).click();
  await expect(page.locator(".campaign-design-facts").first()).toContainText("6.2");
});

test("recovers an asset failure and rejects an incompatible checkpoint while keeping earned stars", async ({ page, game }) => {
  await page.addInitScript(namespace => {
    localStorage.setItem(`${namespace}:siege-campaign-progress`, JSON.stringify({ version: 1, stars: [2,0,0,0,0,0,0,0], sound: false, selectedLevel: 1 }));
    localStorage.setItem(`${namespace}:siege-campaign-checkpoint`, JSON.stringify({ version: "future", levelId: 8 }));
  }, game.namespace);
  await page.route("**/woodland-battlefield*.webp", route => route.abort()); await page.goto(game.campaignHref);
  await expect(page.getByRole("button", { name: "重试加载", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /选关 2/ })).toBeVisible();
  await expect(page.getByText("旧断点无法恢复，历史星级仍保留。", { exact: true })).toBeVisible();
  await page.unroute("**/woodland-battlefield*.webp"); await page.getByRole("button", { name: "重试加载", exact: true }).click();
  await expect(page.getByRole("button", { name: "开始进攻", exact: true })).toBeEnabled();
  await expect(page.getByTestId("campaign-battle")).toHaveAttribute("data-completed-waves", "0");
});
