import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config. Specs live in `e2e/` (kept out of the Vitest unit suite, which
 * owns `**\/*.test.ts`). The dev server is started for the run and reused if one
 * is already up; specs stub `/api/generate`, so no ANTHROPIC_API_KEY or Redis is
 * needed to exercise the full keywords → tailored result → print-to-PDF path.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
