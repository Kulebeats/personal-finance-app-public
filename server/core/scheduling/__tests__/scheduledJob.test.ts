import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";

vi.mock("../../../db", () => ({ db: {}, pool: {} }));
vi.mock("../../../utils/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  JOB_OUTCOME_UNKNOWN, LOCK_LOST, PARTIAL_FAILURE, runScheduledJob, type JobRunDependencies, type ScheduledJobDefinition,
} from "../scheduledJob";
import { withJobAdvisoryLock, type JobLease, type JobLockTiming } from "../advisoryLock";
import type { JobRunFinish } from "../jobJournal";
import { logger } from "../../../utils/logger";

const NOW = new Date("2026-11-17T01:00:00.250Z");
const SLOT = "2026-11-17T01:00:00.000Z";

/**
 * Same contract as the advisory locks: a held period answers PERIOD_HELD at
 * once, a job held by another period answers JOB_BUSY, and `lose()` drops the
 * lease the way a terminated lock connection would.
 */
function fakeLockDependencies(completedPeriods: readonly string[] = []) {
  const heldPeriods = new Set<string>();
  const heldJobs = new Set<number>();
  const finished: Array<{ runId: string; finish: JobRunFinish }> = [];
  const leases: Array<{ lose: () => void; renew: () => Promise<void> }> = [];
  let runs = 0;
  const deps: JobRunDependencies = {
    async withLock(request, work) {
      if (heldPeriods.has(request.periodIdentity)) return { acquired: false, reason: "PERIOD_HELD" };
      if (heldJobs.has(request.lockKey)) return { acquired: false, reason: "JOB_BUSY" };
      heldPeriods.add(request.periodIdentity);
      heldJobs.add(request.lockKey);
      let isLost = false;
      const listeners: Array<() => Promise<void>> = [];
      const lease: JobLease = { isLost: () => isLost, onRenewed: (listener) => { listeners.push(listener); } };
      leases.push({ lose: () => { isLost = true; }, renew: async () => { for (const listener of listeners) await listener(); } });
      try {
        return { acquired: true, result: await work(lease) };
      } finally {
        heldPeriods.delete(request.periodIdentity);
        heldJobs.delete(request.lockKey);
      }
    },
    hasCompletedPeriod: vi.fn(async (_jobName: string, identity: string) => completedPeriods.includes(identity)),
    startRun: vi.fn(async () => `run-${++runs}`),
    renewRun: vi.fn(async () => {}),
    finishRun: vi.fn(async (runId: string, finish: JobRunFinish) => { finished.push({ runId, finish }); }),
  };
  return { deps, finished, leases };
}

function job(run: ScheduledJobDefinition["run"]): ScheduledJobDefinition {
  return { name: "synthetic.job", cron: "0 1 * * *", lockKey: 999, run };
}

function deferred() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { gate, release };
}

