/**
 * Uploaded files through the ObjectStore, with a manifest (OPS-001).
 *
 * Every upload writer used to write under `<cwd>/uploads`, the container's
 * ephemeral disk. Writers now hand their bytes here. The referencing row keeps
 * the value it always stored (a URL `/uploads/banners/{hh}/{file}`, a path
 * `uploads/receipts/{hh}/{file}` or an absolute path inside uploads/), and that
 * value's logical name (`banners/{hh}/{file}`) maps through `storage_objects`
 * to an opaque store key, the household, sha256, size and media type.
 *
 * Reads re-check the manifest household and the sha256 before returning bytes.
 * A name with no manifest row is a legacy file still on the old uploads/ disk:
 * it is read from there (inside the uploads root only) until
 * `legacy-move.ts` copies it into the store.
 *
 * Callers still authorize the parent row before every read.
 *
 * @module core/storage/upload-objects
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { eq, sql } from "drizzle-orm";
import { DatabaseError } from "pg";
import { storageObjects } from "@shared/schema";
import { db } from "../../db";
import { HttpError } from "../errors";
import { logger } from "../../utils/logger";
import { createStorageKey, StorageError, validateStorageKey, type ObjectStore, type StorageKey, type StoragePurpose } from "../storage";
import { getObjectStore } from "./runtime";

/** Root the legacy writers used; the logical names are relative to it. */
export const LEGACY_UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const NAME_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** Windows device names, alone or with an extension ("nul", "COM1.png"). */
const RESERVED_DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

/**
 * One plain file or directory name, with one spelling on every disk. Windows
 * drops a trailing "." or " " ("id.png." opens "id.png"), reads "name:stream"
 * as an alternate data stream and maps device names to devices, so each of
 * those would reach a file other than the one the manifest names.
 */
export function isSafeUploadSegment(segment: string): boolean {
  return NAME_SEGMENT.test(segment) && !segment.endsWith(".") && !RESERVED_DEVICE.test(segment);
}

type Executor = Pick<typeof db, "select" | "insert" | "delete">;

/** A stored file the store could not provide: 503 when it is down, 500 when its bytes fail the checksum. */
export class UploadStorageError extends HttpError {
  readonly statusCode: number;
  readonly code: string;
  constructor(readonly storageCode: StorageError["code"]) {
    super(storageCode === "INTEGRITY" ? "The stored file failed its integrity check" : "File storage is temporarily unavailable");
    this.statusCode = storageCode === "INTEGRITY" ? 500 : 503;
    this.code = storageCode === "INTEGRITY" ? "STORAGE_INTEGRITY" : "STORAGE_UNAVAILABLE";
  }
}

function storageFailure(error: unknown, operation: string): UploadStorageError {
  const code = error instanceof StorageError ? error.code : "UNAVAILABLE";
  logger.error("Upload storage operation failed", { operation, code });
  return new UploadStorageError(code);
}

/**
 * The logical name (`{type}/{...}`, forward slashes) of a stored upload value,
 * or null when it does not point inside the uploads root.
 */
