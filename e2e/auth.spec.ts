import { test, expect } from "@playwright/test";
import { createTestApi, loginAsDefault, openWorkspaceMenu, waitForPageText } from "./helpers";
import { TestApiClient } from "./fixtures";

test.describe("Authentication", () => {
  test("login page renders correctly", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await waitForPageText(page, "Sign in to Auro");

    await expect(page.getByText("Sign in to Auro")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible();
    await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeDisabled();
  });

  test("login and redirect to /issues", async ({ page }) => {
    const workspaceSlug = await loginAsDefault(page);

    await expect(page).toHaveURL(new RegExp(`/${workspaceSlug}/issues$`));
    await expect(page.getByRole("button", { name: "New Issue" })).toBeVisible();
  });

  test("password login enters the account's workspace", async ({ page }) => {
    const api = new TestApiClient();
    const suffix = Date.now().toString(36);
    const email = `e2e-password-${suffix}@auro.ai`;
    const password = "E2E-password-signin-2026";
    await api.login(email, "Password E2E", password);
    try {
      const workspace = await api.createWorkspace("Password E2E", `password-e2e-${suffix}`);
      await api.markUserOnboarded();
      // The identity probe runs after hydration, when controlled inputs are
      // connected to React and will retain the values entered by the test.
      const sessionCheck = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/me");
      await page.goto("/login", { waitUntil: "domcontentloaded" });
      await sessionCheck;
      await page.getByRole("textbox", { name: "Email" }).fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${workspace.slug}/issues$`), { timeout: 30000 });
      await expect(page.getByRole("heading", { name: "Issues", exact: true })).toBeVisible({ timeout: 30000 });
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(new RegExp(`/${workspace.slug}/issues$`));
      await expect(page.getByRole("heading", { name: "Issues", exact: true })).toBeVisible({ timeout: 30000 });
    } finally {
      await api.deleteWorkspace();
    }
  });

  test("unauthenticated user is redirected to /login", async ({ page }) => {
    const api = await createTestApi();
    const [workspace] = await api.getWorkspaces();
    if (!workspace) {
      throw new Error("E2E workspace was not created");
    }

    await page.goto(`/${workspace.slug}/issues`, { waitUntil: "domcontentloaded" });
    await page.waitForURL("**/login", { timeout: 10000, waitUntil: "domcontentloaded" });
    await waitForPageText(page, "Sign in to Auro");
  });

  test("logout redirects to /login", async ({ page }) => {
    await loginAsDefault(page);

    // Open the workspace dropdown menu
    await openWorkspaceMenu(page);

    await page.getByRole("menuitem", { name: "Log out" }).click();

    await page.waitForURL("**/login", { timeout: 10000, waitUntil: "domcontentloaded" });
    await waitForPageText(page, "Sign in to Auro");
    await expect(page).toHaveURL(/\/login/);
  });
});