describe("runScheduledJob", () => {
  it("lets a second runner of the same period skip while the first holds it, without running or journaling", async () => {
    const { deps, finished } = fakeLockDependencies();
    const { gate, release } = deferred();
    const run = vi.fn(async () => { await gate; return { processed: 1 }; });

    const first = runScheduledJob(job(run), deps, NOW);
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    const second = await runScheduledJob(job(run), deps, NOW);
    release();

    expect(second).toEqual({ status: "skipped", reason: "PERIOD_HELD" });
    expect(await first).toEqual({ status: "completed", summary: { processed: 1 } });
    expect(run).toHaveBeenCalledOnce();
    expect(deps.startRun).toHaveBeenCalledOnce();
    expect(finished).toEqual([{ runId: "run-1", finish: { isOk: true, errorCode: null, summary: { processed: 1 } } }]);
  });

  it("locks and journals the run under its scheduled slot, not the moment it started", async () => {
    const { deps } = fakeLockDependencies();
    const withLock = vi.spyOn(deps, "withLock");

    await runScheduledJob(job(async () => ({ processed: 1 })), deps, new Date("2026-11-17T01:09:30.000Z"));

    expect(withLock).toHaveBeenCalledWith({ lockKey: 999, periodIdentity: `synthetic.job@${SLOT}` }, expect.any(Function));
    expect(deps.startRun).toHaveBeenCalledWith("synthetic.job", { identity: `synthetic.job@${SLOT}`, scheduledFor: new Date(SLOT) });
  });

  it("skips a delayed tick whose period another instance already completed", async () => {
    const { deps, finished } = fakeLockDependencies([`synthetic.job@${SLOT}`]);
    const run = vi.fn(async () => ({ processed: 1 }));

    expect(await runScheduledJob(job(run), deps, NOW)).toEqual({ status: "skipped", reason: "PERIOD_DONE" });
    expect(run).not.toHaveBeenCalled();
    expect(deps.startRun).not.toHaveBeenCalled();
    expect(finished).toEqual([]);
  });

  it("runs the next period after a completed one: the date in the identity keeps them apart", async () => {
    const { deps } = fakeLockDependencies([`synthetic.job@${SLOT}`]);
    const run = vi.fn(async () => ({ processed: 1 }));

    const next = await runScheduledJob(job(run), deps, new Date("2026-11-18T01:00:00.100Z"));

    expect(next).toEqual({ status: "completed", summary: { processed: 1 } });
    expect(deps.startRun).toHaveBeenCalledWith("synthetic.job", expect.objectContaining({ identity: "synthetic.job@2026-11-18T01:00:00.000Z" }));
  });

  it("renews the journal row on every heartbeat that confirmed the lock", async () => {
    const { deps, leases } = fakeLockDependencies();
    const { gate, release } = deferred();
    const outcome = runScheduledJob(job(async () => { await gate; return { processed: 1 }; }), deps, NOW);
    await vi.waitFor(() => expect(leases).toHaveLength(1));
    await vi.waitFor(() => expect(deps.startRun).toHaveBeenCalledOnce());

    await leases[0].renew();
    await leases[0].renew();
    release();
    await outcome;

    expect(deps.renewRun).toHaveBeenCalledTimes(2);
    expect(deps.renewRun).toHaveBeenCalledWith("run-1");
  });

  it("closes a run whose lock was lost mid-run as LOCK_LOST, even when the work returned, so it never counts as a success", async () => {
    const { deps, finished, leases } = fakeLockDependencies();
    const { gate, release } = deferred();
    const outcome = runScheduledJob(job(async () => { await gate; return { processed: 4 }; }), deps, NOW);
    await vi.waitFor(() => expect(leases).toHaveLength(1));

    leases[0].lose();
    release();

    expect(await outcome).toEqual({ status: "failed", errorCode: LOCK_LOST, summary: { processed: 4 } });
    expect(finished[0].finish).toEqual({ isOk: false, errorCode: LOCK_LOST, summary: { processed: 4 } });
  });

  it("journals a summary with failures as a failed run", async () => {
    const { deps, finished } = fakeLockDependencies();

    const outcome = await runScheduledJob(job(async () => ({ processed: 3, failed: 1 })), deps, NOW);

    expect(outcome).toEqual({ status: "failed", errorCode: PARTIAL_FAILURE, summary: { processed: 3, failed: 1 } });
    expect(finished[0].finish).toEqual({ isOk: false, errorCode: PARTIAL_FAILURE, summary: { processed: 3, failed: 1 } });
  });

  it.each([
    [Object.assign(new Error("duplicate key value violates PRIVATE_SENTINEL"), { code: "23505" }), "PG_23505"],
    [Object.assign(new Error("PRIVATE_SENTINEL"), { code: "HOUSEHOLD_CALENDAR_REQUIRED" }), "HOUSEHOLD_CALENDAR_REQUIRED"],
    [new Error("PRIVATE_SENTINEL amount 777.77"), "JOB_FAILED"],
    ["PRIVATE_SENTINEL", "JOB_FAILED"],
  ])("journals a thrown %s as the bounded code %s, never its message", async (error, code) => {
    const { deps, finished } = fakeLockDependencies();

    const outcome = await runScheduledJob(job(async () => { throw error; }), deps, NOW);

    expect(outcome).toEqual({ status: "failed", errorCode: code, summary: null });
    expect(finished[0].finish).toEqual({ isOk: false, errorCode: code, summary: null });
    expect(JSON.stringify(finished)).not.toContain("PRIVATE_SENTINEL");
  });

  it("reports an unknown outcome when the journal cannot close a run whose work already ran", async () => {
    const { deps } = fakeLockDependencies();
    const run = vi.fn(async () => ({ processed: 2 }));
    const finishRun = vi.fn(async () => { throw Object.assign(new Error("synthetic journal outage"), { code: "57P01" }); });

    await expect(runScheduledJob(job(run), { ...deps, finishRun }, NOW)).rejects.toMatchObject({ code: JOB_OUTCOME_UNKNOWN });
    expect(run).toHaveBeenCalledOnce();
  });

  it("answers RUN_SUPERSEDED, not an unknown outcome, when the journal rejects a stale run's close (OPS-013)", async () => {
    const { deps } = fakeLockDependencies();
    const run = vi.fn(async () => ({ processed: 2 }));
    const finishRun = vi.fn(async () => { throw Object.assign(new Error("synthetic stale close"), { code: "RUN_SUPERSEDED" }); });

    await expect(runScheduledJob(job(run), { ...deps, finishRun }, NOW))
      .resolves.toEqual({ status: "failed", errorCode: "RUN_SUPERSEDED", summary: { processed: 2 } });
    expect(run).toHaveBeenCalledOnce();
  });

  it("passes a caller's bound on the job-lock wait to the lock request", async () => {
    const { deps } = fakeLockDependencies();
    const withLock = vi.spyOn(deps, "withLock");

    await runScheduledJob(job(async () => ({ processed: 1 })), deps, NOW, { jobLockWaitMs: 0 });

    expect(withLock).toHaveBeenCalledWith({ lockKey: 999, periodIdentity: `synthetic.job@${SLOT}`, maxWaitMs: 0 }, expect.any(Function));
  });
});

