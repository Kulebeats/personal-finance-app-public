// Exercise actual route registration and rate-limit middleware over loopback HTTP.
// Controllers/auth are inert synthetic handlers; no app bootstrap, dotenv or DB.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import express from "express";
import request from "supertest";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);
const next = (_req, _res, done) => done();
const logger = { info() {}, warn() {}, error() {} };
const controller = new Proxy({}, { get: (_, name) => (req, res) =>
  res.status(name === "login" ? 401 : 200).json({ synthetic: true }) });

function load(relative, resolve) {
  const source = readFileSync(path.join(root, relative), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)((id) => resolve(id), module, module.exports);
  return module.exports;
}

async function fixture() {
  process.env.NODE_ENV = "development"; // Real limiters enabled; no production app imported.
  const limits = load("server/middleware/rateLimit.ts", (id) => {
    if (id.endsWith("config/redis")) return { redis: null, productionRedis: null };
    // Only reached when an admitted production Redis profile is installed; this fixture has none.
    if (id.endsWith("production-rate-limit.mjs")) return { createProductionRateLimiter() {
      throw new Error("Production Redis rate limiter is not part of this fixture");
    } };
    if (id.endsWith("utils/logger")) return { logger };
    return require(id);
  });
  const router = (file) => load(file, (id) => {
    if (id === "express") return express;
    if (id.endsWith("middleware/rateLimit")) return limits;
    if (id.endsWith(".controller")) return new Proxy({}, { get: () => controller });
    if (id.endsWith("middleware/auth")) return { requireAuth: next };
    if (id === "../../auth") return { requirePendingAwareSessionUser: next };
    if (id.endsWith("auth.status")) return { getSessionStatus: controller.getSessionStatus };
    if (id.endsWith("authz/session-preconditions")) return {
      readSessionPreconditions: () => ({ subject: false, household: false }),
      SessionContextChangedError: class SessionContextChangedError extends Error {},
    };
    if (id.endsWith("householdGuard")) return { householdGuard: next };
    // Role gates are proved by the realdb role tests; here they only pass through.
    if (id.endsWith("authz/requireCapability")) return { requireCapability: () => next };
    throw new Error(`Unexpected router dependency: ${id}`);
  }).default;
  const auth = router("server/modules/auth/auth.routes.ts");
  const notifications = router("server/modules/notifications/notifications.routes.ts");
  const reports = router("server/modules/reports/reports.routes.ts");
  const recap = router("server/modules/weekly-recap/weekly-recap.routes.ts");
  const routes = load("server/routes.ts", (id) => {
    if (id === "node:http") return require(id);
    if (id.endsWith("utils/logger")) return { logger };
    if (id === "./middleware/rateLimit") return limits;
    if (id === "./middleware/apiVersion") return { legacyApiRedirect: next };
    // Plain function: the unlisted-import proxy would return a Router here. No uuid params in this fixture.
    if (id === "./middleware/uuidParams") return { registerUuidParams: () => {} };
    if (id === "./app") return { generateCsrfToken: () => "synthetic" };
    // Plain functions, not routers: the cron door is mounted and its secret check is inert here.
    if (id.endsWith("core/scheduling/schedulerConfig")) return { isCronHttpEnabled: () => true };
    if (id.endsWith("core/scheduling/cronSecret")) return { warnIfCronSecretMissing: () => false };
    if (id === "./modules") return new Proxy({}, { get: (_, name) =>
      name === "authRoutes" ? auth : name === "notificationsRoutes" ? notifications :
        name === "reportsRoutes" ? reports : name === "weeklyRecapRoutes" ? recap : express.Router() });
    return new Proxy({ __esModule: true }, { get: (object, name) =>
      name === "__esModule" ? true : express.Router() });
  });
  const app = express();
  app.use((req, _res, done) => {
    req.session = {}; // The logout route reads the session before its guard; no session store here.
    if (req.get("X-Synthetic-User")) req.user = { id: req.get("X-Synthetic-User") };
    done();
  });
  await routes.registerRoutes(app);
  return { app, limits };
}

// R00.3 sizes (D22 proposals until the owner ratifies them): general 600 per
// user per 60 s window; shared-IP credential tier 10 per minute.
const GENERAL_LIMIT = 600;
const IP_AUTH_LIMIT = 10;
const STRICT_LIMIT = 5;
/** Owner decision 28 Nov 2026: the shared analytics tier is 120 per user per minute. */
const ANALYTICS_LIMIT = 120;
const PAGE_LOAD_BURST = 40;

test("ordinary navigation: login plus five page-load bursts in one window never 429 (R00 / NEW-08)", async () => {
  const { app } = await fixture();
  await request(app).post("/api/auth/login").expect(401);
  let remaining = GENERAL_LIMIT;
  for (let load = 1; load <= 5; load++) {
    const burst = await Promise.all(Array.from({ length: PAGE_LOAD_BURST }, () =>
      request(app).get("/api/notifications").set("X-Synthetic-User", "navigation")));
    for (const response of burst) assert.equal(response.status, 200, `page load ${load}`);
    remaining = Math.min(...burst.map((response) => +response.headers["ratelimit-remaining"]));
  }
  assert.ok(remaining >= 300, `ratelimit-remaining ${remaining} after five page loads`);
});

