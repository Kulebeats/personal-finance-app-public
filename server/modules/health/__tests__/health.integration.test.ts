/** Owned HTTP fixtures: real Express handlers, injected dependencies, no database. */
import request from "supertest";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import express from "express";
import { performance } from "node:perf_hooks";

vi.mock("../../../db", () => ({ pool: { query: vi.fn() } }));
vi.mock("../../../config/redis", () => ({ redis: null, productionRedis: null, assertRequiredJobCapabilities: vi.fn() }));
import { createHealthController } from "../health.controller";

// Detail assertions read /health/ready as the operator; the public body is the status only.
const OPERATOR_SECRET = "synthetic-operator-secret";
const OPERATOR = { Authorization: `Bearer ${OPERATOR_SECRET}` };
beforeEach(() => { vi.stubEnv("CRON_SECRET", OPERATOR_SECRET); });
afterEach(() => { vi.unstubAllEnvs(); });

function fixture() {
  const database = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const cache = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const scheduledJobs = async () => ({ status: "healthy" as const, schedulerEnabled: false, jobs: [] });
  const controller = createHealthController({ database, cache, scheduledJobs });
  const app = express();
  app.get("/health/live", controller.getLive);
  app.get("/health/ready", controller.getReady);
  app.get("/health/startup", controller.getStartup);
  return { app, database, cache };
}

describe("Health HTTP dependency contract", () => {
  it("returns only public status for liveness without probing dependencies", async () => {
    const { app, database, cache } = fixture();
    await request(app).get("/health/live").expect(200, { status: "healthy" });
    expect(database).not.toHaveBeenCalled();
    expect(cache).not.toHaveBeenCalled();
  });

  it("readiness and startup perform dependency and required-job probes", async () => {
    const { app, database, cache } = fixture();
    for (const endpoint of ["ready", "startup"]) {
      await request(app).get(`/health/${endpoint}`).set(OPERATOR).expect(200, {
        status: "healthy", revision: null, checks: {
          database: { status: "healthy" },
          cache: { status: "healthy" },
          requiredJobs: { status: "healthy" },
        },
        scheduledJobs: { status: "healthy", schedulerEnabled: false, jobs: [] },
      });
    }
    expect(database).toHaveBeenCalledTimes(2);
    expect(cache).toHaveBeenCalledTimes(2);
  });

  it.each(["database", "cache"] as const)("%s failure makes readiness unavailable without error text", async (dependency) => {
    const state = fixture();
    state[dependency].mockRejectedValue(new Error("private target and financial payload"));
    const response = await request(state.app).get("/health/ready").set(OPERATOR).expect(503);
    expect(response.body.checks[dependency]).toEqual({ status: "unhealthy" });
    expect(response.text).not.toMatch(/private|payload|target|latency|uptime|version|error/);
    await request(state.app).get("/health/live").expect(200);
  });

  it("does not probe dependencies while draining and cannot report startup ready", async () => {
    const { app, database, cache } = fixture();
    app.locals.isShuttingDown = true;
    for (const endpoint of ["ready", "startup"]) {
      await request(app).get(`/health/${endpoint}`).set(OPERATOR).expect(503, {
        status: "unhealthy", checks: { shutdown: { status: "unhealthy" } },
      });
    }
    expect(database).not.toHaveBeenCalled();
    expect(cache).not.toHaveBeenCalled();
  });

  it("rechecks shutdown after a dependency was pending", async () => {
    const { app, database } = fixture();
    database.mockImplementation(async () => { app.locals.isShuttingDown = true; });
    const response = await request(app).get("/health/ready").set(OPERATOR).expect(503);
    expect(response.body.checks.shutdown).toEqual({ status: "unhealthy" });
  });

  it("hanging dependencies return503 within2seconds and concurrent requests share work", async () => {
    const { app, database, cache } = fixture();
    database.mockImplementation(() => new Promise(() => {}));
    cache.mockImplementation(() => new Promise(() => {}));
    const started = performance.now();
    const responses = await Promise.all([
      request(app).get("/health/ready"), request(app).get("/health/ready"),
    ]);
    expect(performance.now() - started).toBeLessThan(2000);
    for (const response of responses) expect(response.status).toBe(503);
    expect(database).toHaveBeenCalledOnce();
    expect(cache).toHaveBeenCalledOnce();
    await request(app).get("/health/ready").expect(503);
    expect(database).toHaveBeenCalledOnce();
  });

  it("recovers after a failed dependency returns", async () => {
    const { app, cache } = fixture();
    cache.mockRejectedValueOnce(new Error("unavailable"));
    await request(app).get("/health/ready").expect(503);
    await request(app).get("/health/ready").expect(200);
  });
});
