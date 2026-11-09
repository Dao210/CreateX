import { expect, test } from "@playwright/test";

test.use({ locale: "zh-CN" });

for (const { path, title } of [
  { path: "/privacy", title: "Privacy Policy" },
  { path: "/licensing", title: "Licensing" },
]) {
  test(`${path} respects an explicit language despite a conflicting account preference`, async ({
    page,
    context,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("The locale regression requires a configured baseURL");
    const origin = new URL(baseURL).origin;
    let documentRequests = 0;
    const unexpectedApiRequests: string[] = [];
    const pageErrors: string[] = [];

    await context.addCookies([{ name: "auro-locale", value: "zh-Hans", url: origin }]);
    await context.routeWebSocket(url => url.pathname === "/ws", socket => socket.close());
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("request", request => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        documentRequests += 1;
      }
    });

    // Exercise the real page, proxy, providers and account-locale effect without
    // creating backend rows or using a real login session.
    await context.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/api/me") {
        return route.fulfill({ json: {
          id: "66666666-6666-4666-8666-666666666666",
          name: "Document locale test",
          email: "document-locale@example.com",
          language: "zh-Hans",
        } });
      }
      if (url.pathname === "/api/config") return route.fulfill({ json: {} });
      if (url.pathname === "/api/workspaces") return route.fulfill({ json: [] });
      if (url.pathname === "/api/client-usage") return route.fulfill({ status: 204 });
      if (url.pathname.startsWith("/api/")) {
        unexpectedApiRequests.push(`${request.method()} ${url.pathname}`);
        return route.fulfill({ status: 500, json: { error: "Unexpected API request" } });
      }
      if (url.origin !== origin) return route.abort();
      return route.continue();
    });

    await page.goto(`${path}?lang=en`);
    // This link only appears once the authenticated user has reached the store
    // that UserLocaleSync observes; the initial server HTML alone is insufficient.
    await expect(page.locator("header").getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    // Allow pending locale effects and any resulting document navigation to run.
    await page.waitForTimeout(1000);
    expect(documentRequests).toBe(1);
    await expect(page).toHaveURL(`${origin}${path}?lang=en`);
    expect((await context.cookies(origin)).find(cookie => cookie.name === "auro-locale")?.value).toBe("en");
    expect(pageErrors).toEqual([]);
    expect(unexpectedApiRequests).toEqual([]);

    // Once the explicit URL preference is removed, account synchronization
    // should still restore Chinese and finish after a single reload.
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.locator("header").getByRole("link", { name: "进入工作台", exact: true })).toBeVisible();
    await page.waitForTimeout(1000);
    expect(documentRequests).toBe(3);
    expect((await context.cookies(origin)).find(cookie => cookie.name === "auro-locale")?.value).toBe("zh-Hans");
    expect(unexpectedApiRequests).toEqual([]);
  });
}
