import { defineConfig, devices } from "@playwright/test";
import { prepareTestEnvironment } from "./server/testing/test-target.mjs";

const environment = prepareTestEnvironment();
if (environment.mode !== "database" || !environment.target?.server) {
  throw new Error("Playwright requires PFA_TEST_MODE=database and an explicit owned server origin");
}
const origin = environment.target.server.origin;

/**
 * Playwright E2E Test Configuration
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup",
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: "html",
  use: {
    baseURL: origin,
    serviceWorkers: "block",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "Mobile Chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],

  webServer: {
    command: "node --import tsx server/testing/browser-server.ts",
    env: {
      ...process.env,
      NODE_ENV: "test",
      SMTP_HOST: "",
      SMTP_PORT: "",
      SMTP_USER: "",
      SMTP_PASS: "",
      SMTP_FROM: "",
    },
    url: `${origin}/__test/identity`,
    reuseExistingServer: false,
    timeout: 120 * 1000,
  },
});
