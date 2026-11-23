import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { eq, like } from "drizzle-orm";
import { jobs, outboxEvents, users } from "@shared/schema";
import { db, pool } from "../../../db";
import * as mail from "../../../services/emailService";
import { outboxEventService } from "../../events/outbox";
import { DEFAULT_LOCK_TIMING, withJobAdvisoryLock, type JobLockTiming } from "../advisoryLock";
import { listScheduledJobStatus, SCHEDULED_RUN_PREFIX, SCHEDULER_START_MARKER } from "../jobJournal";
import { defaultJobRunDependencies, LOCK_LOST, runScheduledJob, type JobRunDependencies, type ScheduledJobDefinition } from "../scheduledJob";
import { initScheduler, stopScheduler } from "../../../scheduler";

// OPS-003 / OPS-013 / NEW-38 against real Postgres: one runner per job across
// connections, a journal health can read, and a started processor that delivers.
vi.mock("../../../services/emailService", async (original) => ({
  ...await original<typeof import("../../../services/emailService")>(),
  isEmailServiceConfigured: vi.fn(() => true),
  sendEmail: vi.fn(async () => true),
}));

const runTag = randomUUID().slice(0, 8);
const jobName = (label: string) => `test.${label}-${runTag}`;
// Keys far from the registry's 101-109 so a live scheduler can never collide.
const lockKey = (offset: number) => 1_900_000_000 + (Number.parseInt(runTag.slice(0, 4), 16) * 10) + offset;
const userIds: string[] = [];
const eventIds: string[] = [];

function deferred() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { gate, release };
}

const period = (offset: number) => ({ lockKey: lockKey(offset), periodIdentity: `test.lock-${runTag}@2026-11-17T01:00:00.000Z` });

function withTiming(timing: Partial<JobLockTiming>): JobRunDependencies {
  return { ...defaultJobRunDependencies,
    withLock: (request, work) => withJobAdvisoryLock(request, work, pool, { ...DEFAULT_LOCK_TIMING, ...timing }) };
}

async function heldBy(offset: number): Promise<number[]> {
  const held = await pool.query<{ pid: number }>(
    "SELECT pid FROM pg_locks WHERE locktype='advisory' AND granted AND objsubid=2 AND objid=$1", [lockKey(offset)]);
  return held.rows.map((row) => row.pid);
}

function definition(label: string, offset: number, run: ScheduledJobDefinition["run"]): ScheduledJobDefinition {
  return { name: jobName(label), cron: "0 1 * * *", lockKey: lockKey(offset), run };
}

async function journal(label: string) {
  return db.select().from(jobs).where(eq(jobs.name, `${SCHEDULED_RUN_PREFIX}${jobName(label)}`)).orderBy(jobs.createdAt);
}

async function queueSecurityNotice() {
  const id = randomUUID();
  const recipient = `scheduler-notice-${id}@example.invalid`;
  await db.insert(users).values({ id, email: recipient, username: `scheduler-notice-${id}`,
    passwordHash: "!synthetic-not-a-login!", emailVerified: true, timezone: "Africa/Lusaka" });
  userIds.push(id);
  await pool.query(`INSERT INTO user_notification_preferences (user_id,notification_type,in_app_enabled,email_enabled)
    VALUES ($1,'password_changed',true,true)`, [id]);
  const [event] = await db.insert(outboxEvents).values({
    eventType: "security.notice.requested", aggregateType: "security_audit", aggregateId: randomUUID(),
    payload: { version: 1, userId: id, kind: "password_changed", channel: "email", recipient, occurredAt: new Date().toISOString() },
  }).returning();
  eventIds.push(event.id);
  return { eventId: event.id, recipient };
}

