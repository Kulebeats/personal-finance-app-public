import { defineConfig } from "@playwright/test";
import { prepareTestEnvironment } from "./test-target.mjs";

const environment = prepareTestEnvironment();
if (environment.mode !== "database" || !environment.target?.server) throw new Error("Browser guard proof requires a manifest target");
export default defineConfig({
  testDir: "./__tests__/browser",
  testMatch: "guards.browser.ts",
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: "list",
  outputDir: "../../.local/r00-browser/results",
  use: { baseURL: environment.target.server.origin, serviceWorkers: "block" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
