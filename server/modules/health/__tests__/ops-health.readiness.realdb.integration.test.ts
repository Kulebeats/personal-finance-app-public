import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { jobs } from "@shared/schema";
import { db, pool } from "../../../db";
import { createHealthController } from "../health.controller";

/**
 * OPS-002: readiness reports the app revision and, for every required scheduled
 * job, its last success and whether it is stale (older than twice its interval).
 * A stale job degrades readiness but keeps HTTP 200, so the platform health
 * check never kills a deploy over a job that is merely overdue. The database
 * probe and the journal read are real; only the cache probe is fixed, because
 * whether this runner has Redis is not what these tests are about.
 */
const HOUR_MS = 3_600_000;
const DAILY_JOBS = [
  "market.fx-refresh", "recurring.materialize", "investments.tbill-maturity", "investments.recurring-purchase",
  "budget.rollover", "cleanup.notifications", "cleanup.merchant-logos", "cleanup.personal-exports", "snapshots.daily",
  "security.daily-report",
  // A-21
  "market.stale-price-alerts", "recurring.remind", "goals.deadlines", "budget.alerts",
  // AH-11
  "security.mfa-reminders",
  // OPS-007: runs daily; each user is sent on their own day.
  "recap.weekly",
] as const;
const WEEKLY_JOB = "goals.weekly-report";
const WEEKLY_JOBS = [WEEKLY_JOB] as const;
const ALL_JOBS = [...DAILY_JOBS, ...WEEKLY_JOBS];
const HELD_MARKET_JOBS = ["market.price-refresh", "market.price-alerts"] as const;
const journalNames = [...ALL_JOBS, ...HELD_MARKET_JOBS].map((name) => `scheduled:${name}`);
const REVISION = "0123456789abcdef0123456789abcdef01234567";
// The revision and job times are operator details (CRON_SECRET as a Bearer token).
const OPERATOR_SECRET = "synthetic-operator-secret";
const OPERATOR = { Authorization: `Bearer ${OPERATOR_SECRET}` };

async function journal(jobName: string, hoursAgo: number, status: "completed" | "failed" = "completed") {
  const at = new Date(Date.now() - hoursAgo * HOUR_MS);
  await db.insert(jobs).values({
    name: `scheduled:${jobName}`, status, attempts: 1, maxAttempts: 1, runAt: at, startedAt: at,
    completedAt: at, ...(status === "failed" ? { lastError: "PARTIAL_FAILURE" } : {}),
  });
}

async function freshJournal(except: readonly string[] = []) {
  for (const name of DAILY_JOBS) if (!except.includes(name)) await journal(name, 2);
  for (const name of WEEKLY_JOBS) if (!except.includes(name)) await journal(name, 6 * 24);
}

function readiness() {
  const controller = createHealthController({
    database: async () => { await pool.query("SELECT 1"); },
    cache: async () => "not_configured",
  });
  return request(express().get("/ready", controller.getReady)).get("/ready").set(OPERATOR);
}

type JobReport = { jobName: string; lastSuccessAt: string | null; stale: boolean };
const jobReport = (body: { scheduledJobs?: { jobs?: JobReport[] } }, name: string) =>
  body.scheduledJobs?.jobs?.find((job) => job.jobName === name);

describe("readiness reports revision and scheduled-job freshness (OPS-002)", () => {
  beforeEach(async () => {
    await db.delete(jobs).where(inArray(jobs.name, journalNames));
    vi.stubEnv("RENDER_GIT_COMMIT", REVISION);
    vi.stubEnv("CRON_SECRET", OPERATOR_SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => { await db.delete(jobs).where(inArray(jobs.name, journalNames)); });

  it("reports fresh installed jobs and ignores stale history for held market jobs", async () => {
    await freshJournal();
    for (const name of HELD_MARKET_JOBS) await journal(name, 72);

    const response = await readiness().expect(200);

    expect(response.body).toMatchObject({ status: "healthy", revision: REVISION, checks: { database: { status: "healthy" } } });
    expect(response.body.scheduledJobs.status).toBe("healthy");
    expect(response.body.scheduledJobs.jobs.map((job: JobReport) => job.jobName).sort()).toEqual([...ALL_JOBS].sort());
    for (const job of response.body.scheduledJobs.jobs as JobReport[]) {
      expect(job.stale).toBe(false);
      expect(Date.parse(job.lastSuccessAt ?? "")).not.toBeNaN();
    }
  });

  it("flags a job whose last success is older than twice its interval, degrading readiness without failing it", async () => {
    await freshJournal(["market.fx-refresh"]);
    await journal("market.fx-refresh", 50);
    // A later failed run is not a success: the job stays stale.
    await journal("market.fx-refresh", 1, "failed");

    const response = await readiness().expect(200);

    expect(response.body.status).toBe("degraded");
    expect(response.body.scheduledJobs.status).toBe("stale");
    const fx = jobReport(response.body, "market.fx-refresh");
    expect(fx?.stale).toBe(true);
    expect(Date.now() - Date.parse(fx?.lastSuccessAt ?? "")).toBeGreaterThan(49 * HOUR_MS);
    expect(jobReport(response.body, "recurring.materialize")?.stale).toBe(false);
  });

  it("judges each job against its own interval", async () => {
    // Six days is fresh for the weekly goals report and stale for a daily job.
    await freshJournal(["snapshots.daily"]);
    await journal("snapshots.daily", 6 * 24);

    const response = await readiness().expect(200);

    expect(jobReport(response.body, WEEKLY_JOB)?.stale).toBe(false);
    expect(jobReport(response.body, "snapshots.daily")?.stale).toBe(true);
    expect(response.body.status).toBe("degraded");
  });

  it("flags a job that has never succeeded", async () => {
    await freshJournal(["budget.rollover"]);

    const response = await readiness().expect(200);

    expect(jobReport(response.body, "budget.rollover")).toMatchObject({ stale: true, lastSuccessAt: null });
    expect(response.body.status).toBe("degraded");
  });

  it("reports no revision when the platform supplies none or a malformed one", async () => {
    await freshJournal();
    vi.stubEnv("RENDER_GIT_COMMIT", "not-a-sha; DROP");

    const response = await readiness().expect(200);

    expect(response.body.revision).toBeNull();
  });

  it("still fails readiness when the database is unreachable", async () => {
    const controller = createHealthController({
      database: async () => { throw new Error("synthetic outage"); },
      cache: async () => "not_configured",
    });
    const response = await request(express().get("/ready", controller.getReady)).get("/ready").set(OPERATOR).expect(503);
    expect(response.body.status).toBe("unhealthy");
  });
});
