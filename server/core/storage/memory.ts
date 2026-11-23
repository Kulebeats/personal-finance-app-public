import { hashStorageBytes, StorageError, validatePut, validateStorageKey, withStorageDeadline,
  type ObjectStore, type ObjectMetadata, type StorageKey, type StorageOperation, type StoragePut, type StoredObject } from "../storage";

/** Owned test fixture only. No persistence, provider enablement or durability claim. */
export class MemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<StorageKey, StoredObject>();
  private readonly maxObjectBytes: number;
  constructor(options: { maxObjectBytes?: number } = {}) {
    this.maxObjectBytes = options.maxObjectBytes ?? 10 * 1024 * 1024;
    if (!Number.isInteger(this.maxObjectBytes) || this.maxObjectBytes < 1) throw new StorageError("INVALID_INPUT");
  }
  async put(input: StoragePut, operation?: StorageOperation): Promise<ObjectMetadata> {
    validatePut(input, this.maxObjectBytes);
    return withStorageDeadline(async () => {
      if (this.objects.has(input.key)) throw new StorageError("CONFLICT");
      const bytes = Uint8Array.from(input.bytes);
      const metadata = { key: input.key, sha256: hashStorageBytes(bytes), size: bytes.length, mediaType: input.mediaType };
      this.objects.set(input.key, { bytes, metadata });
      return { ...metadata };
    }, operation, true);
  }
  async get(key: StorageKey, operation?: StorageOperation): Promise<StoredObject> {
    validateStorageKey(key);
    return withStorageDeadline(async () => {
      const object = this.objects.get(key);
      if (!object) throw new StorageError("NOT_FOUND");
      return { bytes: Uint8Array.from(object.bytes), metadata: { ...object.metadata } };
    }, operation);
  }
  async head(key: StorageKey, operation?: StorageOperation): Promise<ObjectMetadata> { return (await this.get(key, operation)).metadata; }
  async delete(key: StorageKey, operation?: StorageOperation): Promise<void> {
    validateStorageKey(key);
    return withStorageDeadline(async () => { this.objects.delete(key); }, operation, true);
  }
  async probe(operation?: StorageOperation): Promise<void> { await withStorageDeadline(async () => {}, operation); }
}
