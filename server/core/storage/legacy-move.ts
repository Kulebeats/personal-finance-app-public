/**
 * Legacy upload move, with rollback (OPS-001, R15.3/R19.1).
 *
 * Before OPS-001 every upload was a plain file under `<cwd>/uploads`. This
 * copies each file a row still references into the ObjectStore and records a
 * manifest row (`moved_from_legacy_at` set) with its sha256. It never rewrites
 * a referencing row and never deletes a legacy file: the row's value already
 * names the object, so readers switch to the store the moment the manifest row
 * exists, and fall back to the legacy file again once it is gone.
 *
 * Rollback deletes the moved objects and their manifest rows (only rows this
 * move created). It first verifies each legacy file against the sha256, and
 * restores it from the object when it is missing or different, so it never
 * deletes the only copy.
 *
 * Each copied object is read back and its sha256 compared with the legacy
 * bytes before the manifest row is committed; the manifest row and its audit
 * row commit together (Rule 9). An attachment, or a receipt linked to a
 * transaction, on a private transaction or account is audited without
 * household scope, so its hash and size never reach household-wide audit
 * readers. Run it with the app stopped: a file deleted
 * while the move reads it is detected and rolled back, but a quiet window is
 * the simple guarantee.
 *
 * @module core/storage/legacy-move
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  auditLogs, goalImageUploads, merchantLogoUploads, merchants, pendingReceipts, storageObjects, transactionAttachments, transactions, users,
} from "@shared/schema";
import { db } from "../../db";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { logger } from "../../utils/logger";
import { isPrivateTransactionAudit } from "../../services/transaction/updateAudit";
import { businessAuditService } from "../../services/BusinessAuditService";
import { createStorageKey, hashStorageBytes, StorageError, validateStorageKey, type StorageKey, type StoragePurpose } from "../storage";
import { getObjectStore } from "./runtime";
import { isDefiniteRollback, LEGACY_UPLOADS_ROOT, nameMatchesOwner, rowCommitted, uploadNameOf } from "./upload-objects";
import { receiptIdOfName } from "./receipt-files";

/** One stored value a row references, with what the manifest needs to know. */
export interface LegacyReference {
  readonly stored: string;
  readonly householdId: string;
  readonly purpose: StoragePurpose;
  readonly mediaType: string;
  readonly source: string;
  /** An attachment's parent transaction: its name must sit under that transaction. */
  readonly transactionId?: string;
  /** A banner or picture's owner: the users row that names it, recorded as createdBy. */
  readonly userId?: string;
}

export interface MovedObject {
  readonly key: string;
  readonly name: string;
  readonly householdId: string;
  readonly purpose: StoragePurpose;
  readonly sha256: string;
  readonly size: number;
  readonly source: string;
}

export interface LegacyMoveReport {
  applied: boolean;
  moved: MovedObject[];
  /** Would be moved (dry run) — same shape without a key. */
  pending: Omit<MovedObject, "key">[];
  alreadyStored: number;
  missing: { name: string; source: string }[];
  refused: { source: string; reason: string }[];
}

const IMAGE_TYPE_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp",
};
const HOUSEHOLD_SEGMENT = /^(?:banners|profile-pictures)\/([0-9a-f-]{36})\//i;
const ATTACHMENT_TRANSACTION_SEGMENT = /^transactions\/([0-9a-f-]{36})\//i;
const RUN_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

/** Household scope for an audit row about a file of this transaction: null when it is private or cannot be found. */
async function transactionAuditScope(tx: TransactionType, transactionId: string, householdId: string): Promise<string | null> {
  const [transaction] = await tx.select().from(transactions)
    .where(and(eq(transactions.id, transactionId.toLowerCase()), eq(transactions.householdId, householdId))).limit(1);
  return transaction && !(await isPrivateTransactionAudit(tx, transaction)) ? householdId : null;
}

/**
 * The household scope of a storage_object audit row. An attachment takes its
 * transaction's privacy (the rule AttachmentService applies). A receipt file
 * takes the privacy of the receipt its name is bound to, which is its linked
 * transaction's and that account's (Rule 11); an unlinked receipt is
 * household-visible. A file whose transaction or receipt cannot be found is
 * treated as private, so its hash and size never reach household readers.
 */
