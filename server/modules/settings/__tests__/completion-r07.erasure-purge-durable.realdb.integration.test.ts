/**
 * A-34: a crash between the erasure commit and the file cleanup must not lose
 * the purge list. Erasure collects the stored objects to delete inside its
 * transaction; the household delete cascades their storage_objects manifest
 * rows, so after commit the keys are known only to what erasure recorded.
 * Each object gets a durable purge item in the same transaction, the
 * post-commit step clears the items it completes, and a restart drains what
 * is left. A second drain of an already-removed object is safe.
 *
 * The crash is simulated at the first post-commit step (stopping the erased
 * actor's in-flight AI calls): it throws, so the transaction has committed
 * and no cleanup runs. Real Postgres, real local object store.
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auditLogs, households, pendingReceipts, storageObjects, users } from "@shared/schema";
import { db, pool } from "../../../db";
import { getObjectStore, resolveObjectStoreConfiguration } from "../../../core/storage/runtime";
import { StorageError } from "../../../core/storage";
import { putUploadObject, type UploadObjectTarget } from "../../../core/storage/upload-objects";
import { withTransaction } from "../../../utils/withTransaction";
import { logger } from "../../../utils/logger";
import { createSignedHousehold, type SignedHousehold } from "../../../__tests__/signed-household-fixture";
import { eraseAccount } from "../settings.account-deletion.service";

const crash = vi.hoisted(() => ({ armed: false }));
vi.mock("../../ai/ai.inflight", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ai/ai.inflight")>();
  return {
    ...actual,
    abortActorInFlight: (actorId: string) => {
      if (!crash.armed) return actual.abortActorInFlight(actorId);
      crash.armed = false;
      throw new Error("synthetic process exit after the erasure commit");
    },
  };
});

/**
 * The restart drain. Loaded by a non-literal specifier so this file type-checks
 * on a head where the module does not exist yet (RED in CI).
 */
const PURGE_MODULE: string = "../settings.account-deletion.purge";
interface PurgeModule {
  recordPurgeItems: (tx: Parameters<Parameters<typeof withTransaction>[0]>[0], targets: readonly UploadObjectTarget[]) => Promise<string[]>;
  drainStoragePurgeItems: (filter?: { readonly ids?: readonly string[] }) => Promise<{ removed: number; failed: number }>;
  drainStoragePurgeItemsAtBoot: () => Promise<void>;
  MAX_PURGE_ATTEMPTS: number;
}
async function loadPurge(): Promise<PurgeModule> {
  return (await import(/* @vite-ignore */ PURGE_MODULE)) as PurgeModule;
}

const objectFile = (key: string) => {
  const configuration = resolveObjectStoreConfiguration(process.env);
  if (configuration.driver !== "local") throw new Error("this suite runs on the local-disk driver");
  return path.join(configuration.root, ...key.split("/"));
};
const exists = (file: string) => fs.access(file).then(() => true, () => false);

async function png(seed: number): Promise<Buffer> {
  return sharp({ create: { width: 3, height: 3, channels: 3, background: { r: seed * 20, g: 90, b: 40 } } }).png().toBuffer();
}

/** A sole-owner household holding a receipt (image + thumbnail) and the owner's banner, all as stored objects. */
async function seedStoredHousehold(label: string): Promise<{ household: SignedHousehold; email: string; keys: string[] }> {
  const household = await createSignedHousehold(label);
  await request(household.app).post("/api/receipts/upload").set(household.headers)
    .attach("file", await png(3), { filename: "receipt.png", contentType: "image/png" }).expect(201);
  const bannerUrl = `/uploads/banners/${household.householdId}/${randomUUID()}.png`;
  await putUploadObject({ stored: bannerUrl, householdId: household.householdId, purpose: "banner", bytes: await png(5),
    mediaType: "image/png", userId: household.userId });
  await db.update(users).set({ bannerUrl }).where(eq(users.id, household.userId));
  const manifest = await db.select({ key: storageObjects.key }).from(storageObjects)
    .where(eq(storageObjects.householdId, household.householdId));
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, household.userId));
  return { household, email: user.email, keys: manifest.map((row) => row.key).sort() };
}

async function purgeItemsFor(keys: readonly string[]): Promise<{ id: string; objectKey: string }[]> {
  const { rows } = await pool.query<{ id: string; object_key: string }>(
    "SELECT id, object_key FROM storage_purge_items WHERE object_key = ANY($1::text[])", [keys]);
  // Sorted here, like `keys`: the database collation orders "-" and "/" differently.
  return rows.map((row) => ({ id: row.id, objectKey: row.object_key }))
    .sort((a, b) => (a.objectKey < b.objectKey ? -1 : a.objectKey > b.objectKey ? 1 : 0));
}

const seeded: { household: SignedHousehold; keys: string[] }[] = [];