describe("scheduler against real Postgres", () => {
  afterEach(async () => {
    await stopScheduler();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await db.delete(jobs).where(like(jobs.name, `${SCHEDULED_RUN_PREFIX}test.%-${runTag}`));
    for (const id of eventIds) await db.delete(outboxEvents).where(eq(outboxEvents.id, id));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
  });

  it("lets only one connection hold a job's advisory lock; a second runner skips until it is released", async () => {
    const { gate, release } = deferred();
    const holder = withJobAdvisoryLock(period(1), async () => { await gate; return "first"; });
    await vi.waitFor(async () => expect(await heldBy(1)).toHaveLength(1));

    const contender = vi.fn(async () => "second");
    expect(await withJobAdvisoryLock(period(1), contender)).toEqual({ acquired: false, reason: "PERIOD_HELD" });
    expect(contender).not.toHaveBeenCalled();

    release();
    expect(await holder).toEqual({ acquired: true, result: "first" });
    expect(await withJobAdvisoryLock(period(1), contender)).toEqual({ acquired: true, result: "second" });
  });

  it("runs an overlapping job once and journals that one run", async () => {
    const { gate, release } = deferred();
    const run = vi.fn(async () => { await gate; return { processed: 2 }; });
    const job = definition("overlap", 2, run);

    const first = runScheduledJob(job);
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    const second = await runScheduledJob(job);
    release();

    expect(second).toEqual({ status: "skipped", reason: "PERIOD_HELD" });
    expect(await first).toEqual({ status: "completed", summary: { processed: 2 } });
    expect(await journal("overlap")).toEqual([expect.objectContaining({
      status: "completed", lastError: null, result: { processed: 2 }, attempts: 1,
    })]);
  });

  it("records a failure with its bounded code while health still reads the last success", async () => {
    const outcomes = [async () => ({ processed: 1 }), async () => {
      throw Object.assign(new Error("PRIVATE_SENTINEL constraint detail"), { code: "23514" });
    }];
    for (const [index, run] of outcomes.entries()) {
      // One run per daily period: the second is the next day's, not a retry of the first.
      const now = new Date(Date.UTC(2026, 10, 17 + index, 1, 0, 0));
      expect((await runScheduledJob(definition("health", 3, run), undefined, now)).status).toBe(index === 0 ? "completed" : "failed");
    }

    const rows = await journal("health");
    expect(rows.map((row) => [row.status, row.lastError])).toEqual([["completed", null], ["failed", "PG_23514"]]);
    expect(JSON.stringify(rows)).not.toContain("PRIVATE_SENTINEL");
    const [status] = await listScheduledJobStatus([jobName("health")]);
    expect(status).toMatchObject({ jobName: jobName("health"), lastStatus: "failed", lastErrorCode: "PG_23514",
      lastSuccessAt: rows[0].completedAt!.toISOString() });
    expect(await listScheduledJobStatus([jobName("never-ran")])).toEqual([{ jobName: jobName("never-ran"),
      lastStartedAt: null, lastStatus: null, lastErrorCode: null, lastSuccessAt: null }]);
  });

  it("journals each run under its scheduled slot and skips a delayed tick for a period that already completed", async () => {
    const run = vi.fn(async () => ({ processed: 1 }));
    const job = definition("period", 4, run);

    expect((await runScheduledJob(job, undefined, new Date("2026-11-17T01:00:00.200Z"))).status).toBe("completed");
    // A second instance whose tick was delayed past the first instance's completion.
    expect(await runScheduledJob(job, undefined, new Date("2026-11-17T01:12:00.000Z"))).toEqual({ status: "skipped", reason: "PERIOD_DONE" });
    expect((await runScheduledJob(job, undefined, new Date("2026-11-18T01:00:00.100Z"))).status).toBe("completed");

    expect(run).toHaveBeenCalledTimes(2);
    const rows = await journal("period");
    expect(rows.map((row) => [row.idempotencyKey, row.runAt.toISOString(), row.status])).toEqual([
      [`${jobName("period")}@2026-11-17T01:00:00.000Z`, "2026-11-17T01:00:00.000Z", "completed"],
      [`${jobName("period")}@2026-11-18T01:00:00.000Z`, "2026-11-18T01:00:00.000Z", "completed"],
    ]);
  });

  it("lets a late run of one period finish before the next period runs, instead of the next one being dropped or overlapping", async () => {
    const { gate, release } = deferred();
    const order: string[] = [];
    const late = definition("late", 5, async () => { order.push("late:start"); await gate; order.push("late:end"); return { processed: 1 }; });
    const next = definition("late", 5, async () => { order.push("next"); return { processed: 1 }; });
    const deps = withTiming({ pollMs: 50, maxWaitMs: 10_000 });

    const lateRun = runScheduledJob(late, deps, new Date("2026-11-17T01:00:00.000Z"));
    await vi.waitFor(() => expect(order).toEqual(["late:start"]));
    const nextRun = runScheduledJob(next, deps, new Date("2026-11-18T01:00:00.000Z"));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(order).toEqual(["late:start"]);
    release();

    expect((await lateRun).status).toBe("completed");
    expect((await nextRun).status).toBe("completed");
    expect(order).toEqual(["late:start", "late:end", "next"]);
    expect((await journal("late")).map((row) => row.idempotencyKey)).toEqual([
      `${jobName("late")}@2026-11-17T01:00:00.000Z`, `${jobName("late")}@2026-11-18T01:00:00.000Z`]);
  });

  it("renews the run while it works: the heartbeat moves the journal row's updated_at past its start", async () => {
    const { gate, release } = deferred();
    const job = definition("heartbeat", 6, async () => { await gate; return { processed: 1 }; });

    const outcome = runScheduledJob(job, withTiming({ heartbeatMs: 100 }));
    await vi.waitFor(async () => {
      const [row] = await journal("heartbeat");
      expect(row?.status).toBe("running");
      expect(row.updatedAt!.getTime()).toBeGreaterThan(row.startedAt!.getTime() + 150);
    }, { timeout: 5_000, interval: 50 });
    release();

    expect((await outcome).status).toBe("completed");
  });

  it("detects a lock lost mid-run, closes the run as LOCK_LOST and leaves readiness without a success", async () => {
    const { gate, release } = deferred();
    const job = definition("lost", 7, async () => { await gate; return { processed: 1 }; });

    const outcome = runScheduledJob(job, withTiming({ heartbeatMs: 100 }));
    await vi.waitFor(async () => expect(await heldBy(7)).toHaveLength(1));
    const [holder] = await heldBy(7);
    await pool.query("SELECT pg_terminate_backend($1)", [holder]);
    // The lock is gone the moment the connection is: another runner could now take it.
    await vi.waitFor(async () => expect(await heldBy(7)).toEqual([]));
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();

    expect(await outcome).toEqual({ status: "failed", errorCode: LOCK_LOST, summary: { processed: 1 } });
    expect((await journal("lost")).map((row) => [row.status, row.lastError])).toEqual([["failed", LOCK_LOST]]);
    const [status] = await listScheduledJobStatus([jobName("lost")]);
    expect(status).toMatchObject({ lastStatus: "failed", lastErrorCode: LOCK_LOST, lastSuccessAt: null });
  });

  it("starts the outbox processor with the production scheduler, which delivers a queued security notice and marks it sent, and records the start", async () => {
    const notice = await queueSecurityNotice();
    // Isolate this event from any other pending rows in the shared test database.
    vi.spyOn(outboxEventService, "getPendingEvents").mockImplementation(async () =>
      db.select().from(outboxEvents).where(eq(outboxEvents.id, notice.eventId)));
    // The first start is the durable fact readiness measures never-run jobs from (OPS-002).
    await db.delete(jobs).where(eq(jobs.name, SCHEDULER_START_MARKER));

    expect(initScheduler({ NODE_ENV: "production" }, [])).toBe(true);

    await vi.waitFor(async () => {
      const [event] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, notice.eventId));
      expect(event).toMatchObject({ status: "completed", dispatchGeneration: 1 });
      expect(event.processedAt).not.toBeNull();
    }, { timeout: 15_000, interval: 250 });
    expect(mail.sendEmail).toHaveBeenCalledOnce();
    expect(mail.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: notice.recipient, subject: "Password changed" }));
    await vi.waitFor(async () => {
      expect(await db.select().from(jobs).where(eq(jobs.name, SCHEDULER_START_MARKER))).toHaveLength(1);
    }, { timeout: 5_000, interval: 100 });
  }, 25_000);
});
