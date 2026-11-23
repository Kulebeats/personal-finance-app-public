import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
async function config() { vi.resetModules(); return (await import("../../drizzle.config")).default; }
function childEnvironment() {
  return { ...Object.fromEntries(["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR"]
    .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]!])),
  DOTENV_CONFIG_PATH: path.join(root, "server/testing/fixtures/empty.env") };
}
function drizzle(command: string, configuration: string, env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ["--import", pathToFileURL(path.join(root, "server/__tests__/fixtures/r19-drizzle-guard.mjs")).href,
    path.join(root, "node_modules/drizzle-kit/bin.cjs"), command, "--config", configuration],
  { cwd: root, env, encoding: "utf8", timeout: 20000 });
}

it("permits schema generation without database credentials", async () => {
  vi.stubEnv("DATABASE_URL", "");
  expect(Reflect.get(await config(), "dbCredentials")).toBeUndefined();
});

it("uses the application verified TLS policy with explicit driver fields", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DATABASE_URL", "postgresql://synthetic@db.example.invalid:6432/fixture?sslmode=require");
  const credentials: unknown = Reflect.get(await config(), "dbCredentials");
  expect(credentials).toMatchObject({ host: "db.example.invalid", port: 6432, database: "fixture",
    ssl: { rejectUnauthorized: true, checkServerIdentity: expect.any(Function) } });
  expect(credentials).not.toHaveProperty("url");
});

it("refuses insecure migration configuration before driver construction", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DATABASE_URL", "postgresql://synthetic@db.example.invalid/fixture");
  vi.stubEnv("DATABASE_SSL_REJECT_UNAUTHORIZED", "false");
  await expect(config()).rejects.toThrow(/verification/);
});

it("installed migrate validates credentials and preserves verification at the pg driver boundary without connecting", () => {
  const configuration = path.join(root, "drizzle.config.ts");
  const verified = drizzle("migrate", configuration, { ...childEnvironment(), NODE_ENV: "production",
    DATABASE_URL: "postgresql://synthetic:fixturepass@127.0.0.1:65431/fixture?sslmode=require", PFA_R19_CAPTURE_POOL: "1" });
  expect(verified.stdout + verified.stderr).toContain("R19_VERIFIED_DRIVER_BOUNDARY");
  expect(verified.stdout + verified.stderr).toContain("R19_SYNTHETIC_STOP_BEFORE_DB_CONNECT");
  const missing = drizzle("migrate", configuration, { ...childEnvironment(), PFA_R19_CAPTURE_POOL: "1" });
  expect(missing.stdout + missing.stderr).not.toContain("R19_VERIFIED_DRIVER_BOUNDARY");
  expect(missing.stdout + missing.stderr).toMatch(/provide required params|credentials|database connection/i);
  const insecure = drizzle("migrate", configuration, { ...childEnvironment(), NODE_ENV: "production",
    DATABASE_URL: "postgresql://synthetic@127.0.0.1:65431/fixture", DATABASE_SSL_REJECT_UNAUTHORIZED: "false", PFA_R19_CAPTURE_POOL: "1" });
  expect(insecure.stdout + insecure.stderr).toContain("verification cannot be disabled");
  expect(insecure.stdout + insecure.stderr).not.toContain("R19_VERIFIED_DRIVER_BOUNDARY");
}, 25000);

it("installed migrate accepts an application-supported passwordless URL without connecting", () => {
  const child = drizzle("migrate", path.join(root, "drizzle.config.ts"), { ...childEnvironment(), NODE_ENV: "production",
    DATABASE_URL: "postgresql://synthetic@127.0.0.1:65431/fixture", PFA_R19_CAPTURE_POOL: "1", PFA_R19_EXPECT_NO_PASSWORD: "1" });
  expect(child.stdout + child.stderr).toContain("R19_VERIFIED_DRIVER_BOUNDARY");
  expect(child.stdout + child.stderr).toContain("R19_SYNTHETIC_STOP_BEFORE_DB_CONNECT");
}, 25000);

it("actual installed Drizzle generates into an owned directory without a database", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pfa-r19-drizzle-"));
  try {
    const output = path.join(directory, "generated");
    const configuration = path.join(directory, "drizzle.config.ts");
    fs.writeFileSync(configuration, `import config from ${JSON.stringify(path.join(root, "drizzle.config.ts"))};\nexport default {...config, out:${JSON.stringify(output)}, schema:${JSON.stringify(path.join(root, "shared/schema.ts").replace(/\\/g, "/"))}};\n`);
    const child = drizzle("generate", configuration, childEnvironment());
    expect(child.status, child.stderr + child.stdout).toBe(0);
    expect(fs.readdirSync(output).some((file) => file.endsWith(".sql"))).toBe(true);
    expect(fs.existsSync(path.join(output, "meta/_journal.json"))).toBe(true);
  } finally {
    const resolved = fs.realpathSync(directory);
    expect(resolved.startsWith(fs.realpathSync(os.tmpdir()) + path.sep)).toBe(true);
    expect(path.basename(resolved).startsWith("pfa-r19-drizzle-")).toBe(true);
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}, 25000);
