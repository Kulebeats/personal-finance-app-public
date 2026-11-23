import type { Pool, PoolClient } from "pg";
import { pool } from "../../db";
import { logger } from "../../utils/logger";

/**
 * Postgres advisory locks for scheduled jobs (OPS-003, OPS-013).
 *
 * Coordination lives in Postgres, not Redis: the cache store runs
 * `allkeys-lru`, so a lock kept there can be evicted under memory pressure, and
 * a TTL lock can expire under a slow run. A session-level advisory lock has
 * neither failure: it lives exactly as long as the holding connection.
 *
 * One dedicated connection takes two locks for the whole run:
 * - the period lock, keyed by the job and its scheduled slot, taken without
 *   waiting: a second runner of the same period skips at once (PERIOD_HELD);
 * - the job lock, keyed by the job alone, so two periods of one job never run
 *   at the same time. A late run of yesterday's period makes today's wait (a
 *   bounded poll) instead of overlapping it or dropping it (JOB_BUSY).
 *
 * While the work runs, a heartbeat on that connection confirms both locks are
 * still held. A session lock cannot be released by anyone else, so the only
 * way to lose it is to lose the connection — terminated backend, network drop,
 * a pooler that swapped the backend — and the heartbeat, or the connection's
 * error event, marks the lease lost so the run is never journaled as a clean
 * success. Work cannot be cancelled mid-flight; the lost lease is recorded.
 */
export const SCHEDULER_LOCK_NAMESPACE = 20_261_116;
const MAX_INT4 = 2_147_483_647;
const MAX_PERIOD_IDENTITY_LENGTH = 200;
const LOCKS_PER_RUN = 2;

export interface JobLockTiming {
  /** Gap between heartbeats; well under any idle-session timeout. */
  readonly heartbeatMs: number;
  /** How long a period waits for an earlier period of the same job. */
  readonly maxWaitMs: number;
  readonly pollMs: number;
  readonly sleep: (ms: number) => Promise<void>;
}

export const DEFAULT_LOCK_TIMING: JobLockTiming = Object.freeze({
  heartbeatMs: 30_000,
  maxWaitMs: 15 * 60_000,
  pollMs: 15_000,
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
});

export interface JobLockRequest {
  /** Fixed advisory-lock key, unique per job. */
  readonly lockKey: number;
  /** The job and its scheduled slot; see schedulePeriod.ts. */
  readonly periodIdentity: string;
}

export interface JobLease {
  readonly isLost: () => boolean;
  /** Called after every heartbeat that confirmed both locks. */
  readonly onRenewed: (listener: () => Promise<void>) => void;
}

export type LockSkipReason = "PERIOD_HELD" | "JOB_BUSY";

export type LockOutcome<T> =
  | { readonly acquired: true; readonly result: T }
  | { readonly acquired: false; readonly reason: LockSkipReason };

type LockPool = Pick<Pool, "connect">;

const PERIOD_LOCK_SQL = "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired";
const PERIOD_UNLOCK_SQL = "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS released";
const JOB_LOCK_SQL = "SELECT pg_try_advisory_lock($1, $2) AS acquired";
const JOB_UNLOCK_SQL = "SELECT pg_advisory_unlock($1, $2) AS released";
// This connection is dedicated to the run and takes no other advisory lock.
const HEARTBEAT_SQL =
  "SELECT count(*)::int AS held FROM pg_locks WHERE locktype = 'advisory' AND granted AND pid = pg_backend_pid()";

const periodLockKey = (identity: string): string => `scheduler-period:${identity}`;

function validate(request: JobLockRequest): void {
  const { lockKey, periodIdentity } = request;
  if (!Number.isInteger(lockKey) || lockKey <= 0 || lockKey > MAX_INT4) throw new Error("Invalid scheduler lock key");
  if (typeof periodIdentity !== "string" || periodIdentity.length === 0 || periodIdentity.length > MAX_PERIOD_IDENTITY_LENGTH) {
    throw new Error("Invalid scheduler period identity");
  }
}

async function tryLock(client: PoolClient, text: string, values: readonly unknown[]): Promise<boolean> {
  const locked = await client.query<{ acquired: boolean }>(text, [...values]);
  return locked.rows[0]?.acquired === true;
}

async function unlock(client: PoolClient, text: string, values: readonly unknown[], lockKey: number): Promise<boolean> {
  try {
    const released = await client.query<{ released: boolean }>(text, [...values]);
    return released.rows[0]?.released === true;
  } catch (error) {
    logger.error("Scheduler lock release failed; discarding its connection", { lockKey, error });
    return false;
  }
}

