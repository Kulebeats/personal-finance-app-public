import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../../db", () => ({ pool: { query: vi.fn() }, db: { execute: vi.fn() } }));
vi.mock("../../../config/redis", () => ({ redis: null, productionRedis: null, assertRequiredJobCapabilities: vi.fn() }));
vi.mock("../../../utils/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
import { createHealthController } from "../health.controller";
import type { ScheduledJobsHealth } from "../../../core/scheduling/jobHealth";

/**
 * Follow-up to OPS-002 (#198): the public readiness answer is the status only.
 * The deployed revision and each job's last-run times are operator details,
 * shown only to a caller holding CRON_SECRET as a Bearer token. A wrong or
 * missing secret still gets the probe's status code, never a 401, so platform
 * health checks keep working.
 */
const SECRET = "synthetic-cron-secret-for-redaction-tests";
const REVISION = "0123456789abcdef0123456789abcdef01234567";
const STALE_JOBS: ScheduledJobsHealth = {
  status: "stale", schedulerEnabled: true,
  jobs: [{ jobName: "market.fx-refresh", lastSuccessAt: "2026-11-15T02:00:00.000Z", stale: true }],
};

function fixture(database: () => Promise<void> = async () => {}) {
  const controller = createHealthController({
    database, cache: async () => "not_configured", requiredJobs: async () => {},
    scheduledJobs: async () => STALE_JOBS,
  });
  return express().get("/ready", controller.getReady).get("/startup", controller.getStartup);
}
const bearer = (value: string) => ({ Authorization: `Bearer ${value}` });

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("RENDER_GIT_COMMIT", REVISION);
});
afterEach(() => vi.unstubAllEnvs());

describe("public readiness shows the status only", () => {
  it("answers an unauthenticated probe with its status and nothing else", async () => {
    const response = await request(fixture()).get("/ready").expect(200);

    expect(response.body).toEqual({ status: "degraded" });
    expect(JSON.stringify(response.body)).not.toMatch(new RegExp(`${REVISION}|fx-refresh|2026-11-15`));
  });

  it("gives the full report to a caller presenting CRON_SECRET as a Bearer token", async () => {
    const response = await request(fixture()).get("/ready").set(bearer(SECRET)).expect(200);

    expect(response.body).toMatchObject({ status: "degraded", revision: REVISION, scheduledJobs: STALE_JOBS });
    expect(response.body.checks.database).toEqual({ status: "healthy" });
  });

  it.each([
    ["a wrong secret", bearer("not-the-secret")],
    ["the secret without the Bearer scheme", { Authorization: SECRET }],
    ["the cron door's header instead of Authorization", { "x-cron-secret": SECRET }],
  ])("redacts for %s without refusing the probe", async (_name, headers) => {
    const response = await request(fixture()).get("/ready").set(headers).expect(200);

    expect(response.body).toEqual({ status: "degraded" });
  });

  it("shows nobody the details when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const response = await request(fixture()).get("/ready").set(bearer("")).expect(200);

    expect(response.body).toEqual({ status: "degraded" });
  });

  it("keeps the 503 for a failed dependency while redacting its body", async () => {
    const response = await request(fixture(async () => { throw new Error("synthetic outage"); })).get("/ready").expect(503);

    expect(response.body).toEqual({ status: "unhealthy" });
  });

  it("redacts the draining answer too, keeping its 503", async () => {
    const app = fixture();
    app.locals.isShuttingDown = true;

    const response = await request(app).get("/ready").expect(503);

    expect(response.body).toEqual({ status: "unhealthy" });
  });

  it("redacts the startup probe exactly like readiness", async () => {
    const response = await request(fixture()).get("/startup").expect(200);

    expect(response.body).toEqual({ status: "degraded" });
    expect(response.body).not.toHaveProperty("revision");
    expect(response.body).not.toHaveProperty("checks");
    expect(response.body).not.toHaveProperty("scheduledJobs");
  });

  it("gives the operator the full startup report", async () => {
    const response = await request(fixture()).get("/startup").set(bearer(SECRET)).expect(200);

    expect(response.body).toMatchObject({ status: "degraded", revision: REVISION, scheduledJobs: STALE_JOBS });
  });
});
