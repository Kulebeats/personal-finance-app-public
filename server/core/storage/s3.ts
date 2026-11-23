import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { hashStorageBytes, StorageError, throwIfStorageAborted, validatePut, validateStorageKey, withStorageDeadline,
  type ObjectMetadata, type ObjectStore, type StorageKey, type StorageOperation, type StoragePut, type StoredObject, type WriteOutcome } from "../storage";
import { parseStorageConfiguration, type S3StorageConfiguration } from "./config";

export type S3Transport = Pick<S3Client, "send">;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new StorageError("INTEGRITY");
  return value as Record<string, unknown>;
}
function failure(error: unknown, writeOutcome: WriteOutcome = "not_attempted"): StorageError {
  if (error instanceof StorageError) return new StorageError(error.code, writeOutcome);
  // The pinned SDK's checksum stream throws a plain Error for this case.
  // Classify it, but never forward the provider message or checksum payload.
  if (error instanceof Error && error.message.startsWith("Checksum mismatch:")) return new StorageError("INTEGRITY", writeOutcome);
  const status = error && typeof error === "object" ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode : undefined;
  const code = status === 403 || status === 401 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : status === 409 || status === 412 ? "CONFLICT" : "UNAVAILABLE";
  return new StorageError(code, writeOutcome);
}

/** Explicit construction only; never creates a client or sends during import. */
export function createS3ObjectStore(configuration: S3StorageConfiguration): S3ObjectStore {
  // Revalidate even a manually constructed configuration; HTTP fixtures inject
  // an already-owned client into the class rather than weakening this policy.
  const validated = parseStorageConfiguration({ STORAGE_DRIVER: "s3", S3_ENDPOINT: configuration.endpoint,
    S3_REGION: configuration.region, S3_BUCKET: configuration.bucket, S3_FORCE_PATH_STYLE: String(configuration.forcePathStyle),
    S3_ACCESS_KEY_ID: configuration.credentials.accessKeyId, S3_SECRET_ACCESS_KEY: configuration.credentials.secretAccessKey,
    S3_SESSION_TOKEN: configuration.credentials.sessionToken })!;
  const client = new S3Client({ endpoint: validated.endpoint, region: validated.region, credentials: { ...validated.credentials },
    forcePathStyle: validated.forcePathStyle, maxAttempts: 1, followRegionRedirects: false, disableS3ExpressSessionAuth: true,
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
    requestHandler: { connectionTimeout: 1000, requestTimeout: 5000, httpsAgent: { rejectUnauthorized: true, keepAlive: true } } });
  return new S3ObjectStore(validated.bucket, client, { close: () => client.destroy() });
}

