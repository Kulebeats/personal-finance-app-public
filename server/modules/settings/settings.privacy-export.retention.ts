/**
 * Personal-data export retention (R07.1, AH-08 P1-4; scheduled job
 * cleanup.personal-exports).
 *
 * - A ready export past PERSONAL_EXPORT_RETENTION_DAYS is retired in its own
 *   transaction: the row is locked and re-checked, marked `expired`, a DELETE
 *   audit row is written, and the file is removed inside the transaction, so a
 *   failed unlink rolls the row and the audit back for the next run.
 * - A file no ready personal export owns (an erasure whose post-commit removal
 *   failed, a crash after the write, a retired export) is removed once it is
 *   older than the grace period; a younger file may belong to an export being
 *   created right now. No audit row: no live export owns such a file.
 *
 * Logs counts only, never ids or contents.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { dataExports } from "@shared/schema";
import { PERSONAL_EXPORT_TYPE } from "@shared/personal-data-export";
import { db } from "../../db";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { businessAuditService } from "../../services/BusinessAuditService";
import { logger } from "../../utils/logger";
import { PERSONAL_EXPORT_RETENTION_DAYS } from "./settings.privacy-export.service";
import { listPersonalExportFiles, removePersonalExportFile } from "./settings.privacy-export.files";

const JOB = "personal-export-cleanup";
/** Files younger than this are never treated as orphans. */
const ORPHAN_GRACE_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;
/** Upper bound on exports retired, and on files checked, per run; the rest wait for the next run. */
const BATCH_LIMIT = 500;

export type PersonalExportSweepSummary = {
  readonly expired: number;
  readonly orphansRemoved: number;
  readonly failed: number;
};

const isPastRetention = sql`${dataExports.createdAt} <= now() - make_interval(days => ${PERSONAL_EXPORT_RETENTION_DAYS})`;
const isLivePersonalExport = and(eq(dataExports.exportType, PERSONAL_EXPORT_TYPE), eq(dataExports.status, "ready"));

function errorCode(error: unknown): string {
  return (error as NodeJS.ErrnoException | null)?.code ?? "UNKNOWN";
}

async function findExpired(): Promise<string[]> {
  const rows = await db.select({ id: dataExports.id }).from(dataExports)
    .where(and(isLivePersonalExport, isPastRetention))
    .orderBy(asc(dataExports.createdAt)).limit(BATCH_LIMIT);
  return rows.map(row => row.id);
}

/** Retire one export; false when another run or a deletion got there first. */
async function expireOne(tx: TransactionType, exportId: string): Promise<boolean> {
  const [row] = await tx.select({ userId: dataExports.userId }).from(dataExports)
    .where(and(eq(dataExports.id, exportId), isLivePersonalExport, isPastRetention)).for("update");
  if (!row) return false;
  await tx.update(dataExports).set({ status: "expired" }).where(eq(dataExports.id, exportId));
  await businessAuditService.log({
    tx, userId: row.userId, householdId: null, action: "DELETE", entityType: "data_export", entityId: exportId,
    details: { exportType: PERSONAL_EXPORT_TYPE, reason: "retention", retentionDays: PERSONAL_EXPORT_RETENTION_DAYS, job: JOB },
  });
  await removePersonalExportFile(exportId);
  return true;
}

async function removeOrphanFiles(): Promise<{ removed: number; failed: number }> {
  const cutoff = Date.now() - ORPHAN_GRACE_HOURS * HOUR_MS;
  const candidates = (await listPersonalExportFiles())
    .filter(file => file.modifiedAt.getTime() < cutoff).slice(0, BATCH_LIMIT).map(file => file.exportId);
  if (candidates.length === 0) return { removed: 0, failed: 0 };
  const live = await db.select({ id: dataExports.id }).from(dataExports)
    .where(and(inArray(dataExports.id, candidates), isLivePersonalExport));
  const liveIds = new Set(live.map(row => row.id.toLowerCase()));
  let removed = 0;
  let failed = 0;
  for (const exportId of candidates.filter(id => !liveIds.has(id))) {
    try {
      await removePersonalExportFile(exportId);
      removed++;
    } catch (error) {
      failed++;
      logger.error("Personal export sweep could not remove an orphan file", { job: JOB, errorCode: errorCode(error) });
    }
  }
  return { removed, failed };
}

/** Expire exports past retention, then remove files no ready export owns. */
export async function sweepPersonalExports(): Promise<PersonalExportSweepSummary> {
  let expired = 0;
  let failed = 0;
  for (const exportId of await findExpired()) {
    try {
      if (await withTransaction(tx => expireOne(tx, exportId))) expired++;
    } catch (error) {
      failed++;
      logger.error("Personal export sweep could not retire an export", { job: JOB, errorCode: errorCode(error) });
    }
  }
  const orphans = await removeOrphanFiles();
  const summary = { expired, orphansRemoved: orphans.removed, failed: failed + orphans.failed };
  logger.info("Personal export sweep completed", { job: JOB, ...summary });
  return summary;
}
