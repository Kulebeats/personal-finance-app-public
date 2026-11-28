import { defineConfig, devices } from "@playwright/test";
import { prepareTestEnvironment } from "./server/testing/test-target.mjs";

const environment = prepareTestEnvironment();
if (environment.mode !== "database" || !environment.target?.server) {
  throw new Error("Production-mode browser tests require an explicit disposable database and owned server");
}
const origin = environment.target.server.origin;

/**
 * QA-01 / R20.3: the production-mode verification profile.
 *
 * Runs `production-*.spec.ts` only, against the same guarded disposable target
 * as the other e2e configs, but with the app out of test mode: CSRF and the
 * limiters are live and the built client is served
 * (server/testing/production-profile.ts says exactly what is and is not
 * production about it). Synthetic data only; provider, mail and push egress
 * stay blanked. Reported separately from the smoke and completion runs.
 *
 * Every spec first reads /__test/profile and fails unless the running app
 * reports it has left test mode, so a profile that silently fell back to
 * NODE_ENV=test cannot pass.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["production-*.spec.ts"],
  workers: 1, retries: 0,
  timeout: 90_000, forbidOnly: true, reporter: process.env.PW_REPORTER ?? "line",
  use: { baseURL: origin, serviceWorkers: "block", timezoneId: "Africa/Lusaka", actionTimeout: 15_000,
    trace: "off", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node --import tsx server/testing/browser-server.ts",
    env: { ...process.env, NODE_ENV: "test", TZ: "UTC", PFA_BROWSER_PROFILE: "production", TEST_BROWSER_CLIENT: "built" },
    url: `${origin}/__test/identity`, reuseExistingServer: false, timeout: 120_000,
  },
});
