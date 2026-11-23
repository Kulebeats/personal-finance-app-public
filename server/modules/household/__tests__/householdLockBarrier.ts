/**
 * Test-only barrier: hold household rows FOR UPDATE on a dedicated connection
 * so concurrent HTTP requests provably queue on them, then let them go at once.
 * Proves a race test really overlapped instead of running the requests in turn.
 */
import { pool } from "../../../db";

const POLL_INTERVAL_MS = 25;
const DEFAULT_WAIT_MS = 10_000;

export interface HouseholdLockBarrier {
  /** Resolves once `count` other backends are blocked behind this one. */
  waitForWaiters(count: number, timeoutMs?: number): Promise<void>;
  release(): Promise<void>;
}

/**
 * Start every request while `householdIds` are held, prove all of them queue
 * behind the barrier, then release them together. The requests are always
 * awaited, even when the barrier check fails, so none outlives its test and
 * writes into the next test's fixture.
 */
export async function raceBehindHouseholdLocks<T>(
  householdIds: string[],
  requests: PromiseLike<T>[],
): Promise<T[]> {
  const barrier = await holdHouseholdLocks(householdIds);
  const pending = requests.map((req) => Promise.resolve(req));
  let barrierError: unknown;
  try {
    await barrier.waitForWaiters(requests.length);
  } catch (error) {
    barrierError = error;
  } finally {
    await barrier.release();
  }
  const settled = await Promise.allSettled(pending);
  if (barrierError) throw barrierError;
  return settled.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
}

export async function holdHouseholdLocks(householdIds: string[]): Promise<HouseholdLockBarrier> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM households WHERE id = ANY($1::uuid[]) FOR UPDATE", [householdIds]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    throw error;
  }
  const { rows } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  const holderPid = rows[0].pid;
  let released = false;

  return {
    async waitForWaiters(count, timeoutMs = DEFAULT_WAIT_MS) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        // Count the whole wait chain, not only direct waiters: when several
        // transactions queue for the SAME row, Postgres makes the second wait
        // on the first waiter's tuple lock, so only the first names the holder.
        const result = await pool.query<{ waiting: number }>(
          `WITH RECURSIVE blocked AS (
             SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))
             UNION
             SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid))
           )
           SELECT count(*)::int AS waiting FROM blocked`,
          [holderPid],
        );
        const waiting = result.rows[0].waiting;
        if (waiting >= count) return;
        if (Date.now() > deadline) {
          throw new Error(`Barrier saw ${waiting} of ${count} expected waiters`);
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    },
    async release() {
      if (released) return;
      released = true;
      try {
        await client.query("COMMIT");
      } finally {
        client.release();
      }
    },
  };
}
