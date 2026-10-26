import "./e2e/env";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // The performance scenario has its own config: one worker, no retries, and a
  // running production build. It must not be swept up by the ordinary suite.
  // Dedicated game harnesses use the config under apps/deal.
  testIgnore: ["**/perf/**", "**/deal/**"],
  timeout: 60000,
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  // Don't auto-start servers — they must be running already
  // This avoids complexity and port conflicts during testing
});
