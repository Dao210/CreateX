import { test as base, expect, type APIRequestContext } from "@playwright/test";

// Independent game tests use their own anonymous cookies and file sessions.
export class TestApiClient {
  constructor(private readonly request: APIRequestContext) {}
  async assertFixture() {
    const response = await this.request.get("/api/siege/status");
    expect(response.ok()).toBeTruthy();
    expect(await response.json()).toMatchObject({ mode: "fixture", ready: true, rulesVersion: "p0.2" });
  }
  async readSession(id: string) {
    const response = await this.request.get(`/api/siege/sessions/${id}`);
    expect(response.ok()).toBeTruthy(); return response.json();
  }
}
export const test = base.extend<{ api: TestApiClient }>({
  api: async ({ page }, use) => { const api = new TestApiClient(page.request); await api.assertFixture(); await use(api); },
});
export { expect };
