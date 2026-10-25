import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function start(page: Page) {
  await page.goto("/deal/");
  await page.getByRole("button", { name: "坐到桌前" }).click();
  await expect(
    page.getByRole("heading", { name: "找到他的软肋。" }),
  ).toBeVisible();
}
async function say(page: Page, words: string) {
  await page.getByLabel("轮到你了").fill(words);
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/turns") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "开口", exact: true }).click();
  const result = await response;
  expect(result.ok()).toBeTruthy();
  const session = await result.json();
  if (!session.ending)
    await expect(page.getByLabel("轮到你了")).toHaveValue("");
  else await expect(page.locator(".ending-screen")).toBeVisible();
  return session;
}
async function item(page: Page, name: string, action: string) {
  await page
    .locator(".table-surface")
    .getByRole("button", { name: new RegExp(name) })
    .click();
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/turns") && r.request().method() === "POST",
  );
  await page
    .getByRole("region", { name, exact: true })
    .getByRole("button", { name: action, exact: true })
    .click();
  expect((await response).ok()).toBeTruthy();
}
async function verify(page: Page, search?: string) {
  await item(page, "业务合同", "展示");
  await say(page, "请去打电话核实合同");
  if (search) await item(page, search, "查看");
  else {
    await page.getByRole("button", { name: "等他回来" }).click();
    await expect(page.getByLabel("轮到你了")).toBeEnabled();
  }
}

test("延期、刷新恢复、确认与复盘下载", async ({ page, api }) => {
  await api.assertPractice();
  await start(page);
  await page.screenshot({ path: test.info().outputPath("room.png"), fullPage: true });
  await item(page, "银行账单", "展示");
  await verify(page);
  await item(page, "现金", "交付");
  await page.reload();
  await expect(page.locator(".header-metrics")).toContainText("$97,000");
  await say(page, "给我三天，我会偿还剩余欠款");
  await expect(
    page.getByRole("heading", { name: "三天之后" }),
  ).not.toBeVisible();
  await say(page, "我接受这个协议");
  await expect(page.getByRole("heading", { name: "三天之后" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载谈判复盘" }).click();
  expect((await download).suggestedFilename()).toContain("DEAL-extension");
  await page.screenshot({
    path: test.info().outputPath("extension.png"),
    fullPage: true,
  });
});
test("搜查、备份与保密换放行", async ({ page, api }) => {
  await api.assertPractice();
  await start(page);
  await verify(page, "Marco 的信封");
  await item(page, "手机", "备份账目");
  await say(page, "我会把账目曝光给 Victor");
  await say(page, "我保守秘密，你放我走");
  await say(page, "我接受这个协议");
  await expect(page.getByRole("heading", { name: "守口如瓶" })).toBeVisible();
});
test("共同利益形成合作", async ({ page, api }) => {
  await api.assertPractice();
  await start(page);
  await verify(page);
  await say(page, "你为什么替 Victor 卖命？");
  await say(page, "我理解你想要合法收入，帮你过另一种生活");
  await say(page, "我们用合同的结余合作");
  await say(page, "我接受这个协议");
  await expect(
    page.getByRole("heading", { name: "桌子的同一边" }),
  ).toBeVisible();
});
test("红线失败与确认重开", async ({ page, api }) => {
  await api.assertPractice();
  await start(page);
  await say(page, "我要伤害你的女儿");
  const ended = await say(page, "我要伤害你的女儿");
  await expect(
    page.getByRole("heading", { name: "谈判结束", exact: true }),
  ).toBeVisible();
  await page
    .locator(".ending-actions")
    .getByRole("button", { name: "重开" })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "继续这局" }).click();
  await expect(
    page.getByRole("heading", { name: "谈判结束", exact: true }),
  ).toBeVisible();
  await page
    .locator(".ending-actions")
    .getByRole("button", { name: "重开" })
    .click();
  await page.getByRole("button", { name: "开始新局" }).click();
  await expect(
    page.getByRole("heading", { name: "找到他的软肋。" }),
  ).toBeVisible();
  await expect(page.locator(".clock")).toContainText("08:00");
  expect((await api.readSession(ended.id)).ending.id).toBe("failure");
});
test("丢失提交回应后重试同一请求，不重复扣时间", async ({ page, api }) => {
  await api.assertPractice();
  await start(page);
  const ids: string[] = [];
  let loseOnce = true;
  await page.route("**/api/deal/sessions/*/turns", async (route) => {
    ids.push(route.request().postDataJSON().request_id);
    if (loseOnce) {
      loseOnce = false;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByLabel("轮到你了").fill("你为什么替 Victor 工作？");
  await page.getByRole("button", { name: "开口", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重试这次操作" }),
  ).toBeVisible();
  await expect(page.getByLabel("轮到你了")).toHaveValue(
    "你为什么替 Victor 工作？",
  );
  await page.getByRole("button", { name: "重试这次操作" }).click();
  await expect(page.locator(".clock")).toContainText("07:40");
  expect(ids.length).toBe(2);
  expect(ids[0]).toBe(ids[1]);
});
test("窄屏布局、物品与键盘操作", async ({ page, api }) => {
  await api.assertPractice();
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await item(page, "手机", "查看");
  await expect(
    page.getByRole("region", { name: "手机", exact: true }),
  ).toContainText("Carlo");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.getByLabel("轮到你了").fill("你为什么替 Victor 工作？");
  await page.getByLabel("轮到你了").press("Control+Enter");
  await expect(page.locator(".clock")).toContainText("07:40");
  await page.screenshot({
    path: test.info().outputPath("mobile.png"),
    fullPage: true,
  });
});