export class S3ObjectStore implements ObjectStore {
  private readonly maxObjectBytes: number;
  constructor(private readonly bucket: string, private readonly client: S3Transport,
    private readonly options: { maxObjectBytes?: number; close?: () => void } = {}) {
    this.maxObjectBytes = options.maxObjectBytes ?? 10 * 1024 * 1024;
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || !Number.isInteger(this.maxObjectBytes) || this.maxObjectBytes < 1) throw new StorageError("INVALID_INPUT");
  }
  close(): void { this.options.close?.(); }
  private metadata(key: StorageKey, response: Record<string, unknown>): ObjectMetadata {
    const sha256 = record(response.Metadata).sha256;
    const size = response.ContentLength;
    const mediaType = response.ContentType;
    if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256) || typeof size !== "number" || !Number.isSafeInteger(size) || size < 1 || size > this.maxObjectBytes ||
        typeof mediaType !== "string" || !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mediaType) ||
        (response.ChecksumSHA256 !== undefined && response.ChecksumSHA256 !== Buffer.from(sha256, "hex").toString("base64")) ||
        (response.VersionId !== undefined && (typeof response.VersionId !== "string" || response.VersionId.length > 1024))) throw new StorageError("INTEGRITY");
    return { key, sha256, size, mediaType, ...(typeof response.VersionId === "string" ? { versionId: response.VersionId } : {}) };
  }
  private async read(key: StorageKey, signal: AbortSignal, versionId?: string): Promise<StoredObject> {
    throwIfStorageAborted(signal);
    const response = record(await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, ChecksumMode: "ENABLED", ...(versionId ? { VersionId: versionId } : {}) }), { abortSignal: signal }));
    const body = response.Body;
    if (!body || typeof body !== "object" || !(Symbol.asyncIterator in body)) throw new StorageError("INTEGRITY");
    const stream = body as AsyncIterable<Uint8Array> & { destroy?: () => void };
    const stop = () => stream.destroy?.();
    signal.addEventListener("abort", stop, { once: true });
    try {
      throwIfStorageAborted(signal);
      const metadata = this.metadata(key, response);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of stream) {
        throwIfStorageAborted(signal);
        if (!(chunk instanceof Uint8Array) || (size += chunk.length) > this.maxObjectBytes) throw new StorageError("INTEGRITY");
        chunks.push(Buffer.from(chunk));
      }
      throwIfStorageAborted(signal);
      const bytes = Buffer.concat(chunks);
      if (size !== metadata.size || hashStorageBytes(bytes) !== metadata.sha256 || (versionId && metadata.versionId !== versionId)) throw new StorageError("INTEGRITY");
      return { metadata, bytes };
    } finally { signal.removeEventListener("abort", stop); stream.destroy?.(); }
  }
  async put(input: StoragePut, operation?: StorageOperation): Promise<ObjectMetadata> {
    validatePut(input, this.maxObjectBytes);
    const { key, mediaType } = input;
    const bytes = Buffer.from(input.bytes);
    const sha256 = hashStorageBytes(bytes);
    return withStorageDeadline(async (signal) => {
      let accepted = false;
      try {
        const response = record(await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key,
          Body: bytes, ContentLength: bytes.length, ContentType: mediaType, Metadata: { sha256 },
          ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"), IfNoneMatch: "*" }), { abortSignal: signal }));
        accepted = true;
        throwIfStorageAborted(signal);
        const versionId = typeof response.VersionId === "string" ? response.VersionId : undefined;
        const verified = await this.read(key, signal, versionId);
        if (verified.metadata.sha256 !== sha256 || verified.metadata.size !== bytes.length || verified.metadata.mediaType !== mediaType) throw new StorageError("INTEGRITY");
        return verified.metadata;
      } catch (error) {
        const normalized = failure(error);
        throw new StorageError(normalized.code, accepted || !["FORBIDDEN", "CONFLICT"].includes(normalized.code) ? "unknown" : "not_attempted");
      }
    }, operation, true);
  }
  async get(key: StorageKey, operation?: StorageOperation): Promise<StoredObject> {
    validateStorageKey(key);
    return withStorageDeadline(async (signal) => { try { return await this.read(key, signal); } catch (error) { throw failure(error); } }, operation);
  }
  async head(key: StorageKey, operation?: StorageOperation): Promise<ObjectMetadata> {
    validateStorageKey(key);
    return withStorageDeadline(async (signal) => {
      try { return this.metadata(key, record(await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key, ChecksumMode: "ENABLED" }), { abortSignal: signal }))); }
      catch (error) { throw failure(error); }
    }, operation);
  }
  async delete(key: StorageKey, operation?: StorageOperation): Promise<void> {
    validateStorageKey(key);
    return withStorageDeadline(async (signal) => {
      try { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: signal }); }
      catch (error) { const normalized = failure(error, "unknown"); if (normalized.code !== "NOT_FOUND") throw normalized; }
    }, operation, true);
  }
  /** Reachability/authorization only; read/write durability needs separate proof. */
  async probe(operation?: StorageOperation): Promise<void> {
    return withStorageDeadline(async (signal) => {
      try { await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }), { abortSignal: signal }); }
      catch (error) { throw failure(error); }
    }, operation);
  }
}
