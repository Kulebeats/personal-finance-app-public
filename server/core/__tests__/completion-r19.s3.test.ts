import { expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createStorageKey, hashStorageBytes } from "../storage";
import { createS3ObjectStore, S3ObjectStore } from "../storage/s3";
import { parseStorageConfiguration } from "../storage/config";

const bytes = Buffer.from("owned synthetic object");
const input = () => ({ key: createStorageKey("receipt"), bytes, mediaType: "image/png" });
function response(body = bytes, sha256 = hashStorageBytes(bytes)) {
  return { Body: Readable.from([body]), ContentLength: bytes.length, ContentType: "image/png", Metadata: { sha256 },
    ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"), VersionId: "synthetic-version" };
}

it("writes conditionally with checksums, reads back bytes before success and binds the written version", async () => {
  const send = vi.fn().mockResolvedValueOnce({ VersionId: "synthetic-version" }).mockResolvedValueOnce(response());
  const store = new S3ObjectStore("synthetic-bucket", { send });
  const object = input();
  expect(await store.put(object)).toMatchObject({ key: object.key, size: bytes.length, sha256: hashStorageBytes(bytes) });
  expect(send.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand);
  expect(send.mock.calls[0][0].input).toMatchObject({ Bucket: "synthetic-bucket", Key: object.key, IfNoneMatch: "*",
    ContentLength: bytes.length, Metadata: { sha256: hashStorageBytes(bytes) }, ChecksumSHA256: Buffer.from(hashStorageBytes(bytes), "hex").toString("base64") });
  expect(send.mock.calls[0][0].input.ACL).toBeUndefined();
  expect(send.mock.calls[1][0]).toBeInstanceOf(GetObjectCommand);
  expect(send.mock.calls[1][0].input.VersionId).toBe("synthetic-version");
  expect(send.mock.calls.every(([, options]) => options.abortSignal instanceof AbortSignal)).toBe(true);
});

it("production factory selects explicit credentials, verification and one attempt without dispatch", async () => {
  const send = vi.spyOn(S3Client.prototype, "send");
  try {
    const configuration = parseStorageConfiguration({ STORAGE_DRIVER: "s3", S3_ENDPOINT: "https://objects.example.invalid", S3_BUCKET: "synthetic-bucket",
      S3_REGION: "auto", S3_ACCESS_KEY_ID: "synthetic-access", S3_SECRET_ACCESS_KEY: "synthetic-secret" })!;
    const store = createS3ObjectStore(configuration);
    expect(send).not.toHaveBeenCalled();
    const client: S3Client = Reflect.get(store, "client");
    expect(await client.config.credentials()).toMatchObject({ accessKeyId: "synthetic-access", secretAccessKey: "synthetic-secret" });
    expect(await client.config.maxAttempts()).toBe(1);
    expect(client.config.disableS3ExpressSessionAuth).toBe(true);
    const handlerConfiguration = await Reflect.get(client.config.requestHandler, "configProvider");
    expect(handlerConfiguration.httpsAgent.options.rejectUnauthorized).toBe(true);
    store.close();
    expect(() => createS3ObjectStore({ ...configuration, endpoint: "http://127.0.0.1:9999" })).toThrow();
  } finally { send.mockRestore(); }
});

it("captures validated write identity and bytes before asynchronous caller mutation", async () => {
  let finish!: (response: object) => void;
  const send = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce(response());
  const object = { ...input(), bytes: Buffer.from(bytes) };
  const originalKey = object.key;
  const pending = new S3ObjectStore("synthetic-bucket", { send }).put(object);
  object.key = createStorageKey("banner"); object.mediaType = "text/html"; object.bytes.fill(0);
  finish({ VersionId: "synthetic-version" });
  expect(await pending).toMatchObject({ key: originalKey, sha256: hashStorageBytes(bytes), mediaType: "image/png" });
  expect(send.mock.calls[1][0].input.Key).toBe(originalKey);
});

it.each([
  response(Buffer.from("tampered bytes")), response(bytes, "0".repeat(64)),
  { ...response(), ContentLength: bytes.length + 1 }, { ...response(), Metadata: {} },
])("refuses corrupt or incomplete retrieved objects", async (object) => {
  const store = new S3ObjectStore("synthetic-bucket", { send: vi.fn().mockResolvedValue(object) });
  await expect(store.get(createStorageKey("receipt"))).rejects.toMatchObject({ code: "INTEGRITY" });
});

it("an accepted write with failed readback remains unknown and never returns false success", async () => {
  const send = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce({ $metadata: { httpStatusCode: 503 }, message: "synthetic-secret" });
  await expect(new S3ObjectStore("synthetic-bucket", { send }).put(input())).rejects.toMatchObject({ code: "UNAVAILABLE", writeOutcome: "unknown" });
});

it.each([[403, "FORBIDDEN"], [404, "NOT_FOUND"], [412, "CONFLICT"], [503, "UNAVAILABLE"]])("normalizes provider status %i without leaking details", async (status, code) => {
  const send = vi.fn().mockRejectedValue({ $metadata: { httpStatusCode: status }, message: "synthetic-secret-url" });
  const error = await new S3ObjectStore("synthetic-bucket", { send }).get(createStorageKey("receipt")).catch((failure: unknown) => failure);
  expect(error).toMatchObject({ code });
  expect(String(error)).not.toContain("synthetic-secret-url");
});

it("treats missing delete as idempotent and pre-aborted write never dispatches", async () => {
  const send = vi.fn().mockRejectedValue({ $metadata: { httpStatusCode: 404 } });
  const store = new S3ObjectStore("synthetic-bucket", { send });
  await store.delete(createStorageKey("receipt"));
  send.mockClear();
  const controller = new AbortController(); controller.abort();
  await expect(store.put(input(), { signal: controller.signal })).rejects.toMatchObject({ code: "ABORTED", writeOutcome: "not_attempted" });
  expect(send).not.toHaveBeenCalled();
});

it("times out a stalled response body, aborts the stream and does not retry automatically", async () => {
  const body = new Readable({ read() {} });
  const send = vi.fn().mockResolvedValue({ ...response(), Body: body });
  await expect(new S3ObjectStore("synthetic-bucket", { send }).get(createStorageKey("receipt"), { timeoutMs: 20 })).rejects.toMatchObject({ code: "DEADLINE" });
  expect(body.destroyed).toBe(true);
  expect(send).toHaveBeenCalledTimes(1);
});
