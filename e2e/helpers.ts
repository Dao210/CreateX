import { expect, type Page } from "@playwright/test";
import { TestApiClient } from "./fixtures";

const DEFAULT_E2E_NAME = "E2E User";
const E2E_WORKER = process.env.TEST_PARALLEL_INDEX ?? process.env.TEST_WORKER_INDEX ?? "0";
const E2E_RUN_ID = process.env.E2E_RUN_ID ?? `${Date.now().toString(36)}-${process.pid.toString(36)}`;
const DEFAULT_E2E_EMAIL = `e2e-${E2E_WORKER}-${E2E_RUN_ID}@auro.ai`;
const DEFAULT_E2E_WORKSPACE = `e2e-workspace-${E2E_WORKER}-${E2E_RUN_ID}`;

export async function waitForPageText(page: Page, text: string, timeout = 30000) {
  await page.waitForFunction(
    (expected) => document.body?.innerText.includes(expected),
    text,
    { timeout },
  );
}

export async function reloadAppPage(page: Page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForCreationsPage(page);
}

/**
 * Log in as the default E2E user and ensure the workspace exists first.
 * Seeds a verification fixture, authenticates through the API, then injects
 * the token into localStorage so the browser session is authenticated.
 *
 * Returns the E2E workspace slug so callers can build workspace-scoped URLs.
 */
export async function loginAsDefault(page: Page): Promise<string> {
  const api = new TestApiClient();
  await api.login(DEFAULT_E2E_EMAIL, DEFAULT_E2E_NAME);
  const workspace = await api.ensureWorkspace(
    `E2E Workspace ${E2E_WORKER}`,
    DEFAULT_E2E_WORKSPACE,
  );
  await api.markUserOnboarded();

  const token = api.getToken();
  if (!token) {
    throw new Error("E2E login did not return an auth token");
  }

  await page.addInitScript((t) => {
    localStorage.setItem("auro_token", t);
  }, token);
  await page.goto(`/${workspace.slug}/me`, { waitUntil: "domcontentloaded" });
  await waitForCreationsPage(page);
  return workspace.slug;
}

/**
 * Create a TestApiClient logged in as the default E2E user.
 * Delete test-created worlds explicitly during teardown.
 */
export async function createTestApi(): Promise<TestApiClient> {
  const api = new TestApiClient();
  await api.login(DEFAULT_E2E_EMAIL, DEFAULT_E2E_NAME);
  await api.ensureWorkspace(`E2E Workspace ${E2E_WORKER}`, DEFAULT_E2E_WORKSPACE);
  await api.markUserOnboarded();
  return api;
}

async function waitForCreationsPage(page: Page) {
  await expect(page.getByRole("heading", { name: "My Creations", exact: true })).toBeVisible({ timeout: 30000 });
}