export function uploadNameOf(stored: string): string | null {
  if (typeof stored !== "string" || !stored || stored.length > 1000 || stored.includes("\0")) return null;
  // A URL-form value (what a request names) never converts backslashes: on Linux
  // they are filename characters, and converting them would resolve a different
  // file from the one authorized. Filesystem paths stored by the server (legacy
  // Windows attachment paths) keep their native separators.
  if (stored.startsWith("/uploads/") && stored.includes("\\")) return null;
  const absolute = stored.startsWith("/uploads/")
    ? path.resolve(LEGACY_UPLOADS_ROOT, stored.slice("/uploads/".length))
    : path.resolve(process.cwd(), stored);
  const relative = path.relative(LEGACY_UPLOADS_ROOT, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const segments = relative.split(path.sep);
  if (segments.length < 2 || !segments.every(isSafeUploadSegment)) return null;
  return segments.join("/");
}

function requireName(stored: string): string {
  const name = uploadNameOf(stored);
  if (!name) throw new StorageError("INVALID_INPUT");
  return name;
}

export interface PutUploadObject {
  /** The value the referencing row stores (URL or uploads path). */
  readonly stored: string;
  readonly householdId: string;
  readonly purpose: StoragePurpose;
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly userId?: string | null;
}

/**
 * A stored file, resolved: `key` is null for a legacy file still on the old
 * disk. `keepLegacy` deletes only the object: set when the name could not be
 * shown to lie in its owner's folder, so no legacy file is unlinked by it.
 */
export interface UploadObjectTarget {
  readonly name: string;
  readonly key: StorageKey | null;
  readonly keepLegacy?: boolean;
}

export interface UploadObjectContent {
  readonly bytes: Buffer;
  /** Null for a legacy file: callers derive the type from its extension. */
  readonly mediaType: string | null;
  readonly sha256: string | null;
}

/**
 * Store the bytes, then record the manifest row. A rejected record removes the
 * object; a record whose outcome is unknown is re-read, and the object is kept
 * unless the row is confirmed (then the put succeeded).
 */
export async function putUploadObject(input: PutUploadObject): Promise<UploadObjectTarget> {
  const name = requireName(input.stored);
  const key = createStorageKey(input.purpose);
  let store: ObjectStore;
  let metadata;
  try {
    // Inside the try: a refused configuration is a 503 like any other storage outage.
    store = getObjectStore();
    metadata = await store.put({ key, bytes: input.bytes, mediaType: input.mediaType });
  } catch (error) {
    throw storageFailure(error, "put");
  }
  try {
    await db.insert(storageObjects).values({
      key, uploadName: name, householdId: input.householdId, purpose: input.purpose,
      sha256: metadata.sha256, size: metadata.size, mediaType: metadata.mediaType, createdBy: input.userId ?? null,
    });
  } catch (error) {
    if (isDefiniteRollback(error)) {
      await store.delete(key).catch((cleanup: unknown) => logger.error("Could not remove an unrecorded upload object",
        { objectKey: key, code: cleanup instanceof StorageError ? cleanup.code : "UNKNOWN" }));
      throw error;
    }
    // The insert may have committed with its acknowledgement lost: reconcile.
    if (await rowCommitted(() => manifestKeyExists(key))) return { name, key };
    logger.error("Upload manifest outcome unknown; the object is kept for the orphan sweep", { objectKey: key, uploadName: name });
    throw error;
  }
  return { name, key };
}

async function manifestKeyExists(key: StorageKey): Promise<boolean> {
  const [row] = await db.select({ key: storageObjects.key }).from(storageObjects).where(eq(storageObjects.key, key)).limit(1);
  return Boolean(row);
}

const MAX_CAUSE_DEPTH = 4;

/**
 * SQLSTATEs that say this statement or transaction was refused, so nothing
 * committed: data exceptions (22), integrity violations (23), an aborted
 * transaction (25P02), integrity at commit (40002), serialization failure
 * (40001), deadlock (40P01), syntax/access/undefined objects (42), check option
 * (44), lock not available (55P03) and a PL/pgSQL RAISE or ASSERT (P0), which is
 * how the invariant triggers refuse a row. Everything else, notably 40003
 * (statement completion unknown), connection (08), operator intervention (57),
 * resource (53) and internal (XX) errors, leaves the outcome unknown.
 */
const REFUSED_CLASSES = new Set(["22", "23", "42", "44", "P0"]);
const REFUSED_CODES = new Set(["25P02", "40001", "40002", "40P01", "55P03"]);

/**
 * True when a failed write certainly did not commit: Postgres refused it with
 * a SQLSTATE above, or the application refused it inside its transaction (an
 * HttpError is thrown before COMMIT). Anything else, such as a dropped
 * connection, a lost acknowledgement or a timeout, leaves the outcome unknown.
 */
export function isDefiniteRollback(error: unknown): boolean {
  if (error instanceof HttpError) return true;
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error; depth += 1) {
    if (current instanceof DatabaseError) {
      const code = current.code ?? "";
      return REFUSED_CODES.has(code) || REFUSED_CLASSES.has(code.slice(0, 2));
    }
    current = current.cause;
  }
  return false;
}

