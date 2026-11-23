import { createHash, randomUUID } from "node:crypto";

declare const storageKey: unique symbol;
export type StorageKey = string & { readonly [storageKey]: true };
export type StoragePurpose = "receipt" | "receipt-thumbnail" | "attachment" | "goal-image" | "profile-picture" | "banner" | "merchant-logo" | "probe";
const keyPattern = /^v1\/(receipt|receipt-thumbnail|attachment|goal-image|profile-picture|banner|merchant-logo|probe)\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export type StorageFailureCode = "INVALID_INPUT" | "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "UNAVAILABLE" | "INTEGRITY" | "ABORTED" | "DEADLINE";
export type WriteOutcome = "not_attempted" | "unknown" | "confirmed";
export class StorageError extends Error {
  constructor(readonly code: StorageFailureCode, readonly writeOutcome: WriteOutcome = "not_attempted") {
    super(`Storage operation failed: ${code}`);
    this.name = "StorageError";
  }
}
export interface StorageOperation { signal?: AbortSignal; timeoutMs?: number }
export interface ObjectMetadata { key: StorageKey; sha256: string; size: number; mediaType: string; versionId?: string }
export interface StoragePut { key: StorageKey; bytes: Uint8Array; mediaType: string }
export interface StoredObject { metadata: ObjectMetadata; bytes: Uint8Array }
/** Backend only. Callers must reauthorize parent visibility before every read. */
export interface ObjectStore {
  put(input: StoragePut, operation?: StorageOperation): Promise<ObjectMetadata>;
  head(key: StorageKey, operation?: StorageOperation): Promise<ObjectMetadata>;
  get(key: StorageKey, operation?: StorageOperation): Promise<StoredObject>;
  delete(key: StorageKey, operation?: StorageOperation): Promise<void>;
  probe(operation?: StorageOperation): Promise<void>;
}
export function validateStorageKey(key: unknown): asserts key is StorageKey {
  if (typeof key !== "string" || !keyPattern.test(key)) throw new StorageError("INVALID_INPUT");
}
export function createStorageKey(purpose: StoragePurpose): StorageKey {
  const key = `v1/${purpose}/${randomUUID()}`;
  validateStorageKey(key);
  return key;
}
export function hashStorageBytes(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
export function validatePut(input: StoragePut, maxObjectBytes: number): void {
  validateStorageKey(input.key);
  if (!(input.bytes instanceof Uint8Array) || input.bytes.length < 1 || input.bytes.length > maxObjectBytes || typeof input.mediaType !== "string" ||
      !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(input.mediaType)) throw new StorageError("INVALID_INPUT");
}
export function throwIfStorageAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new StorageError("ABORTED");
}
/** Race the entire operation, including body streaming; never expose late success. */
export async function withStorageDeadline<T>(work: (signal: AbortSignal) => Promise<T>, operation: StorageOperation = {}, write = false): Promise<T> {
  const timeout = operation.timeoutMs ?? 5000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30000) throw new StorageError("INVALID_INPUT");
  if (operation.signal?.aborted) throw new StorageError("ABORTED");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  const cancellation = new Promise<never>((_resolve, reject) => {
    const cancel = (code: "ABORTED" | "DEADLINE") => {
      controller.abort();
      reject(new StorageError(code, write ? "unknown" : "not_attempted"));
    };
    onAbort = () => cancel("ABORTED");
    operation.signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => cancel("DEADLINE"), timeout);
  });
  try { return await Promise.race([work(controller.signal), cancellation]); }
  finally { clearTimeout(timer); operation.signal?.removeEventListener("abort", onAbort); }
}
