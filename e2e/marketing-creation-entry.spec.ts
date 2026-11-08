import { expect, test } from "@playwright/test";
import { TestApiClient } from "./fixtures";
import { newTown, seedResidents, seedResources } from "../packages/core/agent-life/index";

let api: TestApiClient;
let world: Awaited<ReturnType<TestApiClient["createWorkspace"]>>;
let token = "";
test.beforeAll(async () => {
  const run = `${Date.now().toString(36)}-${process.pid}`;
  api = new TestApiClient(); await api.login(`marketing-${run}@auro.ai`, "Creation entry QA");
  token = api.getToken()!;
  world = await api.createWorkspace("Creation entry QA", `creation-${run}`);
  await api.markUserOnboarded();
});
test.afterAll(async () => { if (world) { api.setWorkspaceId(world.id); api.setWorkspaceSlug(world.slug); await api.deleteWorkspace(); } });

test("the three selected creations survive login/world entry and open their actual dialogs", async ({ page }) => {
  await page.route("**/www.googletagmanager.com/**", route => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.addInitScript(value => localStorage.setItem("auro_token", value), token);
  // The entry check never initializes or mutates the checkout's shared Life simulation.
  const agents = seedResidents(2);
  await page.route(/\/api\/life(?:\?.*)?$/, route => route.fulfill({ json: {
    world: { id: world.id, workspaceId: world.id, tick: 560, tickMs: 2000, updatedAt: new Date().toISOString() },
    agents, resources: seedResources(agents), actions: [], events: [], eventCursor: 0, town: newTown(agents),
  } }));
  for (const [kind, feature] of [["tank", "tanks"], ["fish", "fish"], ["resident", "life"]] as const) {
    await page.context().clearCookies({ name: "auro_logged_in" });
    await page.goto("/?lang=en");
    await page.getByRole("tab", { name: new RegExp(kind === "tank" ? "Tank" : kind === "fish" ? "Fish" : "Resident") }).click();
    await page.locator(`[data-analytics-cta="hero_create_${kind}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/${world.slug}/${feature}(?:[?#]|$)`), { timeout: 30000 });
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 30000 });
    await expect.poll(() => new URL(page.url()).searchParams.has("create")).toBe(false);
    await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});