/**
 * Re-read whether a write whose outcome is unknown committed. A failed re-read
 * answers false: the caller then keeps the bytes, which is always safe.
 */
export async function rowCommitted(exists: () => Promise<boolean>): Promise<boolean> {
  try {
    return await exists();
  } catch (error) {
    logger.error("Could not re-read an upload write whose outcome is unknown", { code: (error as NodeJS.ErrnoException).code ?? "UNKNOWN" });
    return false;
  }
}

async function manifestRow(name: string, executor: Executor) {
  const [row] = await executor.select().from(storageObjects).where(eq(storageObjects.uploadName, name)).limit(1);
  return row;
}

/** The folder under the uploads root that each purpose writes. */
const PURPOSE_FOLDER: Record<StoragePurpose, string> = {
  receipt: "receipts", "receipt-thumbnail": "receipts", attachment: "transactions", "goal-image": "goals",
  "profile-picture": "profile-pictures", banner: "banners", "merchant-logo": "merchant-logos", probe: "",
};

/** Who a referencing row says owns an upload: its purpose, household and, for an attachment, transaction. */
export interface UploadOwner {
  readonly purpose: StoragePurpose;
  readonly householdId: string;
  readonly transactionId?: string;
}

/**
 * True when a logical name lies where its owner's writer puts it:
 * `{folder}/{householdId}/…`, or `transactions/{transactionId}/…` for an
 * attachment. A row naming another owner's file (a stale or edited path)
 * fails, so it can neither register nor delete that file.
 */
export function nameMatchesOwner(name: string, owner: UploadOwner): boolean {
  const [folder, scope] = name.split("/");
  const expected = owner.purpose === "attachment" ? owner.transactionId : owner.householdId;
  return Boolean(PURPOSE_FOLDER[owner.purpose]) && folder === PURPOSE_FOLDER[owner.purpose]
    && Boolean(expected) && scope?.toLowerCase() === expected!.toLowerCase();
}

/**
 * Resolve a stored value to its object (or legacy file). Use inside a
 * transaction before deleting the row that names it. With `owner`, a name
 * outside the owner's folder, or a manifest row of another household or
 * purpose, resolves to null: the caller must never delete it.
 */
export async function resolveUploadTarget(stored: string, executor: Executor = db, owner?: UploadOwner): Promise<UploadObjectTarget | null> {
  const name = uploadNameOf(stored);
  if (!name) return null;
  if (owner && !nameMatchesOwner(name, owner)) {
    logger.warn("A row names an upload outside its owner's folder; it is left alone", { uploadName: name, purpose: owner.purpose });
    return null;
  }
  const row = await manifestRow(name, executor);
  if (!row) return { name, key: null };
  if (owner && (row.householdId.toLowerCase() !== owner.householdId.toLowerCase() || row.purpose !== owner.purpose)) {
    logger.warn("A row's upload is recorded for another owner; it is left alone", { uploadName: name, objectKey: row.key, purpose: owner.purpose });
    return null;
  }
  validateStorageKey(row.key);
  return { name, key: row.key };
}

/**
 * True when a stored object's name differs from `name` only by case. On a
 * case-insensitive disk, "UUID.PNG" would open the moved file's legacy copy
 * unchecked, so such a name never takes the legacy fallback.
 */
async function hasCaseAlias(name: string): Promise<boolean> {
  const [alias] = await db.select({ key: storageObjects.key }).from(storageObjects)
    .where(sql`lower(${storageObjects.uploadName}) = ${name.toLowerCase()}`).limit(1);
  return Boolean(alias);
}

async function readLegacy(name: string): Promise<UploadObjectContent | null> {
  try {
    return { bytes: await fs.readFile(path.join(LEGACY_UPLOADS_ROOT, ...name.split("/"))), mediaType: null, sha256: null };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR") return null;
    throw storageFailure(error, "legacy-read");
  }
}