async function auditHouseholdId(tx: TransactionType, object: { purpose: string; name: string; householdId: string }): Promise<string | null> {
  if (object.purpose === "attachment") {
    const transactionId = ATTACHMENT_TRANSACTION_SEGMENT.exec(object.name)?.[1];
    return transactionId ? transactionAuditScope(tx, transactionId, object.householdId) : null;
  }
  if (object.purpose !== "receipt" && object.purpose !== "receipt-thumbnail") return object.householdId;
  const receiptId = receiptIdOfName(object.name, object.purpose, object.householdId);
  if (!receiptId) return null;
  const [receipt] = await tx.select({ matchedTransactionId: pendingReceipts.matchedTransactionId }).from(pendingReceipts)
    .where(and(eq(pendingReceipts.id, receiptId), eq(pendingReceipts.householdId, object.householdId))).limit(1);
  if (!receipt) return null;
  return receipt.matchedTransactionId ? transactionAuditScope(tx, receipt.matchedTransactionId, object.householdId) : object.householdId;
}

function imageTypeOf(stored: string): string | null {
  return IMAGE_TYPE_BY_EXTENSION[path.extname(stored).toLowerCase()] ?? null;
}

async function userImageReferences(): Promise<LegacyReference[]> {
  const rows = await db.select({ userId: users.id, bannerUrl: users.bannerUrl, pictureUrl: users.profilePictureUrl }).from(users)
    .where(sql`${users.bannerUrl} IS NOT NULL OR ${users.profilePictureUrl} IS NOT NULL`);
  const references: LegacyReference[] = [];
  for (const row of rows) {
    for (const [stored, purpose, source] of [[row.bannerUrl, "banner", "users.banner_url"], [row.pictureUrl, "profile-picture", "users.profile_picture_url"]] as const) {
      const householdId = stored ? HOUSEHOLD_SEGMENT.exec(uploadNameOf(stored) ?? "")?.[1] : undefined;
      const mediaType = stored ? imageTypeOf(stored) : null;
      if (stored && householdId && mediaType) references.push({ stored, householdId: householdId.toLowerCase(), purpose, mediaType, source, userId: row.userId });
    }
  }
  return references;
}

/** Every stored upload value the database references today. */
export async function findLegacyReferences(): Promise<LegacyReference[]> {
  const goals = (await db.select().from(goalImageUploads)).map((row): LegacyReference =>
    ({ stored: row.filePath, householdId: row.householdId, purpose: "goal-image", mediaType: row.mimeType, source: "goal_image_uploads.file_path" }));
  const logos = (await db.select({ filePath: merchantLogoUploads.filePath, householdId: merchants.householdId }).from(merchantLogoUploads)
    .innerJoin(merchants, eq(merchants.id, merchantLogoUploads.merchantId)).where(isNotNull(merchants.householdId)))
    .map((row): LegacyReference => ({ stored: row.filePath, householdId: row.householdId!, purpose: "merchant-logo", mediaType: "image/png", source: "merchant_logo_uploads.file_path" }));
  const receipts = (await db.select().from(pendingReceipts)).flatMap((row): LegacyReference[] => [
    { stored: row.storagePath, householdId: row.householdId, purpose: "receipt", mediaType: row.mimeType, source: "pending_receipts.storage_path" },
    ...(row.thumbnailPath ? [{ stored: row.thumbnailPath, householdId: row.householdId, purpose: "receipt-thumbnail" as const, mediaType: "image/jpeg", source: "pending_receipts.thumbnail_path" }] : []),
  ]);
  const attachments = (await db.select({ row: transactionAttachments, householdId: transactions.householdId }).from(transactionAttachments)
    .innerJoin(transactions, eq(transactions.id, transactionAttachments.transactionId)))
    .flatMap(({ row, householdId }): LegacyReference[] => [
      { stored: row.storagePath, householdId, purpose: "attachment", mediaType: row.mimeType, source: "transaction_attachments.storage_path", transactionId: row.transactionId },
      ...(row.thumbnailPath ? [{ stored: row.thumbnailPath, householdId, purpose: "attachment" as const, mediaType: "image/jpeg",
        source: "transaction_attachments.thumbnail_path", transactionId: row.transactionId }] : []),
    ]);
  return [...await userImageReferences(), ...goals, ...logos, ...receipts, ...attachments];
}

