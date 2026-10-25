import { test as base, expect, type APIRequestContext } from "@playwright/test";

// Independent game fixtures must never log into Auro or touch its workspace data.
export class TestApiClient {
  constructor(private readonly request: APIRequestContext) {}
  async assertPractice() {
    const response = await this.request.get("/api/deal/status");
    expect(response.ok()).toBeTruthy();
    expect(await response.json()).toMatchObject({
      mode: "scripted",
      ready: true,
    });
  }
  async readSession(id: string) {
    const response = await this.request.get(`/api/deal/sessions/${id}`);
    expect(response.ok()).toBeTruthy();
    return response.json();
  }
}
export const test = base.extend<{ api: TestApiClient }>({
  api: async ({ page }, use) => {
    const api = new TestApiClient(page.request);
    await api.assertPractice();
    await use(api);
  },
});
export { expect };
