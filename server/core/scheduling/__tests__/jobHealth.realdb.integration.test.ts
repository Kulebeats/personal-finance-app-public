import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, like, or } from "drizzle-orm";
import { jobs } from "@shared/schema";
import { db } from "../../../db";
import { jobService } from "../../jobs/service";
import { readScheduledJobsHealth } from "../jobHealth";
import {
  recordCataloguedJobs, recordSchedulerStart, SCHEDULED_RUN_PREFIX, SCHEDULER_CATALOGUED_PREFIX, SCHEDULER_START_MARKER,
} from "../jobJournal";
import { runScheduledJob, type ScheduledJobDefinition } from "../scheduledJob";

// OPS-002 against real Postgres: the runner's journal row is what readiness
// reads; a job whose first slot has not come round since the scheduler first
// started is not stale yet (a weekly job must not degrade readiness for the
// six days after a deploy); that start is a database fact, so restarting the
// process never renews the grace; and a scheduler switched off where it
// should run never reads healthy.
const DAY_MS = 24 * 60 * 60 * 1000;
const runTag = randomUUID().slice(0, 8);
const name = (label: string) => `test.health-${label}-${runTag}`;
// Keys far from the registry's 101-111 so a live scheduler can never collide.
const lockKey = (offset: number) => 1_950_000_000 + (Number.parseInt(runTag.slice(0, 4), 16) * 10) + offset;

const daily: ScheduledJobDefinition = { name: name("daily"), cron: "0 1 * * *", lockKey: lockKey(1), run: async () => ({ done: 1 }) };
const weekly: ScheduledJobDefinition = { name: name("weekly"), cron: "0 9 * * 1", lockKey: lockKey(2), run: async () => ({ sent: 0 }) };
const specs = [
  { name: daily.name, intervalMs: DAY_MS },
  { name: weekly.name, intervalMs: 7 * DAY_MS },
];
// A stubbed tick: the runner journals the 01:00 slot of 18 Nov whatever the wall clock says.
const TICK = new Date("2026-11-18T01:00:30.000Z");
const ENABLED = { NODE_ENV: "production", SCHEDULER_ENABLED: "true" };
const DISABLED_IN_PRODUCTION = { NODE_ENV: "production", SCHEDULER_ENABLED: "false" };
const DEV = { NODE_ENV: "development" };
const DEV_ENABLED = { NODE_ENV: "development", SCHEDULER_ENABLED: "true" };

const ownRows = or(
  like(jobs.name, `${SCHEDULED_RUN_PREFIX}test.health-%-${runTag}`), eq(jobs.name, SCHEDULER_START_MARKER),
  like(jobs.name, `${SCHEDULER_CATALOGUED_PREFIX}test.health-%-${runTag}`),
);
const cataloguedRows = (jobName: string) => db.select().from(jobs).where(eq(jobs.name, `${SCHEDULER_CATALOGUED_PREFIX}${jobName}`));