async function readLegacyFile(name: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(LEGACY_UPLOADS_ROOT, ...name.split("/")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Copy one legacy file into the store; null when another writer recorded it first. */
async function moveOne(reference: LegacyReference, name: string, bytes: Buffer, runId?: string): Promise<MovedObject | null> {
  const store = getObjectStore();
  const key = createStorageKey(reference.purpose);
  const metadata = await store.put({ key, bytes, mediaType: reference.mediaType });
  const sha256 = hashStorageBytes(bytes);
  try {
    const readBack = await store.get(key);
    if (readBack.metadata.sha256 !== sha256 || metadata.sha256 !== sha256) throw new StorageError("INTEGRITY");
  } catch (error) {
    await store.delete(key).catch(() => undefined);
    throw error;
  }
  try {
    const inserted = await withTransaction(async (tx) => {
      const [row] = await tx.insert(storageObjects).values({
        key, uploadName: name, householdId: reference.householdId, purpose: reference.purpose, sha256, size: bytes.length,
        mediaType: reference.mediaType, movedFromLegacyAt: new Date(), createdBy: reference.userId ?? null,
      }).onConflictDoNothing({ target: storageObjects.uploadName }).returning({ key: storageObjects.key });
      if (!row) return false;
      await businessAuditService.logCreate({
        tx, userId: null, householdId: await auditHouseholdId(tx, { ...reference, name }), entityType: "storage_object", entityId: key.slice(-36),
        newValue: { purpose: reference.purpose, sha256, size: bytes.length },
        metadata: { operation: "legacy_move", source: reference.source, ...(runId && { legacyMoveRunId: runId, legacyMoveKey: key }) },
      });
      return true;
    });
    if (!inserted) {
      await store.delete(key);
      return null;
    }
  } catch (error) {
    if (isDefiniteRollback(error)) {
      await store.delete(key).catch(() => undefined);
      throw error;
    }
    // A lost COMMIT acknowledgement: the manifest may name this object. Reconcile by key.
    if (!(await rowCommitted(() => manifestKeyExists(key)))) {
      logger.error("Legacy move outcome unknown; the object is kept for the orphan sweep", { objectKey: key, uploadName: name });
      throw error;
    }
  }
  return { key, name, householdId: reference.householdId, purpose: reference.purpose, sha256, size: bytes.length, source: reference.source };
}

async function manifestKeyExists(key: StorageKey): Promise<boolean> {
  return (await db.select({ key: storageObjects.key }).from(storageObjects).where(eq(storageObjects.key, key)).limit(1)).length > 0;
}

/** Owner fields that must agree for every row naming one file. */
function ownerSignature(reference: LegacyReference): string {
  return [reference.purpose, reference.householdId.toLowerCase(), reference.transactionId?.toLowerCase() ?? "", reference.userId ?? ""].join("|");
}

/**
 * The references keyed by logical name, each one consistent owner. Refused: a
 * name outside its owner's folder, or rows that disagree on who owns one file.
 */
function ownersByName(references: readonly LegacyReference[], report: LegacyMoveReport): Map<string, LegacyReference> {
  const groups = new Map<string, LegacyReference[]>();
  for (const reference of references) {
    const name = uploadNameOf(reference.stored);
    if (!name) { report.refused.push({ source: reference.source, reason: "outside the uploads root" }); continue; }
    if (!nameMatchesOwner(name, reference)) { report.refused.push({ source: reference.source, reason: "outside its owner's folder" }); continue; }
    groups.set(name, [...(groups.get(name) ?? []), reference]);
  }
  const owners = new Map<string, LegacyReference>();
  for (const [name, group] of groups) {
    if (new Set(group.map(ownerSignature)).size > 1) {
      for (const reference of group) report.refused.push({ source: reference.source, reason: "rows disagree on the owner" });
      continue;
    }
    owners.set(name, group[0]);
  }
  return owners;
}

/**
 * Read membership from the CREATE audit committed with the manifest. A key
 * whose manifest is gone stays eligible to retry an interrupted rollback.
 */
async function readMoveJournal(runId: string): Promise<Map<string, MovedObject | null>> {
  if (!RUN_ID.test(runId)) throw new Error("Invalid legacy move run id");
  const records = await db.select({ entityId: auditLogs.entityId, details: auditLogs.details, manifest: storageObjects })
    .from(auditLogs)
    .leftJoin(storageObjects, sql`${storageObjects.key} = (${auditLogs.details}->>'legacyMoveKey')`)
    .where(and(
      eq(auditLogs.entityType, "storage_object"), eq(auditLogs.action, "CREATE"),
      sql`${auditLogs.details}->>'operation' = 'legacy_move'`,
      sql`${auditLogs.details}->>'legacyMoveRunId' = ${runId}`,
    ));
  const journal = new Map<string, MovedObject | null>();
  for (const { entityId, details, manifest } of records) {
    const entry = details as { legacyMoveKey?: unknown; source?: unknown; newValue?: { purpose?: unknown; sha256?: unknown; size?: unknown } };
    const { legacyMoveKey: key, source, newValue } = entry;
    validateStorageKey(key);
    const purpose = key.split("/")[1] as StoragePurpose;
    const sha256 = newValue?.sha256;
    const size = newValue?.size;
    if (entityId !== key.slice(-36) || journal.has(key) || typeof source !== "string"
      || newValue?.purpose !== purpose || typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)
      || typeof size !== "number" || !Number.isInteger(size) || size <= 0) {
      throw new Error("Invalid legacy move journal entry");
    }
    if (manifest && (!manifest.movedFromLegacyAt || manifest.purpose !== purpose || manifest.sha256 !== sha256 || manifest.size !== size)) {
      throw new Error("Legacy move journal conflicts with its manifest");
    }
    journal.set(key, manifest ? { key, name: manifest.uploadName, householdId: manifest.householdId, purpose, sha256, size, source } : null);
  }
  return journal;
}

/** `runId` binds each applied move to an operator report that can be recovered after interruption. */
export async function moveLegacyUploads(options: { apply: boolean; householdIds?: readonly string[]; runId?: string }): Promise<LegacyMoveReport> {
  const only = options.householdIds ? new Set(options.householdIds.map((id) => id.toLowerCase())) : null;
  const journal = options.apply && options.runId !== undefined ? await readMoveJournal(options.runId) : null;
  const movedEarlier = [...(journal?.values() ?? [])]
    .filter((entry): entry is MovedObject => entry !== null && (!only || only.has(entry.householdId.toLowerCase())));
  const report: LegacyMoveReport = { applied: options.apply, moved: movedEarlier, pending: [], alreadyStored: 0, missing: [], refused: [] };
  const references = (await findLegacyReferences()).filter((reference) => !only || only.has(reference.householdId.toLowerCase()));
  for (const [name, reference] of ownersByName(references, report)) {
    const [existing] = await db.select({ key: storageObjects.key, householdId: storageObjects.householdId, purpose: storageObjects.purpose })
      .from(storageObjects).where(eq(storageObjects.uploadName, name)).limit(1);
    if (existing && (existing.householdId.toLowerCase() !== reference.householdId.toLowerCase() || existing.purpose !== reference.purpose)) {
      report.refused.push({ source: reference.source, reason: "recorded for another owner" });
      continue;
    }
    if (existing) {
      if (!journal?.has(existing.key)) report.alreadyStored++;
      continue;
    }
    const bytes = await readLegacyFile(name);
    if (!bytes || bytes.length === 0) { report.missing.push({ name, source: reference.source }); continue; }
    const entry = { name, householdId: reference.householdId, purpose: reference.purpose, sha256: hashStorageBytes(bytes), size: bytes.length, source: reference.source };
    if (!options.apply) { report.pending.push(entry); continue; }
    const moved = await moveOne(reference, name, bytes, options.runId);
    if (!moved) { report.alreadyStored++; continue; }
    if (!(await readLegacyFile(name))) {
      // Deleted while it was being moved: undo this entry so no orphan copy survives.
      await rollbackLegacyMove([moved.key]);
      report.missing.push({ name, source: reference.source });
      continue;
    }
    report.moved.push(moved);
  }
  return report;
}

type ManifestRow = typeof storageObjects.$inferSelect;

/**
 * Make sure the legacy file holds the moved bytes before the object goes.
 * After the hygiene pull deleted the tracked originals, the object may be the
 * only copy: a missing or different legacy file is restored from the object
 * (itself checked against the manifest sha256) and read back. Returns false,
 * deleting nothing, when the object cannot be read intact.
 */
async function ensureLegacyCopy(row: ManifestRow, key: StorageKey): Promise<"present" | "restored" | false> {
  const legacy = await readLegacyFile(row.uploadName);
  if (legacy && hashStorageBytes(legacy) === row.sha256) return "present";
  let bytes: Buffer;
  try {
    bytes = Buffer.from((await getObjectStore().get(key)).bytes);
  } catch {
    return false;
  }
  if (hashStorageBytes(bytes) !== row.sha256) return false;
  const file = path.join(LEGACY_UPLOADS_ROOT, ...row.uploadName.split("/"));
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.restore`;
  await fs.writeFile(temporary, bytes, { flag: "wx" });
  await fs.rename(temporary, file);
  const restored = await readLegacyFile(row.uploadName);
  return restored && hashStorageBytes(restored) === row.sha256 ? "restored" : false;
}

export interface LegacyRollbackResult {
  readonly removed: number;
  readonly restored: number;
  readonly refused: string[];
  readonly skipped: number;
  /** Report keys with no manifest row left whose object delete was retried. */
  readonly retried: number;
  /** Keys whose manifest row is gone but whose object delete failed: rerun. */
  readonly pendingCleanup: string[];
}

/** Undo the exact committed entries of an interrupted or completed report. */
export async function rollbackLegacyMoveRun(runId: string): Promise<LegacyRollbackResult> {
  const journal = await readMoveJournal(runId);
  return rollbackLegacyMove([...journal.keys()]);
}

/**
 * Undo a move: delete the objects and manifest rows it created (`keys` from
 * its report). Rows a move did not create are skipped. Each legacy file is
 * verified, or restored from the object, before its object is deleted, so a
 * rollback never removes the only copy; a row whose bytes cannot be secured is
 * refused and kept.
 *
 * The manifest row goes before its object, so a failed object delete leaves an
 * unreferenced object, listed in `pendingCleanup`. Rerunning with the same
 * report retries it: a report key with no manifest row left is an object that
 * nothing references (its legacy copy was secured before the row went), and
 * its delete is idempotent.
 */
export async function rollbackLegacyMove(keys: readonly string[]): Promise<LegacyRollbackResult> {
  for (const key of keys) validateStorageKey(key);
  const unique = [...new Set(keys)] as StorageKey[];
  if (!unique.length) return { removed: 0, restored: 0, refused: [], skipped: 0, retried: 0, pendingCleanup: [] };
  const present = await db.select().from(storageObjects).where(inArray(storageObjects.key, unique));
  const rows = present.filter((row) => row.movedFromLegacyAt !== null);
  const recorded = new Set(present.map((row) => row.key));
  let removed = 0;
  let restored = 0;
  let retried = 0;
  const refused: string[] = [];
  const pendingCleanup: string[] = [];
  const deleteObject = async (key: StorageKey): Promise<boolean> => {
    try {
      await getObjectStore().delete(key);
      return true;
    } catch (error) {
      logger.error("Legacy move rollback could not delete an object; rerun the rollback", {
        objectKey: key, code: error instanceof StorageError ? error.code : "UNKNOWN",
      });
      pendingCleanup.push(key);
      return false;
    }
  };
  for (const key of unique.filter((candidate) => !recorded.has(candidate))) {
    if (await deleteObject(key)) retried++;
  }
  for (const row of rows) {
    const key = row.key as StorageKey;
    validateStorageKey(key);
    const copy = await ensureLegacyCopy(row, key);
    if (!copy) { refused.push(key); continue; }
    if (copy === "restored") restored++;
    // Manifest row first: readers fall back to the legacy file at once, and a
    // failed object delete leaves only an unreferenced object, never a dangling row.
    await withTransaction(async (tx) => {
      await tx.delete(storageObjects).where(eq(storageObjects.key, key));
      await businessAuditService.logDelete({
        tx, userId: null, householdId: await auditHouseholdId(tx, { purpose: row.purpose, name: row.uploadName, householdId: row.householdId }),
        entityType: "storage_object", entityId: key.slice(-36),
        oldValue: { purpose: row.purpose, sha256: row.sha256, size: row.size }, metadata: { operation: "legacy_move_rollback" },
      });
    });
    if (await deleteObject(key)) removed++;
  }
  return { removed, restored, refused, skipped: present.length - rows.length, retried, pendingCleanup };
}
