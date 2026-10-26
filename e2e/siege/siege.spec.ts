import { test, expect } from "./fixtures";

test("adjusts the cannon kit, preserves both drafts and restores saved parameters before defending", async ({ page, api, game }) => {
  await page.clock.install(); await page.goto(game.workshopHref);
  await expect(page.getByRole("button", { name: "精制炮台", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("炮管长度数值", { exact: true }).fill("3.20");
  await page.getByLabel("炮管长度数值", { exact: true }).press("Enter");
  await page.getByLabel("炮管粗细数值", { exact: true }).fill("0.45");
  await page.getByLabel("炮管粗细数值", { exact: true }).press("Enter");
  await expect(page.getByTestId("design-range")).toContainText("8.5");
  await expect(page.getByTestId("design-damage")).toContainText("19");
  await expect(page.getByRole("img", { name: /精制炮台预览/ })).toHaveAttribute("aria-label", /3.20 米，宽 0.45 米/);
  await page.getByRole("button", { name: "自由绘图", exact: true }).click();
  await page.getByRole("button", { name: "大盾", exact: true }).click();
  const freehandStrokes = await page.locator(".stroke-chip").count();
  await page.getByRole("button", { name: "精制炮台", exact: true }).click();
  await expect(page.getByLabel("炮管长度数值", { exact: true })).toHaveValue("3.20");
  await page.getByLabel("蓝图名称").fill("可调炮验收");
  await page.getByRole("button", { name: "保存蓝图", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "蓝图已保存" })).toBeVisible();
  const id = await page.evaluate(key => localStorage.getItem(`${key}:siege.session`), game.namespace);
  const saved = await api.readSiegeSession(id!);
  expect(saved.blueprints[0].cannonDesign).toEqual({ kind: "cannon-kit", version: 1, barrelLengthMm: 3200, barrelWidthMm: 450 });
  await page.clock.runFor(600); await page.reload();
  await expect(page.getByLabel("炮管长度数值", { exact: true })).toHaveValue("3.20");
  await page.getByRole("button", { name: "自由绘图", exact: true }).click();
  await expect(page.locator(".stroke-chip")).toHaveCount(freehandStrokes);
  await page.getByRole("button", { name: "可调炮验收", exact: true }).click();
  await expect(page.getByLabel("炮管粗细数值", { exact: true })).toHaveValue("0.45");
  await page.getByRole("button", { name: "三波守城试玩", exact: true }).click();
  await page.getByRole("button", { name: "开始守城", exact: true }).click();
  const battle = page.getByRole("region", { name: "实时数据" });
  await expect.poll(async () => { await page.clock.runFor(250); return battle.getAttribute("data-phase"); }).toBe("running");
  await page.clock.runFor(10_000);
  await expect(battle.getByTestId("shots")).not.toHaveText(/^0(?:\s|$)/);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const shots = await battle.getByTestId("shots").innerText();
  await page.getByLabel("炮管长度数值", { exact: true }).fill("1.60");
  await page.getByLabel("炮管长度数值", { exact: true }).press("Enter");
  await expect(battle.getByText("设计已修改，重新测试后生效。")).toBeVisible();
  await page.clock.runFor(1000); expect(await battle.getByTestId("shots").innerText()).toBe(shots);
  await page.getByRole("button", { name: "重新守城", exact: true }).click();
  await expect.poll(async () => { await page.clock.runFor(250); return battle.getAttribute("data-phase"); }).toBe("running");
  await page.clock.runFor(65_000);
  await expect(battle).toHaveAttribute("data-phase", "finished");
  await expect(battle).toHaveAttribute("data-outcome", /victory|defeat/);
  await page.getByRole("button", { name: "恢复默认", exact: true }).click();
  await expect(page.getByLabel("炮管长度数值", { exact: true })).toHaveValue("2.20");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/siege/cannon-kit-phone.png", fullPage: true });
});

test("draws original strokes, confirms a part, saves once after a lost response and restores", async ({ page, api, game }) => {
  await page.goto(game.workshopHref); await page.getByRole("button", { name: "自由绘图", exact: true }).click();
  await page.getByRole("button", { name: "新画布", exact: true }).click();
  const canvas = page.getByRole("img", { name: "武器画布" });
  const rect = (await canvas.boundingBox())!;
  const points = [[0.24,0.5],[0.6,0.43],[0.75,0.5],[0.6,0.57],[0.24,0.5]];
  await page.mouse.move(rect.x + rect.width * points[0]![0]!, rect.y + rect.height * points[0]![1]!); await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(rect.x + rect.width * point[0]!, rect.y + rect.height * point[1]!, { steps: 3 });
  await page.mouse.up();
  await page.locator(".stroke-chip").click(); await page.getByRole("button", { name: "刀刃", exact: true }).click();
  await expect(page.getByRole("button", { name: "开始测试", exact: true })).toBeEnabled();
  await page.getByLabel("蓝图名称").fill("手绘验收刀");
  let dropped = false;
  await page.route("**/api/siege/sessions/*/blueprints", async route => {
    if (!dropped) { dropped = true; await route.fetch(); await route.abort(); }
    else await route.continue();
  });
  await page.getByRole("button", { name: "保存蓝图", exact: true }).click();
  await expect(page.locator(".siege-app").getByRole("alert")).toContainText("连接中断");
  await page.getByRole("button", { name: "保存蓝图", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "蓝图已保存" })).toBeVisible();
  const id = await page.evaluate(key => localStorage.getItem(`${key}:siege.session`), game.namespace);
  const saved = await api.readSiegeSession(id!);
  expect(saved.blueprints).toHaveLength(1); expect(saved.version).toBe(2);
  expect(saved.blueprints[0].drawing.strokes).toHaveLength(1);
  await page.waitForTimeout(500); await page.reload();
  await expect(page.locator(".stroke-chip")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "开始测试", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "手绘验收刀", exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent("download"); await page.getByRole("button", { name: "下载原画", exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("siege-design.png");
});

test("recovers the same recognition receipt after a dropped response", async ({ page, api, game }) => {
  test.skip((await api.siegeStatus()).mode !== "fixture", "Requires explicit SIEGE_RECOGNITION_MODE=fixture");
  await page.goto(game.workshopHref); await page.getByRole("button", { name: "自由绘图", exact: true }).click();
  await expect(page.getByRole("button", { name: "AI 识别", exact: true })).toBeEnabled();
  let posts = 0;
  await page.route("**/api/siege/sessions/*/recognitions", async route => { posts++; await route.fetch(); await route.abort(); });
  await page.getByRole("button", { name: "AI 识别", exact: true }).click();
  await expect(page.locator(".siege-app").getByRole("alert")).toContainText("连接中断");
  await page.getByRole("button", { name: "恢复识别结果", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "部件已识别" })).toBeVisible();
  expect(posts).toBe(1); await expect(page.getByRole("button", { name: "开始测试", exact: true })).toBeEnabled();
});

test("a late recognition cannot overwrite a new drawing", async ({ page, api, game }) => {
  test.skip((await api.siegeStatus()).mode !== "fixture", "Requires explicit SIEGE_RECOGNITION_MODE=fixture");
  await page.goto(game.workshopHref); await page.getByRole("button", { name: "自由绘图", exact: true }).click();
  await expect(page.getByRole("button", { name: "AI 识别", exact: true })).toBeEnabled();
  let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/siege/sessions/*/recognitions", async route => { const response = await route.fetch(); await waiting; await route.fulfill({ response }); });
  await page.getByRole("button", { name: "AI 识别", exact: true }).click();
  await expect(page.getByRole("button", { name: "AI 识别", exact: true })).toHaveAttribute("aria-busy", "true");
  await page.getByRole("button", { name: "新画布", exact: true }).click(); release();
  await expect(page.getByRole("status").filter({ hasText: "旧识别结果没有覆盖" })).toBeVisible();
  await expect(page.locator(".stroke-chip")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "开始测试", exact: true })).toBeDisabled();
});

test("real WASM contacts, pause and three defense waves work", async ({ page, api, game }) => {
  await page.clock.install(); await page.goto(game.workshopHref); await page.getByRole("button", { name: "自由绘图", exact: true }).click();
  await expect(page.getByRole("button", { name: "开始测试", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "开始测试", exact: true }).click();
  await expect.poll(async () => { await page.clock.runFor(250); return page.locator(".battle-log").getAttribute("data-phase"); }).toBe("running");
  await page.clock.runFor(13_000); await expect(page.getByTestId("hits")).not.toHaveText(/^0(?:\s|$)/);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const before = await page.locator(".battle-log").innerText(); await page.clock.runFor(1000);
  expect(await page.locator(".battle-log").innerText()).toBe(before);
  await page.getByRole("button", { name: "继续", exact: true }).click(); await page.clock.runFor(9000);
  await expect(page.getByRole("button", { name: "暂停", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "三波守城试玩", exact: true }).click();
  await page.getByRole("button", { name: "开始守城", exact: true }).click();
  await expect.poll(async () => { await page.clock.runFor(250); return page.locator(".battle-log").getAttribute("data-phase"); }).toBe("running");
  await page.clock.runFor(65_000);
  await expect(page.getByRole("button", { name: "暂停", exact: true })).toBeDisabled();
  await expect(page.getByTestId("hits")).not.toHaveText(/^0(?:\s|$)/);
  await expect(page.locator(".battle-log")).toHaveAttribute("data-wave", "3");
  await page.screenshot({ path: "test-results/siege/workshop.png", fullPage: true });
});

test("automatic cannon displays real numbers, freezes on pause and keeps the test separate from edits", async ({ page, api, game }) => {
  await page.clock.install(); await page.goto(game.workshopHref); await page.getByRole("button", { name: "自由绘图", exact: true }).click();
  await page.getByRole("button", { name: "自动炮台", exact: true }).click();
  const design = page.getByRole("region", { name: "设计参数" }), battle = page.getByRole("region", { name: "实时数据" });
  await expect(design.getByText("射程", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始测试", exact: true })).toBeEnabled();
  const canvas = page.getByRole("img", { name: "武器画布" });
  await page.getByRole("button", { name: "设置炮口", exact: true }).click();
  const rect = (await canvas.boundingBox())!;
  await page.mouse.click(rect.x + rect.width * 2850 / 4096, rect.y + rect.height * 2048 / 4096);
  await expect(page.getByRole("button", { name: "设置朝向", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "开始测试", exact: true })).toBeDisabled();
  await page.mouse.click(rect.x + rect.width * 3400 / 4096, rect.y + rect.height * 2048 / 4096);
  await page.getByRole("button", { name: "开始测试", exact: true }).click();
  await expect.poll(async () => { await page.clock.runFor(250); return battle.getAttribute("data-phase"); }).toBe("running");
  await page.clock.runFor(10_000);
  await expect(battle.getByTestId("shots")).not.toHaveText(/^0(?:\s|$)/);
  await expect(battle.getByTestId("hits")).not.toHaveText(/^0(?:\s|$)/);
  await expect(battle.getByTestId("damage")).not.toHaveText(/^0(?:\s|$)/);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const frozen = await battle.innerText(); await page.clock.runFor(1000); expect(await battle.innerText()).toBe(frozen);
  await page.getByRole("button", { name: "大盾", exact: true }).click();
  await expect(design.getByText("防护覆盖半径", { exact: true })).toBeVisible();
  await expect(battle.getByText("设计已修改，重新测试后生效。")).toBeVisible();
  await expect(battle.getByText("命中炮弹", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重新测试", exact: true }).click();
  await expect(battle.getByText("命中炮弹", { exact: true })).toHaveCount(0);
  await expect(battle.getByText("剩余耐久", { exact: true })).toBeVisible();
});

test("the workshop fits a phone width", async ({ page, api, game }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(game.workshopHref); await page.getByRole("button", { name: "自由绘图", exact: true }).click();
  await expect(page.getByRole("img", { name: "武器画布" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/siege/phone-width.png", fullPage: true });
});

test("manual drawing and testing remain available without an AI connection", async ({ page, api, game }) => {
    await page.route("**/api/siege/status", route => route.fulfill({ json: { mode: "llm", ready: false, rulesVersion: "p0.2", parts: [] } }));
  await page.goto(game.workshopHref);
  await expect(page.getByRole("button", { name: "开始守城", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "自由绘图", exact: true }).click();
  await expect(page.getByRole("button", { name: "AI 识别", exact: true })).toBeDisabled();
  await expect(page.getByText("AI 未连接 · 可手动标注")).toBeVisible();
  await expect(page.getByRole("button", { name: "开始测试", exact: true })).toBeEnabled();
});
