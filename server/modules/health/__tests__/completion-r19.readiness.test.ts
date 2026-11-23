import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const state = vi.hoisted(() => ({
  query: vi.fn(), execute: vi.fn(), getStats: vi.fn(),
  redis: null as null | { duplicate: ReturnType<typeof vi.fn> },
}));
vi.mock("../../../db", () => ({ pool: { query: state.query }, db: { execute: state.execute } }));
vi.mock("../../../core/cache/store", () => ({ cacheStore: { getStats: state.getStats } }));
vi.mock("../../../config/redis", () => ({ get redis() { return state.redis; }, productionRedis: null, assertRequiredJobCapabilities: vi.fn() }));
vi.mock("../../../utils/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
// Job freshness has its own real-DB test (ops-health.readiness); here it is fresh.
const freshJobs = vi.hoisted(() => ({ status: "healthy", schedulerEnabled: false, jobs: [] }));
vi.mock("../../../core/scheduling/jobHealth", () => ({ readScheduledJobsHealth: async () => freshJobs }));
import { getReady, getLive } from "../health.controller";

// Detail assertions read /ready as the operator; the public body is the status only.
const OPERATOR_SECRET = "synthetic-operator-secret";
const OPERATOR = { Authorization: `Bearer ${OPERATOR_SECRET}` };

function app() {
  const fixture = express();
  fixture.get("/ready", getReady);
  fixture.get("/live", getLive);
  return fixture;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CRON_SECRET", OPERATOR_SECRET);
  state.redis = null;
  state.query.mockResolvedValue({ rows: [{ value: 1 }] });
  state.execute.mockResolvedValue({ rows: [{ value: 1 }] });
  state.getStats.mockReturnValue({ hits: 0 });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("R19 production dependency/public boundary", () => {
  it("does not report ready from local cache statistics when required Redis is absent", async () => {
    const response = await request(app()).get("/ready").set(OPERATOR);
    expect(response.status).toBe(503);
    expect(response.body.checks.cache.status).toBe("unhealthy");
  });
  it("never publishes driver error, target or raw payload text", async () => {
    const failure = new Error("postgres://secret@private.invalid:5432/finance_app amount=777.77");
    state.execute.mockRejectedValue(failure);
    state.query.mockRejectedValue(failure);
    const response = await request(app()).get("/ready").set(OPERATOR);
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toMatch(/secret|private|finance_app|777/);
  });
  it("liveness does not require any dependency", async () => {
    await request(app()).get("/live").expect(200);
    expect(state.query).not.toHaveBeenCalled();
  });
  it("uses an actual expiring Redis write/read-back and releases the probe client", async () => {
    const client = { on: vi.fn(), connect: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue("OK"), get: vi.fn(), del: vi.fn().mockResolvedValue(1), disconnect: vi.fn() };
    client.get.mockImplementation(async () => client.set.mock.calls[0][1]);
    state.redis = { duplicate: vi.fn().mockReturnValue(client) };
    const response = await request(app()).get("/ready").set(OPERATOR).expect(200);
    expect(response.body).toEqual({ status: "healthy", revision: null, checks: {
      database: { status: "healthy" }, cache: { status: "healthy" }, requiredJobs: { status: "healthy" },
    }, scheduledJobs: freshJobs });
    expect(state.query).toHaveBeenCalledWith({ text: "SELECT 1", query_timeout: 1000 });
    expect(client.set).toHaveBeenCalledWith(expect.stringMatching(/^health:readiness:/), expect.any(String), "PX", 5000);
    expect(client.get).toHaveBeenCalledWith(client.set.mock.calls[0][0]);
    expect(client.disconnect).toHaveBeenCalledOnce();
  });
  it("rejects a Redis read-back mismatch and still releases its client", async () => {
    const client = { on: vi.fn(), connect: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue("OK"), get: vi.fn().mockResolvedValue(null), del: vi.fn(), disconnect: vi.fn() };
    state.redis = { duplicate: vi.fn().mockReturnValue(client) };
    await request(app()).get("/ready").set(OPERATOR).expect(503);
    expect(client.disconnect).toHaveBeenCalledOnce();
  });
  it("labels optional unconfigured development Redis truthfully", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = await request(app()).get("/ready").set(OPERATOR).expect(200);
    expect(response.body.checks.cache.status).toBe("not_configured");
  });
});