describe("withJobAdvisoryLock", () => {
  type Answer = unknown | Error | ((call: number) => unknown);
  type Route = "period" | "job" | "heartbeat" | "periodUnlock" | "jobUnlock";
  const route = (text: string): Route => {
    if (text.includes("pg_locks")) return "heartbeat";
    if (text.includes("unlock")) return text.includes("hashtextextended") ? "periodUnlock" : "jobUnlock";
    return text.includes("hashtextextended") ? "period" : "job";
  };
  const defaults: Record<Route, Answer> = {
    period: { acquired: true }, job: { acquired: true }, heartbeat: { held: 2 },
    periodUnlock: { released: true }, jobUnlock: { released: true },
  };

  function fakePool(overrides: Partial<Record<Route, Answer>> = {}) {
    const answers = { ...defaults, ...overrides };
    const calls: Record<Route, number> = { period: 0, job: 0, heartbeat: 0, periodUnlock: 0, jobUnlock: 0 };
    const release = vi.fn();
    const listeners = new Map<string, (error: Error) => void>();
    const query = vi.fn(async (text: string) => {
      const kind = route(text);
      const call = ++calls[kind];
      const raw = answers[kind];
      const answer = typeof raw === "function" ? (raw as (n: number) => unknown)(call) : raw;
      if (answer instanceof Error) throw answer;
      return { rows: [answer] };
    });
    const client = {
      query, release,
      on: vi.fn((event: string, listener: (error: Error) => void) => { listeners.set(event, listener); }),
      off: vi.fn((event: string) => { listeners.delete(event); }),
    } as unknown as PoolClient;
    return { pool: { connect: vi.fn(async () => client) }, release, query, calls, listeners };
  }

  const fast: JobLockTiming = { heartbeatMs: 5, maxWaitMs: 40, pollMs: 10, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
  const request = { lockKey: 7, periodIdentity: `synthetic.job@${SLOT}` };

  it("skips at once when another runner holds the same period, and returns its connection", async () => {
    const lockPool = fakePool({ period: { acquired: false } });
    const work = vi.fn(async () => "ran");

    expect(await withJobAdvisoryLock(request, work, lockPool.pool, fast)).toEqual({ acquired: false, reason: "PERIOD_HELD" });
    expect(work).not.toHaveBeenCalled();
    expect(lockPool.calls.job).toBe(0);
    expect(lockPool.release).toHaveBeenCalledWith(false);
  });

  it("waits for a late run of another period to finish, then runs, instead of dropping its own period", async () => {
    const lockPool = fakePool({ job: (call: number) => ({ acquired: call >= 3 }) });

    expect(await withJobAdvisoryLock(request, async () => "ran", lockPool.pool, fast)).toEqual({ acquired: true, result: "ran" });
    expect(lockPool.calls.job).toBe(3);
  });

  it("gives up waiting after its bound, releases the period it held and reports JOB_BUSY", async () => {
    const lockPool = fakePool({ job: { acquired: false } });
    const work = vi.fn(async () => "ran");

    expect(await withJobAdvisoryLock(request, work, lockPool.pool, fast)).toEqual({ acquired: false, reason: "JOB_BUSY" });
    expect(work).not.toHaveBeenCalled();
    expect(lockPool.calls.job).toBeGreaterThan(1);
    expect(lockPool.calls.periodUnlock).toBe(1);
    expect(lockPool.calls.jobUnlock).toBe(0);
    expect(lockPool.release).toHaveBeenCalledWith(false);
  });

  it("does not wait for the job lock when the request bounds the wait at zero", async () => {
    const lockPool = fakePool({ job: { acquired: false } });
    const sleep = vi.fn(fast.sleep);

    expect(await withJobAdvisoryLock({ ...request, maxWaitMs: 0 }, async () => "ran", lockPool.pool, { ...fast, sleep }))
      .toEqual({ acquired: false, reason: "JOB_BUSY" });
    expect(lockPool.calls.job).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(lockPool.calls.periodUnlock).toBe(1);
  });

  it("renews while the work runs: each heartbeat confirms both locks on the holding connection", async () => {
    const lockPool = fakePool();
    const renewed = vi.fn(async () => {});
    let lease!: JobLease;

    await withJobAdvisoryLock(request, async (held) => {
      lease = held;
      held.onRenewed(renewed);
      await vi.waitFor(() => expect(renewed.mock.calls.length).toBeGreaterThanOrEqual(2));
      return "ran";
    }, lockPool.pool, fast);

    expect(lease.isLost()).toBe(false);
    const heartbeats = lockPool.calls.heartbeat;
    await new Promise((r) => setTimeout(r, 30));
    expect(lockPool.calls.heartbeat).toBe(heartbeats);
  });

  it.each([
    ["a heartbeat finds a lock gone", { heartbeat: { held: 1 } }],
    ["the holding connection fails", { heartbeat: new Error("terminating connection due to administrator command") }],
  ])("marks the lease lost when %s, logs it and stops renewing", async (_case, overrides) => {
    const lockPool = fakePool(overrides);
    const renewed = vi.fn(async () => {});
    let lost = false;

    await withJobAdvisoryLock(request, async (lease) => {
      lease.onRenewed(renewed);
      await vi.waitFor(() => expect(lease.isLost()).toBe(true));
      lost = lease.isLost();
      return "ran";
    }, lockPool.pool, fast);

    expect(lost).toBe(true);
    expect(renewed).not.toHaveBeenCalled();
    expect(lockPool.calls.heartbeat).toBe(1);
    expect(logger.error).toHaveBeenCalledWith("Scheduled job lost its lock", expect.objectContaining({ lockKey: 7 }));
    expect(lockPool.release).toHaveBeenCalledWith(true);
  });

  it("marks the lease lost on a connection error event instead of crashing the process", async () => {
    const lockPool = fakePool();

    await withJobAdvisoryLock(request, async (lease) => {
      lockPool.listeners.get("error")?.(new Error("Connection terminated unexpectedly"));
      expect(lease.isLost()).toBe(true);
      return "ran";
    }, lockPool.pool, fast);

    expect(lockPool.listeners.has("error")).toBe(false);
    expect(lockPool.release).toHaveBeenCalledWith(true);
  });

  it("destroys the connection when the lock cannot be released, so it can never leak back held", async () => {
    const lockPool = fakePool({ jobUnlock: new Error("connection lost") });

    expect(await withJobAdvisoryLock(request, async () => "ran", lockPool.pool, fast)).toEqual({ acquired: true, result: "ran" });
    expect(lockPool.release).toHaveBeenCalledWith(true);
  });

  it.each([0, -1, 1.5, 2_147_483_648])("refuses lock key %s", async (key) => {
    const lockPool = fakePool();

    await expect(withJobAdvisoryLock({ ...request, lockKey: key }, async () => "ran", lockPool.pool, fast))
      .rejects.toThrow("Invalid scheduler lock key");
    expect(lockPool.pool.connect).not.toHaveBeenCalled();
  });

  it.each(["", "x".repeat(201)])("refuses a period identity of length %#", async (periodIdentity) => {
    const lockPool = fakePool();

    await expect(withJobAdvisoryLock({ ...request, periodIdentity }, async () => "ran", lockPool.pool, fast))
      .rejects.toThrow("Invalid scheduler period identity");
    expect(lockPool.pool.connect).not.toHaveBeenCalled();
  });
});