/**
 * The bytes of a stored file that belongs to `householdId`, or null when there
 * is none. A manifest row of another household, or of another `purpose`
 * when one is given, reads as absent.
 */
export async function readUploadObject(stored: string, householdId: string, purpose?: StoragePurpose): Promise<UploadObjectContent | null> {
  const name = uploadNameOf(stored);
  if (!name) return null;
  const row = await manifestRow(name, db);
  if (!row) return (await hasCaseAlias(name)) ? null : readLegacy(name);
  if (row.householdId.toLowerCase() !== householdId.toLowerCase()) return null;
  if (purpose && row.purpose !== purpose) return null;
  let object;
  try {
    validateStorageKey(row.key);
    object = await getObjectStore().get(row.key);
  } catch (error) {
    if (error instanceof StorageError && error.code === "NOT_FOUND") throw storageFailure(new StorageError("INTEGRITY"), "get");
    throw storageFailure(error, "get");
  }
  if (object.metadata.sha256 !== row.sha256 || object.metadata.size !== row.size) throw storageFailure(new StorageError("INTEGRITY"), "get");
  return { bytes: Buffer.from(object.bytes), mediaType: row.mediaType, sha256: row.sha256 };
}

async function unlinkLegacy(name: string): Promise<void> {
  try {
    await fs.unlink(path.join(LEGACY_UPLOADS_ROOT, ...name.split("/")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw storageFailure(error, "legacy-delete");
  }
}

/**
 * Delete a resolved file wherever it lives: the object, any legacy copy of the
 * same name (a moved file keeps its original on the old disk until the
 * operator retires it), and last the manifest row. A missing file is not an
 * error. The manifest goes last so a failed step leaves it naming what is
 * left: while it exists, reads never fall back to the legacy copy, and the
 * erasure and orphan sweeps can still find the key. A caller already inside
 * a transaction passes it, so the manifest delete needs no second connection.
 */
export async function removeUploadTarget(target: UploadObjectTarget, executor: Pick<typeof db, "delete"> = db): Promise<void> {
  if (target.key) {
    try {
      await getObjectStore().delete(target.key);
    } catch (error) {
      throw storageFailure(error, "delete");
    }
  }
  if (!target.keepLegacy) await unlinkLegacy(target.name);
  if (target.key) await executor.delete(storageObjects).where(eq(storageObjects.key, target.key));
}

/** Resolve and delete in one step (the referencing row is already gone or never committed). */
export async function removeUploadObject(stored: string): Promise<void> {
  const target = await resolveUploadTarget(stored);
  if (target) await removeUploadTarget(target);
}

/**
 * Compensation after a failed write: remove a just-stored file that no row
 * will reference. Never throws (the original failure is what the caller
 * reports), but a failure is logged at error level with the logical name, so
 * the orphaned object can be found through its manifest row.
 */
export async function discardUploadObject(stored: string, operation: string): Promise<void> {
  try {
    await removeUploadObject(stored);
  } catch (error) {
    logger.error("Could not remove an uncommitted upload; its manifest row names the orphan", {
      operation, uploadName: uploadNameOf(stored), code: error instanceof UploadStorageError ? error.storageCode : "UNKNOWN",
    });
  }
}

/**
 * Compensation after a referencing write failed with `failure`. The bytes go
 * only when that write certainly rolled back. When its outcome is unknown, a
 * committed row may name them, so they are kept and logged for the orphan
 * sweep: a re-read cannot settle it, because a statement still in flight on
 * the lost connection can commit after the re-read. Never throws.
 */
export async function discardUnlessCommitted(stored: string, operation: string, failure: unknown): Promise<void> {
  if (isDefiniteRollback(failure)) return discardUploadObject(stored, operation);
  logger.error("Upload write outcome unknown; the stored object is kept for the orphan sweep", {
    operation, uploadName: uploadNameOf(stored),
  });
}
