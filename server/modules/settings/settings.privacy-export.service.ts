/**
 * Personal-data export service (R07.1, AH-08; DPA right of access).
 *
 * Create: one REPEATABLE READ transaction re-checks the requester's
 * membership, reads one consistent snapshot, inserts the `data_exports` row
 * with its manifest (`parameters`: version, household, sha256, size, section
 * counts, source ids) and the audit row, then writes the file as the last step
 * before commit. A failed write rolls the row and audit back; a failed write or
 * commit removes the file. Since version 2 (A-27) the file is one ZIP holding
 * the JSON document and a CSV per section; an archive the format cannot hold
 * is refused before anything is written.
 *
 * The row and its audit rows carry no household id (the household is in the
 * manifest), so household owners and admins never see a member's personal
 * export through the household-scoped report exports.
 *
 * Download: only the requester's own ready, unexpired, intact export, and only
 * while they can still read its household and each captured source
 * (settings.privacy-export.recheck.ts). A version 1 JSON export still downloads
 * as JSON. The egress audit row is written before any byte is released; no
 * audit, no bytes.
 */
import { randomUUID, createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { dataExports, householdMembers } from "@shared/schema";
import { db } from "../../db";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { HttpError, NotFoundError } from "../../core/errors";
import { asStorageFailure, assertPersonalExportStorage } from "./settings.privacy-export.storage";
import { can } from "../../core/authz/capabilities";
import { businessAuditService } from "../../services/BusinessAuditService";
import { logger } from "../../utils/logger";
import type { HouseholdContext } from "../../middleware/householdGuard";
import {
  PERSONAL_EXPORT_JSON_ENTRY, PERSONAL_EXPORT_TYPE, type PersonalExportItem, type PersonalExportStatus,
} from "@shared/personal-data-export";
import { collectPersonalData, PERSONAL_EXPORT_VERSION } from "./settings.privacy-export.data";
import {
  isPersonalExportFileFormat, readPersonalExportFile, removePersonalExportFile, writePersonalExportFile,
  type PersonalExportFileFormat,
} from "./settings.privacy-export.files";
import { buildStoredZip } from "./settings.privacy-export.archive";
import { buildCsvEntries } from "./settings.privacy-export.csv";
import {
  isStillReadable, readManifest, type HouseholdRole, type PersonalExportManifest,
} from "./settings.privacy-export.recheck";

const FILE_FORMAT: PersonalExportFileFormat = "zip";
const CONTENT_TYPES: Record<PersonalExportFileFormat, string> = {
  zip: "application/zip",
  json: "application/json; charset=utf-8",
};
/** Days a ready export stays downloadable. */
export const PERSONAL_EXPORT_RETENTION_DAYS = 7;

export class ExportExpiredError extends HttpError {
  readonly statusCode = 410;
  readonly code = "EXPORT_EXPIRED";
  constructor() { super("This export has expired. Request a new one."); }
}

export function personalExportDownloadUrl(exportId: string): string {
  return `/api/settings/privacy/exports/${exportId}/download`;
}

const listColumns = {
  id: dataExports.id, status: dataExports.status, fileFormat: dataExports.fileFormat,
  recordCount: dataExports.recordCount, parameters: dataExports.parameters,
  // Computed in SQL so the column's time zone handling never shifts expiry.
  createdAt: sql<string | null>`to_char(${dataExports.createdAt}::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
  expiresAt: sql<string | null>`to_char((${dataExports.createdAt}::timestamptz + make_interval(days => ${PERSONAL_EXPORT_RETENTION_DAYS})) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
  isExpired: sql<boolean>`${dataExports.createdAt} <= now() - make_interval(days => ${PERSONAL_EXPORT_RETENTION_DAYS})`,
};
type ExportRow = { id: string; status: string | null; fileFormat: string; recordCount: number | null;
  parameters: unknown; createdAt: string | null; expiresAt: string | null; isExpired: boolean };

function statusOf(row: ExportRow, manifest: PersonalExportManifest | null): PersonalExportStatus {
  // Retired by the retention sweep (its file is gone).
  if (row.status === "expired") return "expired";
  if (row.status !== "ready" || !manifest || !isPersonalExportFileFormat(row.fileFormat)) return "failed";
  if (row.isExpired) return "expired";
  return "ready";
}

function toItem(
  row: ExportRow, manifest: PersonalExportManifest | null, status = statusOf(row, manifest),
): PersonalExportItem {
  return {
    id: row.id, status, fileFormat: row.fileFormat, createdAt: row.createdAt, expiresAt: row.expiresAt,
    sizeBytes: manifest?.sizeBytes ?? null, recordCount: row.recordCount, sections: manifest?.sections ?? null,
    downloadUrl: status === "ready" ? personalExportDownloadUrl(row.id) : null,
  };
}

/** Households whose financial data the user can currently read, with the role they read it as. */
async function readableHouseholds(tx: TransactionType, userId: string, lock: boolean): Promise<Map<string, HouseholdRole>> {
  const query = tx.select({ householdId: householdMembers.householdId, role: householdMembers.role })
    .from(householdMembers).where(eq(householdMembers.userId, userId));
  const memberships = lock ? await query.for("share") : await query;
  return new Map(memberships.filter(m => m.householdId && can(m.role, "financial.read")).map(m => [m.householdId!, m.role]));
}

/** The requester's current membership, locked so it cannot change mid-export. */
async function lockMembership(tx: TransactionType, userId: string, householdId?: string): Promise<HouseholdContext | null> {
  if (!householdId) return null;
  const [membership] = await tx.select({ role: householdMembers.role }).from(householdMembers)
    .where(and(eq(householdMembers.userId, userId), eq(householdMembers.householdId, householdId))).for("share");
  return membership ? { userId, householdId, role: membership.role } : null;
}

export async function createPersonalExport(input: {
  userId: string;
  householdId?: string;
  ipAddress?: string;
}): Promise<PersonalExportItem> {
  await assertPersonalExportStorage();
  const exportId = randomUUID();
  let fileAttempted = false;
  try {
    // REPEATABLE READ: every section reads the same snapshot, so counts and
    // balances in one file agree with each other.
    return await db.transaction(async (tx) => {
      const actor = await lockMembership(tx, input.userId, input.householdId);
      const { document, sections, sources } = await collectPersonalData(tx, input.userId, actor);
      // Built whole in memory: a refused archive throws here, before any row or file.
      const bytes = buildStoredZip([
        { name: PERSONAL_EXPORT_JSON_ENTRY, data: Buffer.from(JSON.stringify(document, null, 2), "utf8") },
        ...buildCsvEntries(document),
      ]);
      const householdId = actor?.householdId ?? null;
      const manifest: PersonalExportManifest = {
        kind: PERSONAL_EXPORT_TYPE, version: PERSONAL_EXPORT_VERSION, householdId,
        sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length,
        sections, ...sources,
      };
      const recordCount = Object.values(sections).reduce((sum, count) => sum + (count ?? 0), 0);
      await tx.insert(dataExports).values({
        id: exportId, userId: input.userId, householdId: null,
        exportType: PERSONAL_EXPORT_TYPE, fileFormat: FILE_FORMAT, fileUrl: personalExportDownloadUrl(exportId),
        recordCount, parameters: manifest, status: "ready",
      });
      // Private (household-less) audit; counts and checksum only, never the data.
      await businessAuditService.log({
        tx, userId: input.userId, householdId: null, action: "CREATE",
        entityType: "data_export", entityId: exportId,
        details: { exportType: PERSONAL_EXPORT_TYPE, fileFormat: FILE_FORMAT, sourceHouseholdId: householdId,
          recordCount, sections, sha256: manifest.sha256, sizeBytes: manifest.sizeBytes },
        ipAddress: input.ipAddress,
      });
      fileAttempted = true;
      await writePersonalExportFile(exportId, bytes, FILE_FORMAT);
      const [row] = await tx.select(listColumns).from(dataExports).where(eq(dataExports.id, exportId));
      return toItem(row, manifest);
    }, { isolationLevel: "repeatable read" });
  } catch (error) {
    // A partial file from a failed write is removed too (missing is fine).
    if (fileAttempted) {
      await removePersonalExportFile(exportId).catch((cleanupError: unknown) => {
        logger.error("Failed to remove an uncommitted personal export file", { exportId },
          cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)));
      });
    }
    throw fileAttempted ? asStorageFailure(error) : error;
  }
}