afterAll(async () => {
  for (const { household, keys } of seeded) {
    await pool.query("DELETE FROM storage_purge_items WHERE object_key = ANY($1::text[])", [keys]).catch(() => undefined);
    for (const key of keys) await fs.rm(objectFile(key), { force: true }).then(() => fs.rm(`${objectFile(key)}.json`, { force: true }));
    await household.cleanup(async () => {
      await db.delete(pendingReceipts).where(eq(pendingReceipts.householdId, household.householdId));
      await db.delete(storageObjects).where(eq(storageObjects.householdId, household.householdId));
    }, true);
  }
}, 60_000);

describe("A-34 a crash after the erasure commit keeps a durable purge list", () => {
  let keys: string[];
  let householdId: string;
  let drainedIds: string[] = [];

  beforeAll(async () => {
    const { household, email, keys: stored } = await seedStoredHousehold("erasure-purge-crash");
    seeded.push({ household, keys: stored });
    keys = stored;
    householdId = household.householdId;
    crash.armed = true;
    await expect(eraseAccount({ userId: household.userId, householdId, userEmail: email }))
      .rejects.toThrow(/synthetic process exit/);
  }, 60_000);

  it("committed the erasure and left every stored object in place (the crash window)", async () => {
    expect(keys.length, "the receipt image, its thumbnail and the banner").toBe(3);
    expect(await db.select().from(households).where(eq(households.id, householdId))).toEqual([]);
    expect(await db.select().from(storageObjects).where(eq(storageObjects.householdId, householdId))).toEqual([]);
    for (const key of keys) expect(await exists(objectFile(key)), key).toBe(true);
  });

  it("recorded one durable purge item per stored object", async () => {
    expect((await purgeItemsFor(keys)).map((item) => item.objectKey)).toEqual(keys);
  });

  it("a restart drains the items, including one whose object an earlier attempt already removed", async () => {
    const items = await purgeItemsFor(keys);
    await fs.rm(objectFile(keys[0]), { force: true });
    const { drainStoragePurgeItems } = await loadPurge();

    drainedIds = items.map((item) => item.id);
    expect(await drainStoragePurgeItems({ ids: drainedIds })).toEqual({ removed: keys.length, failed: 0 });

    for (const key of keys) expect(await exists(objectFile(key)), key).toBe(false);
    expect(await purgeItemsFor(keys)).toEqual([]);
  });

  it("a second drain of the same items is a safe no-op", async () => {
    const { drainStoragePurgeItems } = await loadPurge();
    expect(drainedIds).toHaveLength(keys.length);
    expect(await drainStoragePurgeItems({ ids: drainedIds })).toEqual({ removed: 0, failed: 0 });
  });
});

describe("A-34 an erasure that completes leaves no purge item behind", () => {
  it("deletes the objects and clears their items after commit", async () => {
    const { household, email, keys } = await seedStoredHousehold("erasure-purge-complete");
    seeded.push({ household, keys });

    expect(await eraseAccount({ userId: household.userId, householdId: household.householdId, userEmail: email }))
      .toEqual({ householdDeleted: true });

    for (const key of keys) expect(await exists(objectFile(key)), key).toBe(false);
    expect(await purgeItemsFor(keys)).toEqual([]);
  }, 60_000);
});

describe("A-34 two drains at once process each item once", () => {
  it("splits the items between the drains and leaves none behind", async () => {
    const { household, email, keys } = await seedStoredHousehold("erasure-purge-concurrent");
    seeded.push({ household, keys });
    crash.armed = true;
    await expect(eraseAccount({ userId: household.userId, householdId: household.householdId, userEmail: email }))
      .rejects.toThrow(/synthetic process exit/);
    const ids = (await purgeItemsFor(keys)).map((item) => item.id);
    expect(ids).toHaveLength(keys.length);
    const { drainStoragePurgeItems } = await loadPurge();

    const [first, second] = await Promise.all([drainStoragePurgeItems({ ids }), drainStoragePurgeItems({ ids })]);

    expect(first.removed + second.removed).toBe(keys.length);
    expect(first.failed + second.failed).toBe(0);
    for (const key of keys) expect(await exists(objectFile(key)), key).toBe(false);
    expect(await purgeItemsFor(keys)).toEqual([]);
  }, 60_000);
});

