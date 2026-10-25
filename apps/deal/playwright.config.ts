import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "../../e2e/deal",
  outputDir: "../../test-results/deal",
  timeout: 45_000,
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.DEAL_TEST_URL || "http://127.0.0.1:13106",
    channel: process.env.DEAL_TEST_BROWSER_CHANNEL,
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