async function waitForJobLock(client: PoolClient, lockKey: number, timing: JobLockTiming): Promise<boolean> {
  const deadline = Date.now() + timing.maxWaitMs;
  for (;;) {
    if (await tryLock(client, JOB_LOCK_SQL, [SCHEDULER_LOCK_NAMESPACE, lockKey])) return true;
    if (Date.now() + timing.pollMs > deadline) return false;
    await timing.sleep(timing.pollMs);
  }
}

interface Heartbeat {
  readonly lease: JobLease;
  readonly stop: () => Promise<void>;
}

function startHeartbeat(client: PoolClient, lockKey: number, timing: JobLockTiming): Heartbeat {
  let isLost = false;
  let inFlight: Promise<void> = Promise.resolve();
  const listeners: Array<() => Promise<void>> = [];
  const markLost = (reason: string, error?: unknown) => {
    if (isLost) return;
    isLost = true;
    clearInterval(timer);
    logger.error("Scheduled job lost its lock", { lockKey, reason, ...(error === undefined ? {} : { error }) });
  };
  const onError = (error: Error) => markLost("CONNECTION_ERROR", error);
  const beat = async () => {
    try {
      const held = await client.query<{ held: number }>(HEARTBEAT_SQL);
      if (held.rows[0]?.held !== LOCKS_PER_RUN) return markLost("LOCK_NOT_HELD");
    } catch (error) {
      return markLost("HEARTBEAT_FAILED", error);
    }
    for (const listener of listeners) {
      // A failed renewal of the journal row is not a lost lock.
      await listener().catch((error: unknown) => logger.warn("Scheduled job renewal failed", { lockKey, error }));
    }
  };
  const timer = setInterval(() => {
    if (isLost) return;
    inFlight = inFlight.then(beat);
  }, timing.heartbeatMs);
  client.on("error", onError);
  return {
    lease: { isLost: () => isLost, onRenewed: (listener) => { listeners.push(listener); } },
    stop: async () => {
      clearInterval(timer);
      await inFlight;
      client.off("error", onError);
    },
  };
}

type Settled<T> = { readonly isOk: true; readonly value: T } | { readonly isOk: false; readonly error: unknown };

interface HeldRun<T> {
  readonly outcome: { readonly acquired: false; readonly reason: LockSkipReason } | { readonly acquired: true; readonly settled: Settled<T> };
  /** False when any doubt remains about the connection's lock state. */
  readonly isClean: boolean;
}

async function settle<T>(work: () => Promise<T>): Promise<Settled<T>> {
  try {
    return { isOk: true, value: await work() };
  } catch (error) {
    return { isOk: false, error };
  }
}

async function holdAndRun<T>(
  client: PoolClient,
  request: JobLockRequest,
  work: (lease: JobLease) => Promise<T>,
  timing: JobLockTiming,
): Promise<HeldRun<T>> {
  const periodKey = periodLockKey(request.periodIdentity);
  if (!await tryLock(client, PERIOD_LOCK_SQL, [periodKey])) {
    return { outcome: { acquired: false, reason: "PERIOD_HELD" }, isClean: true };
  }
  const releasePeriod = () => unlock(client, PERIOD_UNLOCK_SQL, [periodKey], request.lockKey);
  const waited = await settle(() => waitForJobLock(client, request.lockKey, timing));
  if (!waited.isOk) {
    await releasePeriod();
    throw waited.error;
  }
  if (!waited.value) {
    logger.warn("Scheduled job period waited out its bound; an earlier period still holds the job", { lockKey: request.lockKey });
    return { outcome: { acquired: false, reason: "JOB_BUSY" }, isClean: await releasePeriod() };
  }
  const heartbeat = startHeartbeat(client, request.lockKey, timing);
  const settled = await settle(() => work(heartbeat.lease));
  await heartbeat.stop();
  const jobReleased = await unlock(client, JOB_UNLOCK_SQL, [SCHEDULER_LOCK_NAMESPACE, request.lockKey], request.lockKey);
  const periodReleased = await releasePeriod();
  // A lost lease means the connection is suspect: never return it to the pool.
  return { outcome: { acquired: true, settled }, isClean: !heartbeat.lease.isLost() && jobReleased && periodReleased };
}

export async function withJobAdvisoryLock<T>(
  request: JobLockRequest,
  work: (lease: JobLease) => Promise<T>,
  lockPool: LockPool = pool,
  timing: JobLockTiming = DEFAULT_LOCK_TIMING,
): Promise<LockOutcome<T>> {
  validate(request);
  const client = await lockPool.connect();
  // Any doubt about the connection's lock state destroys it rather than
  // returning a connection that might still hold a lock to the pool.
  let isClean = false;
  try {
    const held = await holdAndRun(client, request, work, timing);
    isClean = held.isClean;
    if (!held.outcome.acquired) return held.outcome;
    if (!held.outcome.settled.isOk) throw held.outcome.settled.error;
    return { acquired: true, result: held.outcome.settled.value };
  } finally {
    client.release(!isClean);
  }
}
