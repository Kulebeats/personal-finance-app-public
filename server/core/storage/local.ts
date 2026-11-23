/**
 * Local-disk ObjectStore driver (OPS-001, D18 single-instance option).
 *
 * Each object is two files under the configured root, addressed only by its
 * opaque key (`v1/{purpose}/{uuid}`): the bytes, and a `.json` sidecar with
 * sha256, size and media type. The sidecar is written first with an exclusive
 * create, so a key can be claimed once; the bytes go to a temporary file and
 * are renamed into place, then read back and verified before success. Every
 * read re-hashes the bytes, so a truncated or altered file is INTEGRITY, never
 * served. Durability is the disk's: a container's ephemeral disk loses objects
 * on redeploy, which is why the root must be a persistent directory.
 *
 * @module core/storage/local
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  hashStorageBytes, StorageError, throwIfStorageAborted, validatePut, validateStorageKey, withStorageDeadline,
  type ObjectMetadata, type ObjectStore, type StorageKey, type StorageOperation, type StoragePut, type StoredObject,
} from "../storage";

const DEFAULT_MAX_OBJECT_BYTES = 10 * 1024 * 1024;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const UNAVAILABLE_ERRNO = new Set(["EACCES", "EPERM", "EROFS", "ENOSPC", "EDQUOT", "ENOTDIR", "EMFILE", "EBUSY"]);

function errnoOf(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

function failure(error: unknown, writeOutcome: "not_attempted" | "unknown" = "not_attempted"): StorageError {
  if (error instanceof StorageError) return new StorageError(error.code, writeOutcome);
  const code = errnoOf(error);
  if (code === "ENOENT") return new StorageError("NOT_FOUND", writeOutcome);
  if (code === "EEXIST") return new StorageError("CONFLICT", writeOutcome);
  if (code && UNAVAILABLE_ERRNO.has(code)) return new StorageError("UNAVAILABLE", writeOutcome);
  return new StorageError("UNAVAILABLE", writeOutcome);
}

export class LocalDiskObjectStore implements ObjectStore {
  private readonly maxObjectBytes: number;

  constructor(private readonly root: string, options: { maxObjectBytes?: number } = {}) {
    this.maxObjectBytes = options.maxObjectBytes ?? DEFAULT_MAX_OBJECT_BYTES;
    if (!path.isAbsolute(root) || !Number.isInteger(this.maxObjectBytes) || this.maxObjectBytes < 1) {
      throw new StorageError("INVALID_INPUT");
    }
  }

  private objectPath(key: StorageKey): string {
    return path.join(this.root, ...key.split("/"));
  }

  private parseSidecar(key: StorageKey, text: string): ObjectMetadata {
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new StorageError("INTEGRITY"); }
    const record = value as { sha256?: unknown; size?: unknown; mediaType?: unknown } | null;
    if (!record || typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.sha256) ||
        typeof record.size !== "number" || !Number.isSafeInteger(record.size) || record.size < 1 || record.size > this.maxObjectBytes ||
        typeof record.mediaType !== "string" || !MEDIA_TYPE.test(record.mediaType)) {
      throw new StorageError("INTEGRITY");
    }
    return { key, sha256: record.sha256, size: record.size, mediaType: record.mediaType };
  }

  private async read(key: StorageKey, signal: AbortSignal): Promise<StoredObject> {
    const file = this.objectPath(key);
    let sidecar: string;
    try { sidecar = await fs.readFile(`${file}.json`, { encoding: "utf8", signal }); }
    catch (error) { throw failure(error); }
    const metadata = this.parseSidecar(key, sidecar);
    let bytes: Buffer;
    try { bytes = await fs.readFile(file, { signal }); }
    catch (error) {
      // A claimed key whose bytes are missing is damage, not absence.
      throw errnoOf(error) === "ENOENT" ? new StorageError("INTEGRITY") : failure(error);
    }
    throwIfStorageAborted(signal);
    if (bytes.length !== metadata.size || hashStorageBytes(bytes) !== metadata.sha256) throw new StorageError("INTEGRITY");
    return { metadata, bytes };
  }

  async put(input: StoragePut, operation?: StorageOperation): Promise<ObjectMetadata> {
    validatePut(input, this.maxObjectBytes);
    const bytes = Buffer.from(input.bytes);
    const metadata: ObjectMetadata = { key: input.key, sha256: hashStorageBytes(bytes), size: bytes.length, mediaType: input.mediaType };
    const file = this.objectPath(input.key);
    return withStorageDeadline(async (signal) => {
      let claimed = false;
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(`${file}.json`, JSON.stringify({ sha256: metadata.sha256, size: metadata.size, mediaType: metadata.mediaType }),
          { flag: "wx", signal });
        claimed = true;
        await fs.writeFile(temporary, bytes, { flag: "wx", signal });
        await fs.rename(temporary, file);
        const verified = await this.read(input.key, signal);
        if (verified.metadata.sha256 !== metadata.sha256 || verified.metadata.size !== metadata.size) throw new StorageError("INTEGRITY");
        return { ...metadata };
      } catch (error) {
        await fs.rm(temporary, { force: true }).catch(() => undefined);
        if (claimed) {
          await fs.rm(file, { force: true }).catch(() => undefined);
          await fs.rm(`${file}.json`, { force: true }).catch(() => undefined);
        }
        throw failure(error, claimed ? "unknown" : "not_attempted");
      }
    }, operation, true);
  }

  async get(key: StorageKey, operation?: StorageOperation): Promise<StoredObject> {
    validateStorageKey(key);
    return withStorageDeadline((signal) => this.read(key, signal), operation);
  }

  async head(key: StorageKey, operation?: StorageOperation): Promise<ObjectMetadata> {
    return (await this.get(key, operation)).metadata;
  }

  async delete(key: StorageKey, operation?: StorageOperation): Promise<void> {
    validateStorageKey(key);
    const file = this.objectPath(key);
    return withStorageDeadline(async () => {
      try {
        await fs.rm(file, { force: true });
        await fs.rm(`${file}.json`, { force: true });
      } catch (error) { throw failure(error, "unknown"); }
    }, operation, true);
  }

  /** The root exists or can be created, and the app user can write to it. */
  async probe(operation?: StorageOperation): Promise<void> {
    return withStorageDeadline(async () => {
      try {
        await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
        await fs.access(this.root, fs.constants.W_OK | fs.constants.X_OK);
      } catch (error) { throw failure(error); }
    }, operation);
  }
}
