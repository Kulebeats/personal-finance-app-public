/**
 * OPS-011: every local test entry point refuses a database that is not a
 * disposable test target, local browser runs report a missing browser build as
 * ENVIRONMENT BLOCKED, and no test artefact is tracked.
 *
 * Each refusal uses a canary database name. Nothing here connects anywhere:
 * the canary port is closed and every refusal must happen before a connection.
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromiumBuildProblem, ENVIRONMENT_BLOCKED_EXIT } from "../browser-build.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const CANARY_DB = "ops011_canary_dev_db";
const CANARY_SECRET = "canary-sentinel";
const CANARY_URL = `postgresql://canary:${CANARY_SECRET}@127.0.0.1:55432/${CANARY_DB}`;
const SPAWN_TIMEOUT_MS = 30_000;
const CONFIG_TEST_TIMEOUT_MS = 45_000;
const temp: string[] = [];
afterEach(() => { for (const directory of temp.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function tempDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pfa-ops011-"));
  temp.push(directory);
  return directory;
}

/** The parent run's own target must never leak into a child: it would make the canary look safe. */
function childEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(TEST_|PFA_TEST_)/.test(key)) delete env[key];
  return { ...env, ...overrides };
}

function manifest(database: string, runId: string): string {
  const file = path.join(tempDirectory(), "target.json");
  writeFileSync(file, JSON.stringify({ version: 1, disposable: true, synthetic: true, host: "127.0.0.1",
    port: 55432, database, runId, server: { origin: "http://127.0.0.1:5199" } }));
  return file;
}

const output = (result: ReturnType<typeof spawnSync>) => `${result.stdout ?? ""}${result.stderr ?? ""}`;

describe("OPS-011 test configs refuse a canary dev database in database mode", () => {
  it.each([
    ["vitest.config.ts", "vitest"], ["server/vitest.config.ts", "vitest"], ["client/vitest.config.ts", "vitest"],
    ["playwright.config.ts", "playwright"], ["playwright.completion.config.ts", "playwright"],
    ["server/testing/browser-guard.config.ts", "playwright"],
  ])("%s refuses before collecting a test", (config, runner) => {
    const cli = runner === "vitest" ? "vitest/vitest.mjs" : "@playwright/test/cli.js";
    const args = runner === "vitest" ? ["list"] : ["test", "--list"];
    const result = spawnSync(process.execPath, [path.join(root, "node_modules", cli), ...args,
      "--config", path.join(root, config)], {
      cwd: root, encoding: "utf8", timeout: SPAWN_TIMEOUT_MS,
      env: childEnv({ PFA_TEST_MODE: "database", TEST_TARGET_MANIFEST: manifest(CANARY_DB, "ops011canary"),
        TEST_RUN_ID: "ops011canary", TEST_DATABASE_URL: CANARY_URL }),
    });
    expect(result.status).not.toBe(0);
    expect(output(result)).toContain("REFUSING TEST TARGET: database must be a unique pfa_completion/pfa_ci disposable name");
    expect(output(result)).not.toContain(CANARY_SECRET);
  }, CONFIG_TEST_TIMEOUT_MS);
});

describe("OPS-011 the database module refuses a test process that skipped the protected configs", () => {
  const dbModule = pathToFileURL(path.join(root, "server/db.ts")).href;
  const emptyDotenv = path.join(root, "server/testing/fixtures/empty.env");

  it.each([
    ["a script run with NODE_ENV=test", { NODE_ENV: "test" }],
    ["a Vitest worker outside the protected configs", { NODE_ENV: "development", VITEST: "true" }],
  ])("%s gets no pool for the canary database", (_case, overrides) => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      `await import(${JSON.stringify(dbModule)}); console.log("POOL CREATED");`], {
      cwd: root, encoding: "utf8", timeout: SPAWN_TIMEOUT_MS,
      env: childEnv({ ...overrides, DATABASE_URL: CANARY_URL, DOTENV_CONFIG_PATH: emptyDotenv }),
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("POOL CREATED");
    expect(result.stderr).toContain("REFUSING TEST TARGET: a test process reached the database without the protected test environment");
    expect(output(result)).not.toContain(CANARY_SECRET);
  }, CONFIG_TEST_TIMEOUT_MS);
});

