import { test, expect, type Page } from "@playwright/test";
import { TestApiClient } from "./fixtures";

async function signIn(page: Page, api: TestApiClient) {
  await page.addInitScript((token) => localStorage.setItem("auro_token", token!), api.getToken());
}

async function removeWorkspaces(api: TestApiClient) {
  for (const workspace of await api.getWorkspaces()) {
    api.setWorkspaceId(workspace.id);
    await api.deleteWorkspace();
  }
}

test("onboarding automatically creates a workspace and replaces the loading route", async ({ page }) => {
  const api = new TestApiClient();
  await api.login(`civilization-${Date.now()}@localhost`, "Civilization Tester");
  await signIn(page, api);
  const creates: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/workspaces") creates.push(request.url());
  });
  try {
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/[^/]+\/issues$/, { timeout: 30000 });
    const workspaces = await api.getWorkspaces();
    expect(workspaces).toHaveLength(1);
    expect(creates).toHaveLength(1);
    expect(new URL(page.url()).pathname).toBe(`/${workspaces[0]!.slug}/issues`);
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/${workspaces[0]!.slug}/issues$`));
    await expect(page.getByRole("heading", { name: "A new civilization" })).toHaveCount(0);
  } finally {
    await removeWorkspaces(api);
  }
});

test("onboarding resumes an existing workspace without creating another", async ({ page }) => {
  const api = new TestApiClient();
  await api.login(`civilization-resume-${Date.now()}@localhost`, "Resume Tester");
  const workspace = await api.ensureWorkspace("Existing civilization", `civilization-${Date.now()}`);
  await signIn(page, api);
  try {
    await page.goto("/onboarding");
    await expect(page).toHaveURL(new RegExp(`/${workspace.slug}/issues$`), { timeout: 30000 });
    expect(await api.getWorkspaces()).toHaveLength(1);
  } finally {
    await removeWorkspaces(api);
  }
});

test("onboarding shows a retry action after a failed completion", async ({ page }) => {
  const api = new TestApiClient();
  await api.login(`civilization-retry-${Date.now()}@localhost`, "Retry Tester");
  await signIn(page, api);
  await page.route("**/api/me/onboarding/complete", async (route) => {
    await route.fulfill({ status: 503, json: { error: "Temporarily unavailable" } });
  }, { times: 1 });
  try {
    await page.goto("/onboarding");
    await expect(page.getByRole("alert")).toHaveText("Your workspace could not be prepared.", { timeout: 30000 });
    await expect(page).toHaveURL(/\/onboarding$/);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page).toHaveURL(/\/[^/]+\/issues$/, { timeout: 30000 });
    expect(await api.getWorkspaces()).toHaveLength(1);
  } finally {
    await removeWorkspaces(api);
  }
});
