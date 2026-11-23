/**
 * OPS-001: the local-disk ObjectStore driver and the driver choice.
 * Real files in a throwaway directory; no database.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createStorageKey, StorageError } from "../storage";
import { LocalDiskObjectStore } from "../storage/local";
import { PERSISTENT_VOLUME_MARKER, resolveObjectStoreConfiguration, warnIfLocalRootNotPersistent } from "../storage/runtime";
import { logger } from "../../utils/logger";

let root: string;
let store: LocalDiskObjectStore;
const bytes = new TextEncoder().encode("synthetic receipt bytes");

async function code(work: Promise<unknown>): Promise<string> {
  try { await work; return "resolved"; } catch (error) { return error instanceof StorageError ? error.code : "other"; }
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "ops001-store-"));
  store = new LocalDiskObjectStore(root, { maxObjectBytes: 1024 });
});
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe("LocalDiskObjectStore", () => {
  it("round-trips bytes with sha256 metadata under the opaque key only", async () => {
    const key = createStorageKey("receipt");
    const metadata = await store.put({ key, bytes, mediaType: "image/png" });
    expect(metadata).toMatchObject({ key, size: bytes.length, mediaType: "image/png" });
    expect(metadata.sha256).toMatch(/^[a-f0-9]{64}$/);
    const object = await store.get(key);
    expect(Buffer.from(object.bytes).equals(Buffer.from(bytes))).toBe(true);
    expect(await store.head(key)).toEqual(metadata);
    expect(await fs.readdir(path.join(root, "v1", "receipt"))).toEqual(expect.arrayContaining([key.split("/")[2], `${key.split("/")[2]}.json`]));
  });

  it("claims a key once, and refuses oversize or malformed input", async () => {
    const key = createStorageKey("banner");
    await store.put({ key, bytes, mediaType: "image/png" });
    expect(await code(store.put({ key, bytes, mediaType: "image/png" }))).toBe("CONFLICT");
    expect(await code(store.put({ key: createStorageKey("banner"), bytes: new Uint8Array(2048), mediaType: "image/png" }))).toBe("INVALID_INPUT");
    expect(await code(store.get("v1/banner/../../etc" as never))).toBe("INVALID_INPUT");
  });

  it("never returns altered, truncated or orphaned bytes", async () => {
    const key = createStorageKey("attachment");
    await store.put({ key, bytes, mediaType: "application/pdf" });
    const file = path.join(root, ...key.split("/"));
    await fs.writeFile(file, Buffer.from("tampered"));
    expect(await code(store.get(key))).toBe("INTEGRITY");
    await fs.rm(file);
    expect(await code(store.get(key))).toBe("INTEGRITY");
    expect(await code(store.get(createStorageKey("attachment")))).toBe("NOT_FOUND");
  });

  it("deletes idempotently", async () => {
    const key = createStorageKey("goal-image");
    await store.put({ key, bytes, mediaType: "image/png" });
    await store.delete(key);
    await store.delete(key);
    expect(await code(store.get(key))).toBe("NOT_FOUND");
    await expect(store.probe()).resolves.toBeUndefined();
  });
});

describe("warnIfLocalRootNotPersistent", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("warns in production when the local root has no operator marker, and never throws", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const unmarked = await fs.mkdtemp(path.join(os.tmpdir(), "ops001-unmarked-"));
    expect(await warnIfLocalRootNotPersistent({ driver: "local", root: unmarked }, "production")).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(PERSISTENT_VOLUME_MARKER), expect.objectContaining({ root: unmarked }));
    expect(await warnIfLocalRootNotPersistent({ driver: "local", root: path.join(unmarked, "missing") }, "production")).toBe(false);
    await fs.rm(unmarked, { recursive: true, force: true });
  });

  it("stays quiet with the marker or outside production", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    await fs.writeFile(path.join(root, PERSISTENT_VOLUME_MARKER), "");
    expect(await warnIfLocalRootNotPersistent({ driver: "local", root }, "production")).toBe(true);
    expect(await warnIfLocalRootNotPersistent({ driver: "local", root: path.join(root, "nope") }, "development")).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("a refused storage configuration at request time", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.restoreAllMocks(); });

  it("answers 503 STORAGE_UNAVAILABLE, not a raw 500", async () => {
    vi.stubEnv("STORAGE_DRIVER", "ftp");
    vi.resetModules();
    const fresh = await import("../storage/upload-objects");
    const { logger: freshLogger } = await import("../../utils/logger");
    vi.spyOn(freshLogger, "error").mockImplementation(() => undefined);
    const outcome = await fresh.putUploadObject({ stored: "/uploads/banners/synthetic/file.png", householdId: "00000000-0000-4000-8000-000000000001",
      purpose: "banner", bytes, mediaType: "image/png", userId: null }).then(() => "stored", (error: unknown) => error);
    expect(outcome).toBeInstanceOf(fresh.UploadStorageError);
    expect(outcome).toMatchObject({ statusCode: 503, code: "STORAGE_UNAVAILABLE" });
  });
});

describe("resolveObjectStoreConfiguration", () => {
  const cwd = path.resolve(os.tmpdir(), "ops001-app");

  it("defaults to the local driver under <cwd>/private-objects, outside uploads/", () => {
    expect(resolveObjectStoreConfiguration({}, cwd)).toEqual({ driver: "local", root: path.join(cwd, "private-objects") });
    expect(resolveObjectStoreConfiguration({ STORAGE_LOCAL_DIR: "/var/data/objects" }, cwd))
      .toEqual({ driver: "local", root: path.resolve(cwd, "/var/data/objects") });
  });

  it("refuses a mixed, unknown or served configuration", () => {
    expect(() => resolveObjectStoreConfiguration({ STORAGE_LOCAL_DIR: "uploads/objects" }, cwd)).toThrow(StorageError);
    expect(() => resolveObjectStoreConfiguration({ STORAGE_DRIVER: "local", S3_BUCKET: "synthetic" }, cwd)).toThrow(StorageError);
    expect(() => resolveObjectStoreConfiguration({ STORAGE_DRIVER: "ftp" }, cwd)).toThrow(StorageError);
    expect(() => resolveObjectStoreConfiguration({ STORAGE_DRIVER: "s3" }, cwd)).toThrow(StorageError);
    expect(() => resolveObjectStoreConfiguration({ STORAGE_DRIVER: "s3", STORAGE_LOCAL_DIR: "/x", S3_ENDPOINT: "https://objects.example.invalid/",
      S3_REGION: "af-south-1", S3_BUCKET: "capital-synthetic", S3_ACCESS_KEY_ID: "id", S3_SECRET_ACCESS_KEY: "secret" }, cwd)).toThrow(StorageError);
  });

  it("selects S3 only with a complete explicit configuration", () => {
    const configuration = resolveObjectStoreConfiguration({ STORAGE_DRIVER: "s3", S3_ENDPOINT: "https://objects.example.invalid/",
      S3_REGION: "af-south-1", S3_BUCKET: "capital-synthetic", S3_ACCESS_KEY_ID: "id", S3_SECRET_ACCESS_KEY: "secret" }, cwd);
    expect(configuration.driver).toBe("s3");
  });
});
