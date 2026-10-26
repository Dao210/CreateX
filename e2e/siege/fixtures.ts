import { test as base, expect } from "@playwright/test";
import { TestApiClient } from "../fixtures";
import { siegePreferencesKey } from "../../packages/core/siege/preferences";

interface SiegeGame { workshopHref: string; campaignHref: string; namespace: string; userId: string; workspaceId: string; slug: string }
const games = new WeakMap<TestApiClient, SiegeGame>();
export const test = base.extend<{ api: TestApiClient; game: SiegeGame }>({
  api: [async ({ page, baseURL }, use, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("requestfailed", request => errors.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
    page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
    const api = new TestApiClient();
    const run = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const login = await api.login(`siege-${run}@auro.ai`, "Siege QA");
    const workspace = await api.createWorkspace("Siege QA", `siege-${run}`);
    try {
      await api.markUserOnboarded();
      games.set(api, { workshopHref: `/${workspace.slug}/siege`, campaignHref: `/${workspace.slug}/siege/campaign`, namespace: siegePreferencesKey(login.user.id, workspace.id), userId: login.user.id, workspaceId: workspace.id, slug: workspace.slug });
      await page.context().addCookies([{ name: "auro-locale", value: "zh-Hans", url: baseURL! }]);
      await page.addInitScript(token => localStorage.setItem("auro_token", token), api.getToken()!);
      await use(api);
    } finally {
      if (errors.length) await testInfo.attach("browser-errors", { body: JSON.stringify(errors, null, 2), contentType: "application/json" });
      if (testInfo.status !== testInfo.expectedStatus) console.error("Siege browser diagnostic", JSON.stringify({ url: page.url(), errors }));
      await api.deleteWorkspace(); await api.cleanup();
    }
  }, { auto: true }],
  game: async ({ api }, use) => { await use(games.get(api)!); },
});
export { expect };
