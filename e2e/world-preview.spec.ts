import { expect, test } from "@playwright/test";

test("the preview connects creations, stories and map locations", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/reach/**", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await page.goto("/?lang=en");
  const explorer = page.getByTestId("world-explorer");
  await explorer.scrollIntoViewIfNeeded();
  await expect(explorer).toHaveAttribute("data-world-source", "preview");
  const group = explorer.getByRole("group", { name: "Meet a creation" });
  const luna = group.getByRole("button", { name: /Luna/ });
  await expect(luna).toBeEnabled();
  await luna.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("world-character-name")).toHaveText("Luna");
  await expect(luna).toHaveAttribute("aria-pressed", "true");
  await explorer.getByRole("button", { name: /At 8% health, Arthur/ }).click();
  await expect(explorer).toHaveAttribute("data-selected-event", "9");
  await expect(page.getByTestId("world-character-name")).toHaveText("Arthur");
  await explorer.getByRole("button", { name: /second belt collapsed/ }).click();
  await expect(page.getByTestId("world-character-name")).toHaveText("Second belt");
  await explorer.getByRole("button", { name: "Whole world" }).click();
  await expect(page.getByTestId("world-map")).toHaveAttribute("data-view", "overview");
  const map = page.getByTestId("world-map");
  const canvas = map.locator("canvas");
  const bounds = await canvas.boundingBox();
  // Arthur's declared position projected into the whole-world view.
  const scale = Math.min(bounds!.width / 2048, bounds!.height / 1024) * 0.94;
  await canvas.click({ position: { x: bounds!.width / 2 + (1580 - 1024) * scale, y: bounds!.height / 2 + (490 - 512) * scale } });
  await expect(explorer).toHaveAttribute("data-selected-entity", "preview-0");
  await expect(map).toHaveAttribute("data-view", "following");
  await group.getByRole("button", { name: /Windblade/ }).click();
  await expect(page.getByTestId("world-character-name")).toHaveText("Windblade");
  await explorer.getByRole("link", { name: "Create my first character" }).click();
  await expect(page).toHaveURL(/#create$/);
  await expect(page.getByRole("heading", { name: "Create a weapon. Give a character life." })).toBeInViewport();
  expect(errors).toEqual([]);
});

test("mobile keeps the current story and offers an expandable chronicle", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/reach/**", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await page.goto("/?lang=zh-Hans");
  const explorer = page.getByTestId("world-explorer");
  await explorer.scrollIntoViewIfNeeded();
  const luna = explorer.getByRole("group", { name: "认识一份创造" }).getByRole("button", { name: /露娜/ });
  await expect(luna).toBeEnabled();
  await luna.click();
  await expect(page.getByTestId("world-character-name")).toHaveText("露娜");
  const collapse = explorer.getByRole("button", { name: /第二地带突然塌陷/ });
  await expect(collapse).not.toBeVisible();
  await explorer.getByRole("button", { name: "展开更多纪事" }).click();
  await expect(collapse).toBeVisible();
  await collapse.click();
  await expect(page.getByTestId("world-character-name")).toHaveText("第二地带");
  await expect(explorer.getByRole("link", { name: "创造我的第一个角色" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a sparse live world keeps real names, long text and current data", async ({ page }) => {
  const name = "A traveller named by its creator — ".repeat(6);
  await page.route("**/api/reach/state", (route) => route.fulfill({ json: {
    season: "public-live", beat: 830, version: 1, rulesVersion: "reach@1", digest: "test",
    rifts: [512, 1480], supplies: [], wrecks: [], chronicle: [],
    entities: [{ id: "preview-0", name, kind: "character", x: 10, y: 12, hp: 55, status: "alive", survived: 27, palette: ["#14161A", "#C8622D", "#E8E1D5"], silhouette: "tall", form: "shield" }],
  } }));
  await page.route("**/api/reach/season/current", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lang=zh-Hans");
  const explorer = page.getByTestId("world-explorer");
  await expect(explorer).toHaveAttribute("data-world-source", "live");
  await explorer.scrollIntoViewIfNeeded();
  await expect(page.getByTestId("world-character-name")).toHaveText(name.trim());
  await expect(explorer.getByText("还没有值得记录的事。")).toBeVisible();
  await expect(explorer.getByRole("button", { name: "认识另一个" })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
