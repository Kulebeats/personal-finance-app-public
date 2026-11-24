/**
 * The HTTP cron door shares the scheduler's advisory locks and job journal
 * (real HTTP, real Postgres):
 *   - a period whose lock another runner holds answers 409 and journals nothing;
 *   - a run is journaled under the scheduler's name and period identity;
 *   - a period the scheduler already completed is not run again (200, PERIOD_DONE),
 *     so the door cannot post recurring transactions alongside the scheduler;
 *   - jobs held back from the scheduler are refused (409 JOB_HELD).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { jobs } from "@shared/schema";
import { db, pool } from "../../db";
import { SCHEDULER_LOCK_NAMESPACE } from "../../core/scheduling/advisoryLock";
import { SCHEDULED_JOB_SPECS } from "../../core/scheduling/jobCatalog";
import { SCHEDULED_RUN_PREFIX } from "../../core/scheduling/jobJournal";
import { periodIdentity, scheduledSlotAtOrBefore } from "../../core/scheduling/schedulePeriod";
import { getTestApp } from "../../__tests__/fixtures";

const CRON_SECRET = "synthetic-cron-door-journal";
/** Generous for one HTTP round trip; far below the scheduler's 15-minute job-lock wait. */
const DOOR_ANSWER_BOUND_MS = 10_000;
let app: Awaited<ReturnType<typeof getTestApp>>;

function periodOf(name: string): { identity: string; scheduledFor: Date } {
  const spec = SCHEDULED_JOB_SPECS.find((candidate) => candidate.name === name);
  if (!spec) throw new Error(`no catalogued job ${name}`);
  const scheduledFor = scheduledSlotAtOrBefore(spec.cron, new Date());
  return { identity: periodIdentity(name, scheduledFor), scheduledFor };
}

async function journalRows(name: string, identity: string) {
  return db.select({ id: jobs.id, status: jobs.status }).from(jobs)
    .where(and(eq(jobs.name, `${SCHEDULED_RUN_PREFIX}${name}`), eq(jobs.idempotencyKey, identity)));
}

async function clearPeriod(name: string, identity: string): Promise<void> {
  await db.delete(jobs).where(and(eq(jobs.name, `${SCHEDULED_RUN_PREFIX}${name}`), eq(jobs.idempotencyKey, identity)));
}

const touched: { name: string; identity: string }[] = [];
const post = (route: string) => request(app).post(`/api/cron/${route}`).set("x-cron-secret", CRON_SECRET);

beforeAll(async () => {
  app = await getTestApp();
}, 60_000);

// The test derives the period from the same clock the door reads: frozen for
// each test, so a slot boundary between the two reads cannot split them.
// Safe only because the door never waits for the job lock (jobLockWaitMs 0):
// the scheduler's bounded wait (advisoryLock.ts waitForJobLock) measures its
// deadline with Date.now(), so under a frozen clock a test that ran the
// scheduler's default wait against a held job lock would never time out.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  for (const { name, identity } of touched) await clearPeriod(name, identity);
});

describe("the cron door shares the scheduler's lock and journal", () => {
  it("answers 409 and journals nothing while another runner holds the period lock", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const { identity } = periodOf("budget.alerts");
    touched.push({ name: "budget.alerts", identity });
    await clearPeriod("budget.alerts", identity);
    const blocker = await pool.connect();
    try {
      // The scheduler's period lock (advisoryLock.ts), held by another runner.
      await blocker.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [`scheduler-period:${identity}`]);

      const response = await post("budget-alerts");

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ success: false, jobs: [{ name: "budget.alerts", status: "skipped", reason: "PERIOD_HELD" }] });
      expect(await journalRows("budget.alerts", identity)).toEqual([]);
    } finally {
      await blocker.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [`scheduler-period:${identity}`]).catch(() => undefined);
      blocker.release();
    }
  }, 60_000);

  it("answers 409 JOB_BUSY at once, without waiting, while another period of the job holds its job lock", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const { identity } = periodOf("budget.alerts");
    touched.push({ name: "budget.alerts", identity });
    await clearPeriod("budget.alerts", identity);
    const lockKey = SCHEDULED_JOB_SPECS.find((spec) => spec.name === "budget.alerts")?.lockKey;
    const blocker = await pool.connect();
    try {
      // The scheduler's job lock (advisoryLock.ts), held by an earlier period's run.
      await blocker.query("SELECT pg_advisory_lock($1, $2)", [SCHEDULER_LOCK_NAMESPACE, lockKey]);
      const startedAt = performance.now();

      const response = await post("budget-alerts");

      // The scheduler would wait up to 15 minutes here; the door asks for no wait.
      expect(performance.now() - startedAt).toBeLessThan(DOOR_ANSWER_BOUND_MS);
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ success: false, jobs: [{ name: "budget.alerts", status: "skipped", reason: "JOB_BUSY" }] });
      expect(await journalRows("budget.alerts", identity)).toEqual([]);
    } finally {
      await blocker.query("SELECT pg_advisory_unlock($1, $2)", [SCHEDULER_LOCK_NAMESPACE, lockKey]).catch(() => undefined);
      blocker.release();
    }
  }, 60_000);

  it("journals a door run under the scheduler's name and period, and does not run that period twice", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const { identity } = periodOf("budget.alerts");
    touched.push({ name: "budget.alerts", identity });
    await clearPeriod("budget.alerts", identity);

    const first = await post("budget-alerts");
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ success: true, jobs: [{ name: "budget.alerts", status: "completed" }] });
    expect((await journalRows("budget.alerts", identity)).map((row) => row.status)).toEqual(["completed"]);

    const second = await post("budget-alerts");
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ success: true, jobs: [{ name: "budget.alerts", status: "skipped", reason: "PERIOD_DONE" }] });
    expect(await journalRows("budget.alerts", identity)).toHaveLength(1);
  }, 60_000);

  it("does not post recurring transactions for a period the scheduler already completed", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    const { identity, scheduledFor } = periodOf("recurring.materialize");
    touched.push({ name: "recurring.materialize", identity });
    await clearPeriod("recurring.materialize", identity);
    // The scheduler's completed run of this period, as jobJournal.ts writes it.
    await db.insert(jobs).values({
      name: `${SCHEDULED_RUN_PREFIX}recurring.materialize`, status: "completed", attempts: 1, maxAttempts: 1,
      runAt: scheduledFor, startedAt: new Date(), completedAt: new Date(), idempotencyKey: identity,
      payload: { scheduledFor: scheduledFor.toISOString() }, result: { processed: 0 },
    });

    const response = await post("recurring");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, jobs: [{ name: "recurring.materialize", status: "skipped", reason: "PERIOD_DONE" }] });
    expect(await journalRows("recurring.materialize", identity)).toHaveLength(1);
  }, 60_000);

  it.each(["goals-status", "market-data"])("refuses the held-back job behind POST /api/cron/%s", async (route) => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);

    const response = await post(route);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ success: false, error: { code: "JOB_HELD" } });
  }, 60_000);
});
