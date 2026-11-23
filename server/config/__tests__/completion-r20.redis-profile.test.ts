import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const state = vi.hoisted(() => ({
  application: null as any,
  refused: false,
  Redis: vi.fn(function RedisMock() { return { on: vi.fn() }; }),
  query: vi.fn(async () => ({ rows: [{ value: 1 }] })),
}));

vi.mock("../redis/production-slot.mjs", () => ({
  getProductionRedis: () => {
    if (state.refused) throw new Error("REDIS_SLOT_REFUSED");
    return state.application;
  },
}));
vi.mock("ioredis", () => ({ default: state.Redis }));
vi.mock("../../db", () => ({ pool: { query: state.query }, db: { execute: state.query } }));
// Readiness details are for operators only (#224); these tests read them.
const OPERATOR_SECRET = "synthetic-operator-secret";
const OPERATOR = { Authorization: `Bearer ${OPERATOR_SECRET}` };

vi.mock("../../utils/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

function productionApplication() {
  return {
    assertCurrent: vi.fn(),
    cache: {
      assertCurrent: vi.fn(),
      isEnabled: vi.fn(() => true),
      getJson: vi.fn(async (key: string) => {
        if (!key.startsWith("core-cache:")) throw new Error("REDIS_OPERATION_REFUSED");
        return { source: "admitted" };
      }),
      setJson: vi.fn(async (key: string) => {
        if (!key.startsWith("core-cache:")) throw new Error("REDIS_OPERATION_REFUSED");
        return true;
      }),
      deleteKey: vi.fn(async (key: string) => {
        if (!key.startsWith("core-cache:")) throw new Error("REDIS_OPERATION_REFUSED");
        return true;
      }),
      deleteByPrefix: vi.fn(async (key: string) => {
        if (!key.startsWith("core-cache:")) throw new Error("REDIS_OPERATION_REFUSED");
        return 1;
      }),
    },
    analytics: {
      assertCurrent: vi.fn(),
      getJson: vi.fn(async () => null),
      setJson: vi.fn(async () => {}),
      invalidate: vi.fn(async () => 0),
    },
    quota: {
      increment: vi.fn(async () => ({ count: 1, ttlSeconds: 60 })),
      read: vi.fn(async () => ({ count: 1, ttlSeconds: 60 })),
    },
    readiness: { probe: vi.fn(async () => {}) },
    rateLimit: { createStore: vi.fn() },
  };
}

beforeEach(() => {
  state.application = null;
  state.refused = false;
  state.Redis.mockClear();
  state.query.mockClear();
  vi.stubEnv("REDIS_URL", "redis://ordinary.example.invalid:6379");
  vi.stubEnv("CRON_SECRET", OPERATOR_SECRET);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("R20 admitted Redis application binding", () => {
  it("uses the admitted binding without constructing an ordinary client or allowing unsupported keys to fall back", async () => {
    const application = productionApplication();
    state.application = application;

    const redis = await import("../redis");

    expect(redis.redis).toBeNull();
    expect(state.Redis).not.toHaveBeenCalled();
    expect(redis.isRedisEnabled()).toBe(true);
    await expect(redis.redisIncrementWithTtl("ai:ratelimit:household-1", 60)).resolves.toEqual({
      count: 1,
      ttlSeconds: 60,
    });
    expect(application.quota.increment).toHaveBeenCalledWith("ai:ratelimit:household-1", 60);
    await expect(redis.redisGetJson("ai:cache:household-1")).rejects.toThrow("REDIS_OPERATION_REFUSED");
  });

  // OPS-003/OPS-013: scheduled-job locks moved to Postgres advisory locks, so a
  // current profile no longer needs a Redis lock capability. A stale one still fails.
  it("admits required scheduled jobs under a current admitted profile, whose locks live in Postgres", async () => {
    const application = productionApplication();
    state.application = application;
    const redis = await import("../redis");

    expect(() => redis.assertRequiredJobCapabilities()).not.toThrow();
    expect(application.assertCurrent).toHaveBeenCalledOnce();
  });

  it("still refuses required scheduled jobs under a stale admitted profile", async () => {
    const application = productionApplication();
    application.assertCurrent.mockImplementation(() => { throw new Error("REDIS_SLOT_REFUSED"); });
    state.application = application;
    const redis = await import("../redis");

    expect(() => redis.assertRequiredJobCapabilities()).toThrow("REDIS_SLOT_REFUSED");
  });

  it("keeps the ordinary no-profile required-job path available", async () => {
    const redis = await import("../redis");

    expect(() => redis.assertRequiredJobCapabilities()).not.toThrow();
  });

  it("does not create an ordinary Redis client after the installed slot is revoked", async () => {
    state.refused = true;

    await expect(import("../redis")).rejects.toThrow("REDIS_SLOT_REFUSED");
    expect(state.Redis).not.toHaveBeenCalled();
  });

  it("makes the shared cache singleton required and routes it to the admitted cache facade", async () => {
    const application = productionApplication();
    state.application = application;

    const { cacheStore } = await import("../../core/cache/store");
    expect(() => cacheStore.get("dashboard")).toThrow("CACHE_REQUIRED_ASYNC_ONLY");
    await expect(cacheStore.getAsync("dashboard")).resolves.toEqual({ source: "admitted" });
    expect(application.cache.getJson).toHaveBeenCalledWith("core-cache:dashboard");
    cacheStore.destroy();
  });

  it("routes the analytics singleton through the admitted analytics facade", async () => {
    const application = productionApplication();
    state.application = application;
    const { analyticsCache } = await import("../../services/AnalyticsCache");

    await expect(analyticsCache.getOrCompute("dashboard", "household-1", { userId: "user-1" }, async () => ({ total: "1.00" })))
      .resolves.toMatchObject({ total: "1.00" });
    expect(application.analytics.getJson).toHaveBeenCalledOnce();
    expect(application.analytics.setJson).toHaveBeenCalledOnce();
  });

  it("builds all seven limiter tiers with the admitted guarded store", async () => {
    const application = productionApplication();
    application.rateLimit.createStore.mockReturnValue({
      init: vi.fn(), get: vi.fn(), increment: vi.fn(), decrement: vi.fn(), resetKey: vi.fn(),
    });
    state.application = application;
    vi.stubEnv("NODE_ENV", "test");

    await import("../../middleware/rateLimit");

    expect(application.rateLimit.createStore.mock.calls.map((call) => call[0] as string).sort()).toEqual([
      "rl:analytics:", "rl:auth:", "rl:expensive:", "rl:general:", "rl:ipauth:", "rl:strict:", "rl:upload:",
    ]);
    expect(state.Redis).not.toHaveBeenCalled();
  });

  it("reports ready through the admitted readiness probe without a duplicate Redis client", async () => {
    const application = productionApplication();
    state.application = application;
    const { getReady } = await import("../../modules/health/health.controller");
    const app = express().get("/ready", getReady);

    const response = await request(app).get("/ready").set(OPERATOR).expect(200);
    expect(response.body.checks).toMatchObject({
      cache: { status: "healthy" },
      requiredJobs: { status: "healthy" },
    });
    expect(application.readiness.probe).toHaveBeenCalledOnce();
    expect(state.Redis).not.toHaveBeenCalled();
  });

  it("boots production Redis through a current admitted slot without REDIS_URL", async () => {
    const application = productionApplication();
    state.application = application;
    const { validateEnv } = await import("../../utils/validateEnv");

    const result = validateEnv({
      DATABASE_URL: "postgresql://synthetic@db.example.invalid/db",
      SESSION_SECRET: "synthetic-session-secret-not-real-use",
      CLIENT_URL: "https://app.example.invalid",
      APP_URL: "https://app.example.invalid",
      CRON_SECRET: "synthetic-cron-secret-not-real-use",
      NODE_ENV: "production",
    });

    expect(result).toMatchObject({ success: true });
  });

  it("rejects a stale admitted profile even when REDIS_URL is also configured", async () => {
    const application = productionApplication();
    application.assertCurrent.mockImplementation(() => { throw new Error("REDIS_SLOT_REFUSED"); });
    state.application = application;
    const { validateEnv } = await import("../../utils/validateEnv");

    const result = validateEnv({
      DATABASE_URL: "postgresql://synthetic@db.example.invalid/db",
      SESSION_SECRET: "synthetic-session-secret-not-real-use",
      CLIENT_URL: "https://app.example.invalid",
      REDIS_URL: "rediss://redis.example.invalid:6380",
      NODE_ENV: "production",
    });

    expect(result.success).toBe(false);
    expect(result.errors?.some((error) => error.variable === "REDIS_URL")).toBe(true);
  });

  it("reports required jobs healthy for readiness and startup under a current profile", async () => {
    const application = productionApplication();
    state.application = application;
    const { getReady, getStartup, getLive } = await import("../../modules/health/health.controller");
    const app = express()
      .get("/ready", getReady)
      .get("/startup", getStartup)
      .get("/live", getLive);

    const ready = await request(app).get("/ready").set(OPERATOR).expect(200);
    expect(ready.body.checks).toMatchObject({
      database: { status: "healthy" },
      cache: { status: "healthy" },
      requiredJobs: { status: "healthy" },
    });
    const startup = await request(app).get("/startup").set(OPERATOR).expect(200);
    expect(startup.body.checks.requiredJobs.status).toBe("healthy");
    await request(app).get("/live").expect(200).expect({ status: "healthy" });
    expect(application.assertCurrent).toHaveBeenCalled();
    expect(application.readiness.probe).toHaveBeenCalledTimes(2);
  });

  it("reports required jobs unhealthy when the admitted profile goes stale", async () => {
    const application = productionApplication();
    state.application = application;
    const { getReady } = await import("../../modules/health/health.controller");
    application.assertCurrent.mockImplementation(() => { throw new Error("REDIS_SLOT_REFUSED"); });

    const ready = await request(express().get("/ready", getReady)).get("/ready").set(OPERATOR).expect(503);
    expect(ready.body.checks.requiredJobs).toEqual({ status: "unhealthy" });
  });
});