describe("scheduled-job health reads the runner's journal (real Postgres)", () => {
  // The start marker is database-wide; this suite owns it while it runs.
  beforeEach(async () => { await db.delete(jobs).where(ownRows); });
  afterAll(async () => { await db.delete(jobs).where(ownRows); });

  it("sees the success the runner journaled, and does not call a weekly job stale before its first slot", async () => {
    const outcome = await runScheduledJob(daily, undefined, TICK);
    expect(outcome).toEqual({ status: "completed", summary: { done: 1 } });
    const [row] = await db.select().from(jobs).where(eq(jobs.name, `${SCHEDULED_RUN_PREFIX}${daily.name}`));
    expect(row).toMatchObject({ status: "completed", idempotencyKey: `${daily.name}@2026-11-18T01:00:00.000Z` });
    expect(row.runAt.toISOString()).toBe("2026-11-18T01:00:00.000Z");

    // A day later: the daily job is fresh; the weekly one has had no slot that
    // could have produced a success yet, so readiness stays healthy.
    const health = await readScheduledJobsHealth({ specs, env: ENABLED, now: new Date(Date.now() + DAY_MS) });

    expect(health.jobs).toEqual([
      { jobName: daily.name, lastSuccessAt: row.completedAt?.toISOString(), stale: false },
      { jobName: weekly.name, lastSuccessAt: null, stale: false },
    ]);
    expect(health.status).toBe("healthy");
  });

  it("calls a never-succeeded job stale once two of its intervals have passed since the journal began", async () => {
    await runScheduledJob(daily, undefined, TICK);

    const health = await readScheduledJobsHealth({ specs, env: ENABLED, now: new Date(Date.now() + 15 * DAY_MS) });

    expect(health.jobs.find((job) => job.jobName === weekly.name)).toEqual({ jobName: weekly.name, lastSuccessAt: null, stale: true });
    expect(health.jobs.find((job) => job.jobName === daily.name)?.stale).toBe(true);
    expect(health.status).toBe("stale");
  });

  it("measures an empty journal from the scheduler's first recorded start, which a later process start does not renew", async () => {
    const firstStart = new Date(Date.now() - 3 * DAY_MS);
    const secondStart = new Date(Date.now() - 60_000);
    await recordSchedulerStart(firstStart);
    await recordSchedulerStart(secondStart);
    const starts = await db.select().from(jobs).where(eq(jobs.name, SCHEDULER_START_MARKER));
    expect(starts.map((row) => row.startedAt?.toISOString())).toEqual([firstStart.toISOString()]);

    // The second process started a minute ago and no job has ever run. Three
    // days after the first start the daily job is stale, the weekly one not yet.
    const health = await readScheduledJobsHealth({ specs, env: ENABLED, processStartedAt: secondStart });

    expect(health.jobs).toEqual([
      { jobName: daily.name, lastSuccessAt: null, stale: true },
      { jobName: weekly.name, lastSuccessAt: null, stale: false },
    ]);
    expect(health.status).toBe("stale");
  });

  it("keeps the start marker through a jobs-table prune, so pruning cannot renew the grace", async () => {
    const longAgo = new Date(Date.now() - 30 * DAY_MS);
    await recordSchedulerStart(longAgo);
    const probe = `${SCHEDULED_RUN_PREFIX}${name("prune-probe")}`;
    await db.insert(jobs).values({ name: probe, status: "completed", attempts: 1, maxAttempts: 1,
      runAt: longAgo, startedAt: longAgo, completedAt: longAgo });

    await jobService.cleanup(7);

    expect(await db.select().from(jobs).where(eq(jobs.name, probe))).toEqual([]);
    const [marker] = await db.select().from(jobs).where(eq(jobs.name, SCHEDULER_START_MARKER));
    expect(marker?.startedAt?.toISOString()).toBe(longAgo.toISOString());
  });

  it("measures a job added after the first start from when the scheduler first catalogued it", async () => {
    await recordSchedulerStart(new Date(Date.now() - 30 * DAY_MS));
    // With no catalogue record, a job that never ran is measured from that first start: stale.
    expect((await readScheduledJobsHealth({ specs, env: ENABLED })).jobs[0]).toMatchObject({ stale: true });

    const deployedAt = new Date(Date.now() - 60 * 60 * 1000);
    await recordCataloguedJobs([daily.name], deployedAt);
    // A restart does not renew it.
    await recordCataloguedJobs([daily.name], new Date());

    const rows = await cataloguedRows(daily.name);
    expect(rows.map((row) => row.startedAt?.toISOString())).toEqual([deployedAt.toISOString()]);
    expect((await readScheduledJobsHealth({ specs, env: ENABLED })).jobs[0])
      .toEqual({ jobName: daily.name, lastSuccessAt: null, stale: false });
    // Two intervals after it was catalogued, a job that never succeeded is stale.
    const later = new Date(deployedAt.getTime() + 2 * DAY_MS + 60_000);
    expect((await readScheduledJobsHealth({ specs, env: ENABLED, now: later })).jobs[0]).toMatchObject({ stale: true });
  });

  it("keeps catalogue records through a jobs-table prune, and records one per catalogued job on start", async () => {
    const longAgo = new Date(Date.now() - 30 * DAY_MS);
    await recordCataloguedJobs([weekly.name], longAgo);

    await jobService.cleanup(7);

    expect((await cataloguedRows(weekly.name)).map((row) => row.startedAt?.toISOString())).toEqual([longAgo.toISOString()]);
    await recordSchedulerStart();
    expect(await cataloguedRows("security.mfa-reminders")).toHaveLength(1);
  });

  it("does not restart the health grace when a never-successful job is catalogued after its first run", async () => {
    const now = new Date();
    const oldAttempt = new Date(now.getTime() - 3 * DAY_MS);
    const recentAttempt = new Date(now.getTime() - 60_000);
    await recordSchedulerStart(oldAttempt);
    await db.insert(jobs).values([oldAttempt, recentAttempt].map(startedAt => ({
      name: `${SCHEDULED_RUN_PREFIX}${daily.name}`, status: "failed" as const, lastError: "JOB_FAILED",
      runAt: startedAt, startedAt, completedAt: startedAt,
    })));
    await recordCataloguedJobs([daily.name], recentAttempt);

    const health = await readScheduledJobsHealth({ specs, env: ENABLED, now });
    expect(health.jobs[0]).toEqual({ jobName: daily.name, lastSuccessAt: null, stale: true });

    await jobService.cleanup(1);
    const attempts = await db.select({ startedAt: jobs.startedAt }).from(jobs)
      .where(eq(jobs.name, `${SCHEDULED_RUN_PREFIX}${daily.name}`));
    expect(attempts).toEqual([{ startedAt: recentAttempt }]);
    const afterPrune = await readScheduledJobsHealth({ specs, env: ENABLED, now });
    expect(afterPrune.jobs[0]).toEqual({ jobName: daily.name, lastSuccessAt: null, stale: true });
  });

  it("does not give a pre-catalogue job with no attempt rows a new grace period on upgrade", async () => {
    const jobName = "security.daily-report";
    const now = new Date();
    const beforeUpgrade = new Date(now.getTime() - 3 * DAY_MS);
    const newMarker = new Date(now.getTime() - 60_000);
    const health = await readScheduledJobsHealth({
      specs: [{ name: jobName, intervalMs: DAY_MS }], env: ENABLED, now,
      readEpoch: async () => beforeUpgrade,
      readStatus: async () => [],
      readCatalogued: async () => new Map([[jobName, newMarker]]),
    });

    expect(health.jobs).toEqual([{ jobName, lastSuccessAt: null, stale: true }]);
  });

  it("keeps a dated success visible when another legacy completion has no timestamp", async () => {
    const now = new Date();
    const completion = new Date(now.getTime() - 60_000);
    const name = `${SCHEDULED_RUN_PREFIX}${daily.name}`;
    await db.insert(jobs).values([
      { name, status: "completed", startedAt: completion, completedAt: completion },
      { name, status: "completed", startedAt: now, completedAt: null },
    ]);

    const health = await readScheduledJobsHealth({ specs, env: ENABLED, now });
    expect(health.jobs[0]).toEqual({ jobName: daily.name, lastSuccessAt: completion.toISOString(), stale: false });
  });

  it("falls back to process start only in a non-production process that runs the scheduler", async () => {
    const devRunning = await readScheduledJobsHealth({ specs, env: DEV_ENABLED, processStartedAt: new Date() });
    expect(devRunning.jobs.every((job) => !job.stale)).toBe(true);

    const devOff = await readScheduledJobsHealth({ specs, env: DEV, processStartedAt: new Date() });
    expect(devOff.schedulerEnabled).toBe(false);
    expect(devOff.jobs.every((job) => job.stale)).toBe(true);
  });

  it("in production, a refused start-marker write leaves no grace and is reported, until a write succeeds", async () => {
    const refused = Object.assign(new Error("permission denied for table jobs"), { code: "42501" });
    const insert = vi.spyOn(db, "insert").mockImplementationOnce(() => { throw refused; });
    await expect(recordSchedulerStart()).rejects.toBe(refused);
    insert.mockRestore();

    // Jobs are readable, nothing is persisted, and the process started a minute ago.
    const health = await readScheduledJobsHealth({ specs, env: ENABLED, processStartedAt: new Date(Date.now() - 60_000) });

    expect(health.jobs.every((job) => job.stale && job.lastSuccessAt === null)).toBe(true);
    expect(health).toMatchObject({ status: "stale", reasons: ["SCHEDULER_START_UNRECORDED"] });

    await recordSchedulerStart();
    expect((await readScheduledJobsHealth({ specs, env: ENABLED })).reasons).toEqual([]);
  });

  it("is not healthy when production has the scheduler switched off, even with every job fresh", async () => {
    await runScheduledJob(weekly, undefined, TICK);
    await runScheduledJob(daily, undefined, TICK);
    expect((await readScheduledJobsHealth({ specs, env: ENABLED })).status).toBe("healthy");

    const disabled = await readScheduledJobsHealth({ specs, env: DISABLED_IN_PRODUCTION });

    expect(disabled.jobs.every((job) => !job.stale)).toBe(true);
    expect(disabled).toMatchObject({ status: "stale", schedulerEnabled: false, reasons: ["SCHEDULER_SWITCHED_OFF"] });
  });
});
