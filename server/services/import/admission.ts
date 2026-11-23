import { setTimeout as delay } from "node:timers/promises";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { HttpError } from "../../core/errors";
import { UTC_SESSION_OPTION } from "../../db";
import { assertProtectedTestProcess, resolveDatabaseConnection } from "../../dbSsl";
import { logger } from "../../utils/logger";
import { withTransaction, type TransactionRunner } from "../../utils/withTransaction";

const LOCK_TIMEOUT_MS = 2_000;
const TRY_LOCK = "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired, pg_backend_pid() AS pid";
const UNLOCK = "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS released";
const VERIFY_SESSION = sql`SELECT pg_backend_pid() AS pid, count(*)::int AS held
  FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory' AND granted`;

export const accountImportKey = (id: string) => `csv-import:${id.toLowerCase()}`;
export const batchImportKey = (householdId: string, batchId: string) =>
  `csv-import-batch:${householdId.toLowerCase()}:${batchId.toLowerCase()}`;

export class ImportAdmissionError extends HttpError {
  readonly statusCode = 503;
  readonly code: "IMPORT_BUSY" | "IMPORT_UNAVAILABLE";

  constructor(busy = false) {
    super(busy ? "Another import is using this account or batch. Retry the same import shortly."
      : "Import admission is temporarily unavailable. Retry the same import.");
    this.code = busy ? "IMPORT_BUSY" : "IMPORT_UNAVAILABLE";
  }
}

type AdmissionPool = Pick<Pool, "connect">;
type Timing = { waitMs: number; pollMs: number; now: () => number; sleep: (ms: number) => Promise<void> };
const defaultTiming: Timing = { waitMs: 5_000, pollMs: 100, now: () => performance.now(), sleep: delay };

let importPool: Pool | undefined;
function dedicatedImportPool(): Pool {
  assertProtectedTestProcess();
  if (!importPool) {
    importPool = new Pool({
      ...resolveDatabaseConnection(),
      options: [process.env.PGOPTIONS, UTC_SESSION_OPTION].filter(Boolean).join(" "),
      application_name: "capital-import-admission",
      max: 4, idleTimeoutMillis: 30_000, connectionTimeoutMillis: LOCK_TIMEOUT_MS,
    });
    importPool.on("error", () => logger.warn("Idle import admission connection failed"));
  }
  return importPool;
}

interface ImportAdmission {
  acquire(key: string): Promise<void>;
  transaction: TransactionRunner;
}

/**
 * Import locks and financial work share one physical writer session. If it
 * disconnects, no application-pool transaction remains that can post after
 * the advisory locks disappear.
 */
export async function withImportAdmission<T>(
  work: (admission: ImportAdmission) => Promise<T>,
  lockPool: AdmissionPool = dedicatedImportPool(),
  timing: Timing = defaultTiming,
): Promise<T> {
  const client = await lockPool.connect().catch((error: unknown) => {
    logger.warn("Import admission connection failed", {}, error instanceof Error ? error : undefined);
    throw new ImportAdmissionError();
  });
  const held: string[] = [];
  let backend: number | undefined;
  let lost = false;
  let active = true;
  let discard = false;
  const markLost = () => { lost = true; discard = true; };
  client.on("error", markLost);
  client.on("end", markLost);

  const assertHealthy = () => {
    if (lost || !active) throw new ImportAdmissionError();
  };
  const acquire = async (key: string) => {
    const deadline = timing.now() + timing.waitMs;
    for (;;) {
      assertHealthy();
      const command = { text: TRY_LOCK, values: [key], query_timeout: LOCK_TIMEOUT_MS };
      const lock = await client.query<{ acquired: boolean; pid: number }>(command).catch(() => {
        markLost();
        throw new ImportAdmissionError();
      });
      const [row] = lock.rows;
      if (!row || typeof row.acquired !== "boolean" || !Number.isInteger(row.pid) ||
        (backend !== undefined && backend !== row.pid)) {
        markLost();
        throw new ImportAdmissionError();
      }
      backend = row.pid;
      if (row.acquired) {
        held.push(key);
        assertHealthy();
        return;
      }
      const remaining = deadline - timing.now();
      if (remaining <= 0) throw new ImportAdmissionError(true);
      await timing.sleep(Math.min(timing.pollMs, remaining));
    }
  };

  try {
    const executor = drizzle(client, { schema });
    const transaction: TransactionRunner = async operation => {
      assertHealthy();
      try {
        return await withTransaction(async tx => {
          // Reject a proxy that switched backend sessions before BEGIN.
          const [session] = (await tx.execute<{ pid: number; held: number }>(VERIFY_SESSION)).rows;
          if (!session || session.pid !== backend || session.held !== held.length) {
            markLost();
            throw new ImportAdmissionError();
          }
          assertHealthy();
          return operation(tx);
        }, executor);
      } catch (error) {
        if (lost) throw new ImportAdmissionError();
        throw error;
      }
    };
    return await work({ acquire, transaction });
  } finally {
    active = false;
    for (const key of held.reverse()) {
      if (lost) break;
      const command = { text: UNLOCK, values: [key], query_timeout: LOCK_TIMEOUT_MS };
      try {
        const result = await client.query<{ released: boolean }>(command);
        if (result.rows[0]?.released !== true) discard = true;
      } catch {
        markLost();
      }
    }
    client.off("error", markLost);
    client.off("end", markLost);
    if (discard) logger.warn("Discarding an import admission connection with uncertain lock state");
    client.release(discard);
  }
}
