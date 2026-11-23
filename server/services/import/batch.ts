/**
 * NEW-17 import history: one `data_imports` row per import, written inside the
 * import transaction, and the batch-id replay contract.
 */
import { dataImports } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { ConflictError } from "../../core/errors";
import type { TransactionType } from "../../utils/withTransaction";
import { logger } from "../../utils/logger";
import type { ExecuteImportResult, ImportRowError, ImportRowOutcomeRecord } from "./types";

type DataImport = typeof dataImports.$inferSelect;

const DEFAULT_FILE_NAME = "import.csv";
const MAX_FILE_NAME = 255;

/**
 * Read the recorded outcome after admission has acquired the batch key.
 * The batch key stays held while the caller decides whether to post.
 */
export async function readImportBatchForUpdate(tx: TransactionType, householdId: string, batchKey: string): Promise<DataImport | undefined> {
  const [row] = await tx.select().from(dataImports)
    .where(and(eq(dataImports.householdId, householdId), eq(dataImports.batchKey, batchKey)))
    .limit(1).for("update");
  return row;
}

function readStoredErrors(row: DataImport): ImportRowError[] {
  if (!row.errorLog) return [];
  try {
    const parsed: unknown = JSON.parse(row.errorLog);
    return Array.isArray(parsed) ? parsed as ImportRowError[] : [];
  } catch (error) {
    logger.warn("Stored import error log is not JSON; replaying without row errors", { importId: row.id, error });
    return [];
  }
}

/** Same batch id: same content returns the recorded outcome; anything else is a 409. */
export function replayImportBatch(row: DataImport, fingerprint: string, userId: string): ExecuteImportResult {
  if (row.fingerprint !== fingerprint || row.userId !== userId) {
    throw new ConflictError("This import batch was already submitted with different content", row.id);
  }
  return {
    importId: row.id, replayed: true,
    imported: row.importedCount, duplicate: row.duplicateCount, skipped: row.skippedCount,
    failed: row.failedCount ?? 0, deleted: row.deletedCount, errors: readStoredErrors(row),
  };
}

export interface ImportBatchRecord {
  householdId: string;
  userId: string;
  accountId: string;
  source: "global_csv" | "account_csv";
  identityVersion: string;
  fingerprint: string;
  batchKey?: string;
  strategy: string;
  fileName?: string;
  recordCount: number;
  counts: { imported: number; duplicate: number; skipped: number; failed: number; deleted: number };
  errors: ImportRowError[];
  outcomes: ImportRowOutcomeRecord[];
  /** completed by default; partial/failed for an account import that stopped part-way. */
  status?: "completed" | "partial" | "failed";
}

export async function recordImportBatch(tx: TransactionType, record: ImportBatchRecord): Promise<string> {
  const completedAt = new Date();
  const [row] = await tx.insert(dataImports).values({
    householdId: record.householdId, userId: record.userId, accountId: record.accountId,
    source: record.source, identityVersion: record.identityVersion, fingerprint: record.fingerprint,
    batchKey: record.batchKey ?? null, strategy: record.strategy,
    fileName: (record.fileName?.trim() || DEFAULT_FILE_NAME).slice(0, MAX_FILE_NAME),
    recordCount: record.recordCount,
    successfulCount: record.counts.imported, failedCount: record.counts.failed,
    importedCount: record.counts.imported, duplicateCount: record.counts.duplicate,
    skippedCount: record.counts.skipped, deletedCount: record.counts.deleted,
    status: record.status ?? "completed", errorLog: record.errors.length ? JSON.stringify(record.errors) : null,
    rowOutcomes: [...record.outcomes].sort((a, b) => a.ordinal - b.ordinal),
    completedAt,
  }).returning({ id: dataImports.id });
  return row.id;
}
