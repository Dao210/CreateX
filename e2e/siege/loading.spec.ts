import { test, expect } from "./fixtures";

test("loads physics on the first weapon test rather than when opening the workshop", async ({ page, game }) => {
  const wasmScripts: string[] = [];
  const reads: Promise<void>[] = [];
  page.on("response", response => {
    if (!response.url().split("?")[0]!.endsWith(".js")) return;
    reads.push(response.text().then(source => { if (source.includes("AGFzbQE")) wasmScripts.push(response.url()); }).catch(() => {}));
  });
  await page.goto(game.workshopHref);
  await expect(page.getByRole("button", { name: "开始守城", exact: true })).toBeEnabled();
  await Promise.all(reads);
  expect(wasmScripts).toEqual([]);
  await page.getByRole("button", { name: "开始守城", exact: true }).click();
  await expect.poll(() => wasmScripts.length).toBeGreaterThan(0);
  await expect(page.getByRole("region", { name: "实时数据" })).toHaveAttribute("data-phase", "running");
});