describe("OPS-011 a missing browser build is ENVIRONMENT BLOCKED, never a test result", () => {
  const browsers = path.join(path.sep, "synthetic", "ms-playwright");
  const executablePath = path.join(browsers, "chromium-1208", "chrome-win64", "chrome.exe");
  const present = (folders: string[]) => (file: string) =>
    folders.some((folder) => file === path.join(browsers, folder, "INSTALLATION_COMPLETE"));
  const problem = (args: string[], folders: string[]) => chromiumBuildProblem({ executablePath, args,
    version: "1.58.0", exists: present(folders), list: () => folders });

  it("names the build a headless run needs, what the host has, and the install command", () => {
    expect(problem(["test"], ["chromium-1223", "chromium_headless_shell-1223"])).toBe(
      `ENVIRONMENT BLOCKED (not a test result): Playwright 1.58.0 needs the Chromium build chromium_headless_shell-1208 in ${browsers}, ` +
      "but this host has chromium-1223, chromium_headless_shell-1223. " +
      'Install the matching build with "npx playwright install chromium" (a download), then run the suite again.');
    expect(problem(["test"], ["chromium_headless_shell-1208"])).toBeUndefined();
  });

  it("a windowed run needs the full browser build of the same revision", () => {
    expect(problem(["test", "--headed"], ["chromium_headless_shell-1208"])).toContain("needs the Chromium build chromium-1208 ");
    expect(problem(["test", "--ui"], ["chromium-1208"])).toBeUndefined();
  });

  it("the protected runner stops with the blocked exit code before Playwright starts", () => {
    const runId = "ops011browser";
    const database = `pfa_ci_ops011_${runId}_test`;
    const result = spawnSync(process.execPath, [path.join(root, "scripts/run-protected-tests.mjs"),
      "database", "playwright", "test", "--list"], {
      cwd: root, encoding: "utf8", timeout: SPAWN_TIMEOUT_MS,
      env: childEnv({ PFA_TEST_MODE: "database", TEST_TARGET_MANIFEST: manifest(database, runId), TEST_RUN_ID: runId,
        TEST_DATABASE_URL: `postgresql://synthetic@127.0.0.1:55432/${database}`, PLAYWRIGHT_BROWSERS_PATH: tempDirectory() }),
    });
    expect(result.status).toBe(ENVIRONMENT_BLOCKED_EXIT);
    expect(result.stderr).toContain("ENVIRONMENT BLOCKED (not a test result)");
    expect(result.stderr).toContain("this host has no Chromium build");
    expect(output(result)).not.toMatch(/Listing tests|Total: \d+ test/);
  }, CONFIG_TEST_TIMEOUT_MS);
});

describe("OPS-011 test artefacts stay out of git", () => {
  const ARTEFACT = /(^|\/)(coverage\/|playwright-report\/|test-results\/)|junit[^/]*\.xml$|(^|\/)test-results\.txt$|\.lcov$|lcov\.info$/;

  it("tracks no coverage, JUnit, Playwright report or captured-run file, and ignores new ones", () => {
    const tracked = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
    expect(tracked.status, tracked.stderr).toBe(0);
    expect(tracked.stdout.split("\0").filter((file) => ARTEFACT.test(file))).toEqual([]);
    const samples = ["e2e-junit.xml", "server/test-results.txt", "server/coverage/.tmp/coverage-0.json",
      "coverage/coverage-final.json", "playwright-report/index.html", "test-results/run/trace.zip"];
    const ignored = spawnSync("git", ["check-ignore", "--no-index", ...samples], { cwd: root, encoding: "utf8" });
    expect(ignored.stdout.trim().split(/\r?\n/)).toEqual(samples);
  });
});