export async function listPersonalExports(userId: string): Promise<PersonalExportItem[]> {
  return db.transaction(async (tx) => {
    const rows = await tx.select(listColumns).from(dataExports)
      .where(and(eq(dataExports.userId, userId), eq(dataExports.exportType, PERSONAL_EXPORT_TYPE)))
      .orderBy(desc(dataExports.createdAt), desc(dataExports.id));
    let readable: ReadonlyMap<string, HouseholdRole> | undefined;
    const items: PersonalExportItem[] = [];
    for (const row of rows) {
      const manifest = readManifest(row.parameters);
      let status = statusOf(row, manifest);
      if (status === "ready" && manifest?.householdId) {
        readable ??= await readableHouseholds(tx, userId, false);
        if (!await isStillReadable(tx, userId, manifest, readable, false)) status = "revoked";
      }
      items.push(toItem(row, manifest, status));
    }
    return items;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

async function readIntactFile(exportId: string, format: PersonalExportFileFormat, sha256: string): Promise<Buffer> {
  let bytes: Buffer;
  try {
    bytes = await readPersonalExportFile(exportId, format);
  } catch (error) {
    logger.error("Personal export file unreadable", { exportId }, error instanceof Error ? error : new Error(String(error)));
    throw new NotFoundError("Export not found");
  }
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
    logger.error("Personal export file failed its checksum", { exportId });
    throw new NotFoundError("Export not found");
  }
  return bytes;
}

/**
 * The file bytes for the requester's own ready, unexpired, intact export, only
 * while they can still read its household. Writes the egress audit row first;
 * if it fails, nothing is returned.
 */
export async function releasePersonalExport(
  userId: string,
  exportId: string,
  ipAddress?: string,
): Promise<{ bytes: Buffer; fileName: string; contentType: string }> {
  return withTransaction(async (tx) => {
    const [row] = await tx.select(listColumns).from(dataExports).where(and(
      eq(dataExports.id, exportId), eq(dataExports.userId, userId), eq(dataExports.exportType, PERSONAL_EXPORT_TYPE),
    ));
    const manifest = row ? readManifest(row.parameters) : null;
    if (!row || !manifest) throw new NotFoundError("Export not found");
    const status = statusOf(row, manifest);
    if (status === "expired") throw new ExportExpiredError();
    if (status !== "ready" || !isPersonalExportFileFormat(row.fileFormat)) throw new NotFoundError("Export not found");
    const format = row.fileFormat;
    if (manifest.householdId) {
      const readable = await readableHouseholds(tx, userId, true);
      if (!await isStillReadable(tx, userId, manifest, readable, true)) throw new NotFoundError("Export not found");
    }
    const bytes = await readIntactFile(exportId, format, manifest.sha256);
    await businessAuditService.log({
      tx, userId, householdId: null, action: "PROCESS", entityType: "data_export", entityId: exportId,
      details: { event: "download", exportType: PERSONAL_EXPORT_TYPE, sourceHouseholdId: manifest.householdId,
        sha256: manifest.sha256, sizeBytes: bytes.length },
      ipAddress,
    });
    return { bytes, fileName: `personal-data-export-${exportId}.${format}`, contentType: CONTENT_TYPES[format] };
  });
}
