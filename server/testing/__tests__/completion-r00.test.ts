import { afterEach, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import net from "node:net";
import tls from "node:tls";
import pg from "pg";
import http from "node:http";
import request from "supertest";
import { prepareTestEnvironment, assertDatabaseIdentity, markerFor, type TestTarget } from "../test-target.mjs";
import { verifyBrowserTarget } from "../browser-target.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const coreUrl = pathToFileURL(path.join(root, "server/testing/test-target.mjs")).href;
const temp: string[] = [];
afterEach(() => { for (const directory of temp.splice(0)) rmSync(directory, { recursive: true }); });
const target: TestTarget = { version: 1, disposable: true, synthetic: true, host: "127.0.0.1", port: 55432,
  database: "pfa_completion_r00_marker123_test", runId: "marker123" };

describe("R00 safe environment and worker boundaries", () => {
  it("requires an explicit safe mode", () => {
    expect(() => prepareTestEnvironment({})).toThrow(/PFA_TEST_MODE/);
  });
  it("unit mode discards ambient DB, Redis and provider/mail/push configuration", () => {
    const env = { PFA_TEST_MODE: "unit", DATABASE_URL: "postgresql://fixture@localhost:5432/finance_app",
      REDIS_URL: "redis://example.invalid", GEMINI_API_KEY: "synthetic-sentinel", SMTP_HOST: "mail.invalid",
      VAPID_PRIVATE_KEY: "synthetic-sentinel", PGHOST: "example.invalid" };
    expect(prepareTestEnvironment(env).mode).toBe("unit");
    expect(env.DATABASE_URL).toContain(":1/pfa_unit_database_disabled");
    for (const name of ["REDIS_URL", "GEMINI_API_KEY", "SMTP_HOST", "VAPID_PRIVATE_KEY", "PGHOST"])
      expect(env[name as keyof typeof env]).toBe("");
  });
  it("later dotenv/config import cannot restore ambient .env credentials", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "pfa-r00-env-"));
    temp.push(directory);
    writeFileSync(path.join(directory, ".env"), "GEMINI_API_KEY=synthetic-poison\nREDIS_URL=redis://example.invalid\nSMTP_HOST=mail.invalid\nDATABASE_URL=postgresql://fixture@localhost:5432/finance_app\n");
    const dotenvUrl = pathToFileURL(path.join(root, "node_modules/dotenv/config.js")).href;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { prepareTestEnvironment } from ${JSON.stringify(coreUrl)};
      prepareTestEnvironment();
      await import(${JSON.stringify(dotenvUrl)});
      if (process.env.GEMINI_API_KEY || process.env.REDIS_URL || process.env.SMTP_HOST || !process.env.DATABASE_URL.includes(':1/')) process.exit(9);
    `], { cwd: directory, env: { ...process.env, PFA_TEST_MODE: "unit" }, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toContain("synthetic-poison");
  });
  it.each(["vitest.config.ts", "server/vitest.config.ts", "client/vitest.config.ts", "playwright.config.ts",
    "playwright.completion.config.ts", "playwright.production.config.ts", "server/testing/browser-guard.config.ts"])("direct %s refuses absent mode before test collection", (config) => {
    const env = { ...process.env };
    delete env.PFA_TEST_MODE;
    const isPlaywright = !config.includes("vitest");
    const runner = isPlaywright ? "@playwright/test/cli.js" : "vitest/vitest.mjs";
    const args = isPlaywright ? ["test", "--list"] : ["list"];
    const result = spawnSync(process.execPath, [path.join(root, "node_modules", runner), ...args, "--config", path.join(root, config)], {
      cwd: root, env, encoding: "utf8", timeout: 30000,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain("PFA_TEST_MODE");
  }, 45000);
  it("denies remote provider, SMTP and push sockets without making a probe", () => {
    expect(() => net.connect({ host: "provider.example.invalid", port: 443 })).toThrow(/TEST NETWORK DENIED/);
    expect(() => net.connect({ host: "smtp.example.invalid", port: 587 })).toThrow(/TEST NETWORK DENIED/);
    expect(() => tls.connect({ host: "push.example.invalid", port: 443 })).toThrow(/TEST NETWORK DENIED/);
  });
  it("denies the shared local database endpoint", () => {
    expect(() => net.connect({ host: "127.0.0.1", port: 5432 })).toThrow(/TEST NETWORK DENIED/);
  });
  it("denies a direct pg client aimed at another database before connect", async () => {
    const client = new pg.Client({ host: "127.0.0.1", port: 55432, database: "finance_app" });
    await expect(client.connect()).rejects.toThrow(/TEST DATABASE DENIED/);
  });
  it("denies an unverified query even when it is queued before connect", () => {
    const client = new pg.Client();
    expect(() => client.query("DELETE FROM users")).toThrow(/persisted run-marker/);
  });
  it("allows HTTP sockets only to a listener created by this test process", async () => {
    const server = net.createServer((socket) => { socket.end("synthetic"); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No owned test listener");
      const result = await new Promise<string>((resolve, reject) => {
        const socket = net.connect({ host: "127.0.0.1", port: address.port });
        socket.on("data", (data) => resolve(data.toString()));
        socket.on("error", reject);
      });
      expect(result).toBe("synthetic");
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
  it("permits Supertest's automatically created ephemeral HTTP listener", async () => {
    const server = http.createServer((_request, response) => response.end("synthetic"));
    await request(server).get("/").expect(200, "synthetic");
  });
  it("denies an unrelated live localhost listener without dispatch", async () => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      import net from 'node:net';
      const server = net.createServer(() => process.exit(9));
      server.listen(0, '127.0.0.1', () => console.log(server.address().port));
    `], { stdio: ["ignore", "pipe", "pipe"] });
    try {
      const port = await new Promise<number>((resolve, reject) => {
        child.stdout.once("data", (data) => resolve(+data.toString().trim()));
        child.once("error", reject);
        child.once("exit", (code) => reject(new Error(`Unowned listener exited: ${code}`)));
      });
      expect(() => net.connect({ host: "127.0.0.1", port })).toThrow(/TEST NETWORK DENIED/);
    } finally {
      child.kill();
      await new Promise<void>((resolve) => child.once("close", () => resolve()));
    }
  });
  it("revokes loopback permission when an owned listener closes", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No owned test listener");
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(() => net.connect({ host: "127.0.0.1", port: address.port })).toThrow(/TEST NETWORK DENIED/);
  });
  it("accepts a matching persisted identity and rejects foreign/missing markers", () => {
    const row = { database: target.database, host: target.host, port: target.port, marker: markerFor(target) };
    expect(() => assertDatabaseIdentity([row], target)).not.toThrow();
    expect(() => assertDatabaseIdentity([{ ...row, marker: "foreign" }], target)).toThrow(/persisted synthetic run marker/);
    expect(() => assertDatabaseIdentity([{ ...row, marker: "" }], target)).toThrow(/persisted synthetic run marker/);
    expect(() => assertDatabaseIdentity([{ ...row, database: "finance_app" }], target)).toThrow(/identity/);
  });
  it("propagates marker-phase socket loss once through promise, callback and Pool", () => {
    const guardUrl = pathToFileURL(path.join(root, "server/testing/postgres-guard.mjs")).href;
    const pgUrl = pathToFileURL(path.join(root, "node_modules/pg/lib/index.js")).href;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import pg from ${JSON.stringify(pgUrl)};
      import { installPostgresGuard } from ${JSON.stringify(guardUrl)};
      pg.Client.prototype.connect = function (callback) { queueMicrotask(() => callback(null)); };
      pg.Client.prototype.query = function () { return new Promise((resolve, reject) => {
        queueMicrotask(() => { const failure = new Error('synthetic-marker-socket-loss'); reject(failure); this.emit('error', failure); });
      }); };
      pg.Client.prototype.end = async function () {};
      await installPostgresGuard({ mode: 'database', target: ${JSON.stringify(target)} });
      const config = { host: '127.0.0.1', port: 55432, database: ${JSON.stringify(target.database)}, ssl: false };
      await assert.rejects(new pg.Client(config).connect(), /synthetic-marker-socket-loss/);
      let callbacks = 0;
      await new Promise((resolve, reject) => new pg.Client(config).connect((error) => {
        callbacks++; if (!error?.message.includes('synthetic-marker-socket-loss')) return reject(new Error('missing callback error')); resolve();
      }));
      assert.equal(callbacks, 1);
      const pool = new pg.Pool(config);
      await assert.rejects(pool.connect(), /synthetic-marker-socket-loss/);
      await pool.end();
    `], { cwd: root, encoding: "utf8", timeout: 10000 });
    expect(result.status, result.stderr).toBe(0);
  });
});

describe("R00 browser pre-mutation ordering", () => {
  const browserTarget = { ...target, server: { origin: "http://127.0.0.1:5127" } };
  function browserEnv() {
    const directory = mkdtempSync(path.join(os.tmpdir(), "pfa-r00-browser-"));
    temp.push(directory);
    const manifest = path.join(directory, "target.json");
    writeFileSync(manifest, JSON.stringify(browserTarget));
    return { PFA_TEST_MODE: "database", TEST_TARGET_MANIFEST: manifest, TEST_RUN_ID: target.runId,
      TEST_DATABASE_URL: `postgresql://synthetic@127.0.0.1:55432/${target.database}` };
  }
  it("requires DB identity then HTTP identity before permitting fixture mutation", async () => {
    const order: string[] = [];
    await verifyBrowserTarget(browserTarget.server.origin, browserEnv(), {
      verifyDatabase: async () => { order.push("database-marker"); return browserTarget; },
      fetch: async () => { order.push("http-marker"); return Response.json({
        runId: target.runId, database: target.database, origin: browserTarget.server.origin,
      }); },
    });
    order.push("fixture-write");
    expect(order).toEqual(["database-marker", "http-marker", "fixture-write"]);
  });
  it("rejects a foreign HTTP marker without reaching fixture writes", async () => {
    let writes = 0;
    await expect((async () => {
      await verifyBrowserTarget(browserTarget.server.origin, browserEnv(), {
        verifyDatabase: async () => browserTarget,
        fetch: async () => Response.json({ runId: "foreign", database: target.database, origin: browserTarget.server.origin }),
      });
      writes++;
    })()).rejects.toThrow(/marker mismatch/);
    expect(writes).toBe(0);
  });
});