test("general quota charges one per API request and blocks the request after its limit", async () => {
  const { app } = await fixture();
  for (let index = 1; index <= GENERAL_LIMIT; index++) {
    const response = await request(app).get("/api/notifications").set("X-Synthetic-User", "navigation");
    assert.equal(response.status, 200, `ordinary request ${index}`);
    assert.equal(+response.headers["ratelimit-limit"], GENERAL_LIMIT);
    assert.equal(+response.headers["ratelimit-remaining"], GENERAL_LIMIT - index);
  }
  const exhausted = await request(app).get("/api/notifications").set("X-Synthetic-User", "navigation");
  assert.equal(exhausted.status, 429);
  assert.equal(exhausted.body.error.code, "RATE_LIMITED");
  assert.ok(+exhausted.headers["retry-after"] > 0);
  await request(app).get("/api/notifications").set("X-Synthetic-User", "another-user").expect(200);
});

test("me and logout preserve every shared-IP credential attempt; login trips at the IP limit", async () => {
  const { app } = await fixture();
  for (let index = 0; index < 8; index++) {
    await request(app).get("/api/auth/me").expect(200);
    await request(app).post("/api/auth/logout").expect(200);
  }
  for (let index = 0; index < IP_AUTH_LIMIT; index++) {
    await request(app).post("/api/auth/login").set("X-Synthetic-User", `user-${index}`).expect(401);
  }
  const blocked = await request(app).post("/api/auth/login").set("X-Synthetic-User", "over-limit-user").expect(429);
  assert.equal(blocked.body.error.code, "RATE_LIMITED");
  await request(app).get("/api/auth/me").expect(200);
  await request(app).post("/api/auth/logout").expect(200);
});

test("auth quota is charged once and retains its independent ten-attempt tier", async () => {
  const { app, limits } = await fixture();
  // Pure-IP middleware is measured by the separate shared-IP test. Here inspect
  // its downstream auth counter to detect the old mount+route double charge.
  const response = await request(app).post("/api/auth/login").expect(401);
  assert.equal(+response.headers["ratelimit-limit"], 10);
  assert.equal(+response.headers["ratelimit-remaining"], 9);
  app.post("/synthetic/auth-tier", limits.authLimiter, controller.login);
  for (let index = 0; index < 9; index++) await request(app).post("/synthetic/auth-tier").expect(401);
  await request(app).post("/synthetic/auth-tier").expect(429);
});

test("credential POSTs share IP protection; other methods and unknown paths do not consume it", async () => {
  for (const route of ["register", "login", "mfa/verify", "mfa/resend", "verify-email", "resend-verification", "forgot-password", "reset-password"]) {
    const { app } = await fixture();
    for (let index = 0; index < 6; index++) {
      await request(app).get(`/api/auth/${route}`).expect(404);
      await request(app).post("/api/auth/unknown").expect(404);
    }
    // Password recovery also keeps its strict tier (5/min, no spec number), which trips first there.
    const allowed = route.endsWith("-password") ? STRICT_LIMIT : IP_AUTH_LIMIT;
    for (let index = 0; index < allowed; index++) await request(app).post(`/api/auth/${route}`).expect(route === "login" ? 401 : 200);
    await request(app).post(`/api/auth/${route}`).expect(429);
  }
});

test("reports and recap charge their analytics tier once, retaining expensive limits", async () => {
  for (const url of ["/api/reports/cashflow", "/api/weekly-recap"]) {
    const { app } = await fixture();
    for (let index = 1; index <= ANALYTICS_LIMIT; index++) {
      const response = await request(app).get(url).expect(200);
      assert.equal(+response.headers["ratelimit-limit"], ANALYTICS_LIMIT);
      assert.equal(+response.headers["ratelimit-remaining"], ANALYTICS_LIMIT - index);
    }
    await request(app).get(url).expect(429);
  }
  const { app } = await fixture();
  for (let index = 0; index < 10; index++) await request(app).get("/api/reports/sankey").expect(200);
  await request(app).get("/api/reports/sankey").expect(429);
});

test("all API routers inherit the global general quota; public health keeps its tier", () => {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory() && entry.name !== "__tests__") visit(file);
      else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(file);
    }
  }
  visit(path.join(root, "server/modules"));
  visit(path.join(root, "server/routes"));
  const duplicates = files.filter((file) => !file.endsWith(path.join("health", "health.routes.ts")))
    .filter((file) => /\bgeneralLimiter\b/.test(readFileSync(file, "utf8")));
  assert.deepEqual(duplicates.map((file) => path.relative(root, file)), []);
  const health = readFileSync(path.join(root, "server/modules/health/health.routes.ts"), "utf8");
  assert.match(health, /router\.use\(healthLimiter\)/);
  assert.match(health, /store: new MemoryStore\(\)/);
});
