import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createStorageKey, StorageError, withStorageDeadline } from "../storage";
import { MemoryObjectStore } from "../storage/memory";
import { parseStorageConfiguration } from "../storage/config";

afterEach(() => vi.useRealTimers());
const configured = { STORAGE_DRIVER: "s3", S3_ENDPOINT: "https://objects.example.invalid", S3_REGION: "auto",
  S3_BUCKET: "capital-synthetic", S3_ACCESS_KEY_ID: "synthetic-access", S3_SECRET_ACCESS_KEY: "synthetic-secret" };

it("configuration is truthfully absent and never consumes ambient AWS credentials", () => {
  expect(parseStorageConfiguration({})).toBeUndefined();
  expect(() => parseStorageConfiguration({ STORAGE_DRIVER: "s3", AWS_ACCESS_KEY_ID: "ambient", AWS_SECRET_ACCESS_KEY: "ambient" })).toThrow(StorageError);
  expect(parseStorageConfiguration(configured)).toMatchObject({ bucket: "capital-synthetic", forcePathStyle: false,
    credentials: { accessKeyId: "synthetic-access", secretAccessKey: "synthetic-secret" } });
});

it.each([
  { S3_ENDPOINT: "http://127.0.0.1:9999" }, { S3_ENDPOINT: "https://user:secret@objects.example.invalid" },
  { S3_ENDPOINT: "https://objects.example.invalid?secret=value" }, { S3_ENDPOINT: "https://objects.example.invalid/other" },
  { S3_ENDPOINT: "https://objects.example.invalid:0" }, { S3_ENDPOINT: "https://objects.example.invalid#" },
  { S3_BUCKET: "../other" }, { S3_BUCKET: "127.0.0.1" }, { S3_FORCE_PATH_STYLE: "yes" },
  { STORAGE_DRIVER: "memory" }, { S3_SECRET_ACCESS_KEY: "" }, { S3_UNKNOWN_OPTION: "ignored" },
])("refuses unsafe, partial or unknown storage configuration %j", (overrides) => {
  expect(() => parseStorageConfiguration({ ...configured, ...overrides })).toThrow(StorageError);
});

it("rejects partial configuration without an explicit driver and omits secrets from errors", () => {
  expect(() => parseStorageConfiguration({ S3_SECRET_ACCESS_KEY: "synthetic-never-log" })).toThrow(StorageError);
  try { parseStorageConfiguration({ ...configured, S3_ENDPOINT: "https://synthetic-never-log@objects.example.invalid" }); }
  catch (error) { expect(String(error)).not.toContain("synthetic-never-log"); }
});

it("fixture store uses opaque immutable keys, verifies metadata and isolates caller buffers", async () => {
  const store = new MemoryObjectStore();
  const key = createStorageKey("receipt");
  const bytes = Buffer.from("synthetic bytes");
  const hash = createHash("sha256").update(bytes).digest("hex");
  expect(key).toMatch(/^v1\/receipt\/[a-f0-9-]{36}$/);
  const metadata = await store.put({ key, bytes, mediaType: "image/png" });
  expect(metadata).toMatchObject({ key, size: bytes.length, sha256: hash, mediaType: "image/png" });
  bytes.fill(0);
  const retrieved = await store.get(key);
  expect(Buffer.from(retrieved.bytes).toString()).toBe("synthetic bytes");
  retrieved.bytes.fill(0);
  expect((await store.head(key)).sha256).toBe(hash);
  expect(Buffer.from((await store.get(key)).bytes).toString()).toBe("synthetic bytes");
  await expect(store.put({ key, bytes, mediaType: "image/png" })).rejects.toMatchObject({ code: "CONFLICT", writeOutcome: "not_attempted" });
  await store.delete(key);
  await store.delete(key);
  await expect(store.get(key)).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("validates runtime references and byte limits before a fixture write", async () => {
  const store = new MemoryObjectStore({ maxObjectBytes: 4 });
  for (const key of ["../secret", "v1/receipt/../../../secret", "https://other.invalid/key"]) {
    await expect(store.get(key as ReturnType<typeof createStorageKey>)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  }
  const key = createStorageKey("receipt");
  await expect(store.put({ key, bytes: Buffer.from("12345"), mediaType: "image/png" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await expect(store.put({ key, bytes: Buffer.from("1234"), mediaType: "text/html\r\nInjected: yes" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
});

it("a deadline aborts owned work, settles before a stalled task and never returns its late result", async () => {
  vi.useFakeTimers();
  let captured: AbortSignal | undefined;
  let finish!: (value: string) => void;
  const pending = withStorageDeadline((signal) => { captured = signal; return new Promise<string>((resolve) => { finish = resolve; }); }, { timeoutMs: 25 }, true);
  const assertion = expect(pending).rejects.toMatchObject({ code: "DEADLINE", writeOutcome: "unknown" });
  await vi.advanceTimersByTimeAsync(25);
  await assertion;
  expect(captured?.aborted).toBe(true);
  finish("late success");
  await Promise.resolve();
});

it("pre-aborted work is never dispatched; later cancellation retains unknown write outcome", async () => {
  const controller = new AbortController();
  controller.abort();
  const dispatch = vi.fn();
  await expect(withStorageDeadline(dispatch, { signal: controller.signal }, true)).rejects.toMatchObject({ code: "ABORTED", writeOutcome: "not_attempted" });
  expect(dispatch).not.toHaveBeenCalled();
  const later = new AbortController();
  const pending = withStorageDeadline(() => new Promise(() => {}), { signal: later.signal }, true);
  const assertion = expect(pending).rejects.toMatchObject({ code: "ABORTED", writeOutcome: "unknown" });
  later.abort();
  await assertion;
});
