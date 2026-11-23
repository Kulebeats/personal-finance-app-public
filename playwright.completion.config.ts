import { defineConfig, devices } from "@playwright/test";
import { prepareTestEnvironment } from "./server/testing/test-target.mjs";

const environment = prepareTestEnvironment();
if (environment.mode !== "database" || !environment.target?.server) {
  throw new Error("Completion browser tests require an explicit disposable database and owned server");
}
const origin = environment.target.server.origin;

/**
 * The CI e2e gate for submit-and-read-back specs (QA-01, R20.2).
 *
 * Every `completion-*.spec.ts` and `journey-*.spec.ts` is matched by pattern,
 * not by a hand-kept list: a list is how 22 specs ended up never running in CI.
 *
 * Projects:
 * - `chromium`: every matched spec at desktop size, except `@phone-only` tests.
 * - `phone`: tests tagged `@phone` or `@phone-only`, on Chromium at 375 x 812
 *   with touch and a mobile user agent (UX-02). CI installs Chromium only, so
 *   this is phone emulation, not a real device; the device matrix is recorded
 *   by the owner (docs checklist).
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["completion-*.spec.ts", "journey-*.spec.ts"],
  workers: 1, retries: 0,
  timeout: 90_000, forbidOnly: true, reporter: process.env.PW_REPORTER ?? "line",
  use: { baseURL: origin, serviceWorkers: "block", timezoneId: "Africa/Lusaka", actionTimeout: 15_000,
    trace: "off", screenshot: "only-on-failure" },
  projects: [
    { name: "chromium", grepInvert: /@phone-only/, use: { ...devices["Desktop Chrome"] } },
    { name: "phone", grep: /@phone\b|@phone-only/, use: {
      ...devices["Pixel 5"], viewport: { width: 375, height: 812 }, deviceScaleFactor: 2,
    } },
  ],
  webServer: {
    command: "node --import tsx server/testing/browser-server.ts",
    env: { ...process.env, NODE_ENV: "test", TZ: "UTC" },
    url: `${origin}/__test/identity`, reuseExistingServer: false, timeout: 120_000,
  },
});
