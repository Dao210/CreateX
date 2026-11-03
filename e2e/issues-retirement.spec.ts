import { expect, test } from "@playwright/test";
import { TestApiClient } from "./fixtures";

const api = new TestApiClient();
let workspace: { id: string; slug: string };

test.beforeAll(async () => {
  const suffix = `${Date.now()}-${process.pid}`;
  await api.login(`retirement-${suffix}@localhost`, "Retirement tester");
  workspace = await api.createWorkspace("Retirement world", `retirement-${suffix}`);
  await api.markUserOnboarded();
});

test.afterAll(async () => {
  if (workspace) await api.deleteWorkspace();
});

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([
    { name: "auro-locale", value: "en", url: baseURL! },
    { name: "auro_logged_in", value: "1", url: baseURL! },
    { name: "last_workspace_slug", value: workspace.slug, url: baseURL! },
  ]);
  await page.addInitScript((token) => localStorage.setItem("auro_token", token!), api.getToken());
});

test("world entry and settings have no retired task controls or traffic", async ({ page }) => {
  const retiredRequests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/(issues|projects|squads|issue-statuses|properties|quick-actions|search-index)(?:[/?]|$)/.test(request.url())) {
      retiredRequests.push(request.url());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/${workspace.slug}`);
  await expect(page).toHaveURL(new RegExp(`/${workspace.slug}/me$`));
  await expect(page.getByRole("heading", { name: "My Creations", exact: true })).toBeVisible();
  await expect(page.locator(`a[href^="/${workspace.slug}/issues"],a[href^="/${workspace.slug}/projects"],a[href^="/${workspace.slug}/squads"]`)).toHaveCount(0);

  await page.goto(`/${workspace.slug}/settings?tab=profile`);
  await expect(page.getByLabel("Nickname", { exact: true })).toBeVisible();
  await expect(page.getByText("This bio is provided as background context to agents working for you.")).toHaveCount(0);
  await page.goto(`/${workspace.slug}/settings?tab=workspace`);
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  await expect(page.getByLabel(/(?:task|issue) prefix/i)).toHaveCount(0);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(retiredRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("retired workspace route families return 404", async ({ page }) => {
  for (const suffix of ["issues", "issues/OLD-1", "projects", "projects/old", "my-issues", "squads"]) {
    const response = await page.goto(`/${workspace.slug}/${suffix}`);
    expect(response?.status(), suffix).toBe(404);
  }
});
