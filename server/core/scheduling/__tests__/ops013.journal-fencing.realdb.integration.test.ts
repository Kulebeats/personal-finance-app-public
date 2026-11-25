/**
 * OPS-013 fencing against real Postgres: the journal rejects a stale run.
 *
 * A run whose lock was lost cannot be stopped mid-flight. Once a newer run of
 * the same period has started, the stale run's late close must be rejected,
 * not recorded over the newer run's, and the journal must never hold two
 * running or two completed rows for one period.
 */
import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { and, eq, like, sql } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { jobs } from "@shared/schema";
import { db, pool } from "../../../db";
import { getPostgresError } from "../../../utils/postgresError";
import { finishJobRun, SCHEDULED_RUN_PREFIX, startJobRun, type ScheduledPeriod } from "../jobJournal";

const tag = randomUUID().slice(0, 8);
const jobName = (label: string) => `test.ops013-${label}-${tag}`;
const period = (label: string): ScheduledPeriod => {
  const scheduledFor = new Date("2026-11-24T01:00:00.000Z");
  return { identity: `${jobName(label)}@${scheduledFor.toISOString()}`, scheduledFor };
};
const OK = { isOk: true, errorCode: null, summary: { processed: 1 } } as const;
const rows = (label: string) => db.select({ id: jobs.id, status: jobs.status, lastError: jobs.lastError })
  .from(jobs).where(eq(jobs.name, `${SCHEDULED_RUN_PREFIX}${jobName(label)}`));

afterAll(async () => {
  await db.delete(jobs).where(like(jobs.name, `${SCHEDULED_RUN_PREFIX}test.ops013-%-${tag}`));
});

it("rejects a stale run's late close once a newer run of the same period has started", async () => {
  const stale = await startJobRun(jobName("stale"), period("stale"));
  // The stale run's lock was lost; another runner took the period and started.
  const current = await startJobRun(jobName("stale"), period("stale"));

  await expect(finishJobRun(stale!, OK)).rejects.toMatchObject({ code: "RUN_SUPERSEDED" });
  await finishJobRun(current!, OK);

  const journal = await rows("stale");
  expect(journal).toHaveLength(2);
  expect(journal.find((row) => row.id === stale)).toMatchObject({ status: "failed", lastError: "RUN_SUPERSEDED" });
  expect(journal.find((row) => row.id === current)).toMatchObject({ status: "completed", lastError: null });
});

it("does not start a run of a period that has already completed", async () => {
  const first = await startJobRun(jobName("done"), period("done"));
  await finishJobRun(first!, OK);

  expect(await startJobRun(jobName("done"), period("done"))).toBeNull();
  expect(await rows("done")).toEqual([{ id: first, status: "completed", lastError: null }]);
});

it("closes an old running row as superseded when its period already completed", async () => {
  const label = "already-done";
  const name = `${SCHEDULED_RUN_PREFIX}${jobName(label)}`;
  const { identity, scheduledFor } = period(label);
  const stale = await startJobRun(jobName(label), period(label));
  expect(stale).toBeTruthy();
  const [winner] = await db.insert(jobs).values({
    name, status: "completed", idempotencyKey: identity, runAt: scheduledFor,
    completedAt: scheduledFor, result: { processed: 7 },
  }).returning();

  await expect.soft(finishJobRun(stale!, OK)).rejects.toMatchObject({ code: "RUN_SUPERSEDED" });
  expect.soft(await rows(label)).toEqual(expect.arrayContaining([
    { id: stale, status: "failed", lastError: "RUN_SUPERSEDED" },
    { id: winner.id, status: "completed", lastError: null },
  ]));
  const [persisted] = await db.select().from(jobs).where(eq(jobs.id, winner.id));
  expect(persisted).toEqual(winner);
});

it("settles a stale close racing a real completion at the unique period fence", async () => {
  const label = "close-race";
  const name = `${SCHEDULED_RUN_PREFIX}${jobName(label)}`;
  const { identity, scheduledFor } = period(label);
  const stale = await startJobRun(jobName(label), period(label));
  expect(stale).toBeTruthy();
  let closeAttempt: Promise<unknown> | undefined;

  try {
    await db.transaction(async tx => {
      // Model a legacy runner's completed row becoming visible while the
      // original runner is already trying to close beside it.
      const { rows: [backend] } = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
      await tx.insert(jobs).values({
        name, status: "completed", idempotencyKey: identity, runAt: scheduledFor,
        completedAt: scheduledFor, result: { processed: 8 },
      });
      closeAttempt = finishJobRun(stale!, OK).then(() => null, (error: unknown) => error);
      const deadline = Date.now() + 5000;
      let observed = false;
      while (!observed && Date.now() < deadline) {
        const { rows: [witness] } = await pool.query<{ blocked: boolean }>(`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
              AND $1::int = ANY(pg_blocking_pids(pid))
          ) AS blocked`, [backend.pid]);
        observed = witness.blocked;
        if (!observed) await pause(20);
      }
      expect(observed, "stale close waited on the winner's uncommitted completion").toBe(true);
    });
  } finally {
    // Resolve after transaction commit or rollback, never while it holds the fence.
    await closeAttempt;
  }
  expect.soft(await closeAttempt).toMatchObject({ code: "RUN_SUPERSEDED" });
  const journal = await rows(label);
  expect(journal.filter(row => row.status === "completed")).toHaveLength(1);
  expect(journal.find(row => row.id === stale)).toMatchObject({ status: "failed", lastError: "RUN_SUPERSEDED" });
});

it("holds at most one running and one completed row per period, and leaves other jobs' rows alone", async () => {
  const name = `${SCHEDULED_RUN_PREFIX}${jobName("unique")}`;
  const { identity, scheduledFor } = period("unique");
  const row = (status: "running" | "completed") => ({
    name, status, attempts: 1, maxAttempts: 1, runAt: scheduledFor, startedAt: new Date(), idempotencyKey: identity,
  });
  // Drizzle wraps the Postgres error; the SQLSTATE and index name sit on its cause.
  const duplicate = (status: "running" | "completed") =>
    db.insert(jobs).values(row(status)).then(() => undefined, (error: unknown) => getPostgresError(error));
  await db.insert(jobs).values(row("running"));
  expect(await duplicate("running")).toMatchObject({ code: "23505", constraint: "idx_jobs_scheduled_period_running" });
  await db.insert(jobs).values(row("completed"));
  expect(await duplicate("completed")).toMatchObject({ code: "23505", constraint: "idx_jobs_scheduled_period_completed" });
  expect(await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.name, name), eq(jobs.idempotencyKey, identity))))
    .toHaveLength(2);

  // The generic job queue shares the table; its rows are not scheduled runs.
  const queued = `test.ops013-queue-${tag}`;
  const queueRow = { ...row("completed"), name: queued };
  await db.insert(jobs).values([queueRow, queueRow]);
  expect(await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.name, queued))).toHaveLength(2);
  await db.delete(jobs).where(eq(jobs.name, queued));
});
