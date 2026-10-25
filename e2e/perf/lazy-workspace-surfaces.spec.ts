import { expect, test } from "@playwright/test";
import { WORKSPACE_SLUG } from "./fixtures/typing-under-live-runs";
import { mockWorkspaceRequests } from "./fixtures/workspace-api";

test("workspace loads search on demand without retired features", async ({ page, context, baseURL }) => {
  test.setTimeout(60_000);
  page.setDefaultTimeout(10_000);
  const origin = new URL(baseURL!).origin;
  const unknownRequests: string[] = [];
  const external: string[] = [];
  const errors: string[] = [];
  const retiredRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/(issues|projects|search-index)(?:\/|\?|$)/.test(request.url())) retiredRequests.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await context.addCookies([
    { name: "auro_logged_in", value: "1", url: origin },
    { name: "last_workspace_slug", value: WORKSPACE_SLUG, url: origin },
    { name: "auro-locale", value: "en", url: origin },
  ]);
  await mockWorkspaceRequests(context, origin, { unknownRequests, external });
  await context.routeWebSocket((url) => url.pathname === "/ws", (socket) => socket.onMessage(() => {}));
  await page.goto(`${origin}/${WORKSPACE_SLUG}/tanks`);
  await expect(page.getByTestId("tank-battlefield")).toBeVisible();

  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.keyboard.press("c");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator(`a[href^="/${WORKSPACE_SLUG}/issues"], a[href^="/${WORKSPACE_SLUG}/projects"]`)).toHaveCount(0);
  await page.goto(`${origin}/${WORKSPACE_SLUG}/inbox`);
  await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();
  for (const suffix of ["issues", "issues/PERF-1", "projects", "projects/p1", "my-issues"]) {
    const response = await page.goto(`${origin}/${WORKSPACE_SLUG}/${suffix}`);
    expect(response?.status(), suffix).toBe(404);
  }
  expect(retiredRequests).toEqual([]);

  expect(unknownRequests).toEqual([]);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("system inbox stays usable on desktop and narrow screens", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const unknownRequests: string[] = [];
  const external: string[] = [];
  const notice = {
    id: "9c34385c-5f90-4ba4-a63c-1b5c67cf6635", workspace_id: "00000000-0000-0000-0000-000000000001",
    recipient_type: "member", recipient_id: "00000000-0000-0000-0000-000000000002", actor_type: "system", actor_id: null,
    type: "autopilot_paused", severity: "info", issue_id: null, title: "Autopilot paused", body: "Review this automation before resuming it.",
    issue_status: null, issue_priority: null, read: true, archived: false, details: null, created_at: "2026-10-25T00:00:00Z",
  };
  await context.addCookies([
    { name: "auro_logged_in", value: "1", url: origin },
    { name: "last_workspace_slug", value: WORKSPACE_SLUG, url: origin },
    { name: "auro-locale", value: "en", url: origin },
  ]);
  await mockWorkspaceRequests(context, origin, { unknownRequests, external });
  await context.route((url) => url.pathname === "/api/inbox", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify([
      notice,
      { ...notice, id: "old-task", type: "issue_assigned", issue_id: "old-issue", title: "Retired task notification" },
      { ...notice, id: "old-quick-create", type: "quick_create_failed", title: "Retired quick-create notification" },
    ]),
  }));
  await context.routeWebSocket((url) => url.pathname === "/ws", (socket) => socket.onMessage(() => {}));
  for (const [width, height, label] of [[1280, 800, "desktop"], [390, 844, "mobile"]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(`${origin}/${WORKSPACE_SLUG}/inbox`);
    await page.getByRole("button", { name: /^Autopilot paused/ }).click();
    await expect(page.getByRole("heading", { name: "Autopilot paused" })).toBeVisible();
    await expect(page.getByText("Retired task notification")).toHaveCount(0);
    await expect(page.getByText("Retired quick-create notification")).toHaveCount(0);
    await expect(page.getByText(notice.body)).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `tasks/verification/issue-project-removal-2026-10-25/inbox-${label}.png` });
    if (label === "mobile") {
      await page.getByRole("button", { name: "Inbox", exact: true }).click();
      await expect(page.getByRole("button", { name: /^Autopilot paused/ })).toBeVisible();
    }
  }
  expect(unknownRequests).toEqual([]);
  expect(external).toEqual([]);
});