describe("A-34 a removal that keeps failing", () => {
  it("stays queued with a code only, is audited, and is no longer claimed after the attempt cap", async () => {
    const { household, email, keys } = await seedStoredHousehold("erasure-purge-failing");
    seeded.push({ household, keys });
    const { drainStoragePurgeItems, drainStoragePurgeItemsAtBoot, MAX_PURGE_ATTEMPTS } = await loadPurge();
    const failing = vi.spyOn(getObjectStore(), "delete").mockRejectedValue(new StorageError("UNAVAILABLE", "unknown"));
    const errors = vi.spyOn(logger, "error");
    try {
      expect(await eraseAccount({ userId: household.userId, householdId: household.householdId, userEmail: email }))
        .toEqual({ householdDeleted: true });

      const ids = (await purgeItemsFor(keys)).map((item) => item.id);
      expect(ids).toHaveLength(keys.length);
      const { rows: first } = await pool.query<{ attempts: number; last_error_code: string }>(
        "SELECT attempts, last_error_code FROM storage_purge_items WHERE id = ANY($1::uuid[])", [ids]);
      expect(first.map((row) => [row.attempts, row.last_error_code])).toEqual(keys.map(() => [1, "UNAVAILABLE"]));
      const [audit] = await db.select({ details: auditLogs.details }).from(auditLogs).where(and(
        eq(auditLogs.userId, household.userId), sql`${auditLogs.details}->>'reason' = 'erasure_file_cleanup_failed'`));
      expect(audit?.details).toMatchObject({ failed: keys.length });

      for (let attempt = 2; attempt <= MAX_PURGE_ATTEMPTS; attempt++) {
        expect(await drainStoragePurgeItems({ ids })).toEqual({ removed: 0, failed: keys.length });
      }
      failing.mockRestore();

      // A later drain's failure is audited per item (the erasure's own drain
      // audited the first); the attempt that reaches the cap is marked capped.
      const later = await db.select({ entityId: auditLogs.entityId, details: auditLogs.details }).from(auditLogs).where(and(
        eq(auditLogs.entityType, "storage_object"), inArray(auditLogs.entityId, ids)));
      expect(later).toHaveLength(ids.length * (MAX_PURGE_ATTEMPTS - 1));
      for (const id of ids) {
        const reasons = later.filter((row) => row.entityId === id).map((row) => (row.details as { reason: string; attempts: number }))
          .sort((a, b) => a.attempts - b.attempts);
        expect(reasons.map((row) => row.reason)).toEqual([
          ...Array.from({ length: MAX_PURGE_ATTEMPTS - 2 }, () => "erasure_purge_retry_failed"), "erasure_purge_capped",
        ]);
      }
      // The capped item raises an operator alert; no purge log line names the household.
      const cappedAlerts = errors.mock.calls.filter(([, context]) => (context as { alert?: string } | undefined)?.alert === "storage_purge_capped");
      expect(cappedAlerts).toHaveLength(ids.length);
      const purgeLogs = errors.mock.calls.filter(([message]) => String(message).includes("purge"));
      expect(purgeLogs.length).toBeGreaterThan(0);
      expect(JSON.stringify(purgeLogs)).not.toContain(household.householdId);

      expect(await drainStoragePurgeItems({ ids })).toEqual({ removed: 0, failed: 0 });
      await drainStoragePurgeItemsAtBoot();
      const { rows: capped } = await pool.query<{ attempts: number }>(
        "SELECT attempts FROM storage_purge_items WHERE id = ANY($1::uuid[])", [ids]);
      expect(capped.map((row) => row.attempts)).toEqual(keys.map(() => MAX_PURGE_ATTEMPTS));
      for (const key of keys) expect(await exists(objectFile(key)), key).toBe(true);
    } finally {
      failing.mockRestore();
      errors.mockRestore();
      await pool.query("DELETE FROM audit_logs WHERE entity_type = 'storage_object' AND details->>'reason' LIKE 'erasure_purge_%'");
    }
  }, 60_000);
});

describe("A-34 a drain needs one database connection", () => {
  it("removes the items while every other pooled connection is taken", async () => {
    const { household, keys } = await seedStoredHousehold("erasure-purge-one-connection");
    seeded.push({ household, keys });
    const { recordPurgeItems, drainStoragePurgeItems } = await loadPurge();
    const manifest = await db.select({ name: storageObjects.uploadName, key: storageObjects.key }).from(storageObjects)
      .where(eq(storageObjects.householdId, household.householdId));
    const targets = manifest.map((row) => ({ name: row.name, key: row.key as UploadObjectTarget["key"] }));
    const ids = await withTransaction((tx) => recordPurgeItems(tx, targets));
    expect(ids).toHaveLength(keys.length);

    // Leave the drain exactly one free connection.
    const held = await Promise.all(Array.from({ length: (pool.options.max ?? 10) - 1 }, () => pool.connect()));
    let outcome: { removed: number; failed: number };
    try {
      outcome = await drainStoragePurgeItems({ ids });
    } finally {
      for (const client of held) client.release();
    }

    expect(outcome).toEqual({ removed: keys.length, failed: 0 });
    for (const key of keys) expect(await exists(objectFile(key)), key).toBe(false);
    expect(await purgeItemsFor(keys)).toEqual([]);
  }, 60_000);
});

describe("A-34 the boot drain", () => {
  it("removes the objects and items a stopped process left behind", async () => {
    const { household, email, keys } = await seedStoredHousehold("erasure-purge-boot");
    seeded.push({ household, keys });
    crash.armed = true;
    await expect(eraseAccount({ userId: household.userId, householdId: household.householdId, userEmail: email }))
      .rejects.toThrow(/synthetic process exit/);
    expect(await purgeItemsFor(keys)).toHaveLength(keys.length);
    const { drainStoragePurgeItemsAtBoot } = await loadPurge();

    await drainStoragePurgeItemsAtBoot();

    for (const key of keys) expect(await exists(objectFile(key)), key).toBe(false);
    expect(await purgeItemsFor(keys)).toEqual([]);
  }, 60_000);
});
