/**
 * OPS-001 hardening (#249 Astra r3):
 * - a write whose acknowledgement is lost after it committed never loses the
 *   bytes its row names (manifest insert, receipt insert, banner commit);
 * - a name Windows would open as another file (trailing "." or " ", a device
 *   name) is refused before authorization and before the legacy fallback;
 * - a co-member erasure removes the user's own unreferenced banner and picture
 *   objects and leaves jointly owned uploads alone;
 * - a rollback rerun retries an object whose manifest row is already gone.
 * Real HTTP, real Postgres, local driver.
 */
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loseAcknowledgement } from "../../__tests__/lost-ack-fixture";
import { and, eq, like } from "drizzle-orm";
import { auditLogs, householdMembers, pendingReceipts, storageObjects, users } from "@shared/schema";
import { db } from "../../db";
import { createSignedHousehold, type SignedHousehold } from "../../__tests__/signed-household-fixture";
import { getObjectStore, resolveObjectStoreConfiguration } from "../storage/runtime";
import { isDefiniteRollback, putUploadObject, uploadNameOf } from "../storage/upload-objects";
import { moveLegacyUploads, rollbackLegacyMove } from "../storage/legacy-move";
import { StorageError } from "../storage";
import { ValidationError } from "../errors";
import { eraseAccount } from "../../modules/settings/settings.account-deletion.service";

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const png = (seed: number) => sharp({ create: { width: 40 + seed, height: 20, channels: 3, background: { r: seed * 20, g: 90, b: 30 } } }).png().toBuffer();
const objectFile = (key: string) => {
  const configuration = resolveObjectStoreConfiguration(process.env);
  if (configuration.driver !== "local") throw new Error("this suite runs on the local-disk driver");
  return path.join(configuration.root, ...key.split("/"));
};
const exists = (file: string) => fs.access(file).then(() => true, () => false);
const manifestByKey = async (key: string) => (await db.select().from(storageObjects).where(eq(storageObjects.key, key)))[0];

let owner: SignedHousehold;

beforeAll(async () => {
  owner = await createSignedHousehold("ops001-outcome");
}, 60_000);

afterAll(async () => {
  const rows = await db.select().from(storageObjects).where(eq(storageObjects.householdId, owner.householdId));
  for (const row of rows) await fs.rm(objectFile(row.key), { force: true }).then(() => fs.rm(`${objectFile(row.key)}.json`, { force: true }));
  await fs.rm(path.join(UPLOADS_ROOT, "receipts", owner.householdId), { recursive: true, force: true });
  await fs.rm(path.join(UPLOADS_ROOT, "banners", owner.householdId), { recursive: true, force: true });
  await owner.cleanup(async () => {
    await db.delete(pendingReceipts).where(eq(pendingReceipts.householdId, owner.householdId));
    await db.delete(storageObjects).where(eq(storageObjects.householdId, owner.householdId));
    await db.update(users).set({ bannerUrl: null }).where(eq(users.id, owner.userId));
  });
}, 60_000);

describe("OPS-001 upload write outcomes and names (real Postgres)", () => {
  it("only a database answer or an application refusal counts as a definite rollback", async () => {
    const rejected = await db.insert(storageObjects).values({ key: "v1/receipt/x", uploadName: "receipts/x/y.png",
      householdId: randomUUID(), purpose: "receipt", sha256: "0", size: 1, mediaType: "image/png" }).catch((error: unknown) => error);
    expect(isDefiniteRollback(rejected)).toBe(true);
    expect(isDefiniteRollback(new ValidationError("refused inside the transaction"))).toBe(true);
    expect(isDefiniteRollback(new Error("Connection terminated unexpectedly"))).toBe(false);
  });

  it("a manifest insert that committed with its acknowledgement lost keeps the object and succeeds", async () => {
    const stored = `uploads/receipts/${owner.householdId}/${randomUUID()}.png`;
    const bytes = await png(1);
    const spy = loseAcknowledgement("pool", /^insert into "storage_objects"/i);
    let target;
    try {
      target = await putUploadObject({ stored, householdId: owner.householdId, purpose: "receipt", bytes, mediaType: "image/png", userId: owner.userId });
    } finally {
      spy.mockRestore();
    }
    expect(await manifestByKey(target.key!)).toMatchObject({ uploadName: uploadNameOf(stored), sha256: sha(bytes) });
    expect(await exists(objectFile(target.key!))).toBe(true);
  });

  it("a receipt insert that committed with its acknowledgement lost keeps both files the row names", async () => {
    const spy = loseAcknowledgement("pool", /^insert into "pending_receipts"/i);
    let upload;
    try {
      upload = await request(owner.app).post("/api/receipts/upload").set(owner.headers)
        .attach("file", await png(2), { filename: "receipt.png", contentType: "image/png" });
    } finally {
      spy.mockRestore();
    }
    expect(upload.status).toBe(201);
    const [receipt] = await db.select().from(pendingReceipts).where(eq(pendingReceipts.id, upload.body.data.receiptId));
    for (const stored of [receipt.storagePath, receipt.thumbnailPath!]) {
      const [row] = await db.select().from(storageObjects).where(eq(storageObjects.uploadName, uploadNameOf(stored)!));
      expect(row, stored).toBeDefined();
      expect(await exists(objectFile(row.key)), stored).toBe(true);
    }
    await request(owner.app).get(`/api/receipts/${receipt.id}/ocr-image`).set(owner.headers).expect(200);
  });

  it("a banner update whose COMMIT acknowledgement is lost keeps the file the committed row names", async () => {
    const bytes = await png(3);
    const spy = loseAcknowledgement("client", /^commit$/i);
    try {
      await request(owner.app).post("/api/settings/profile/banner").set(owner.headers)
        .attach("banner", bytes, { filename: "banner.png", contentType: "image/png" }).expect(500);
    } finally {
      spy.mockRestore();
    }
    const [user] = await db.select({ bannerUrl: users.bannerUrl }).from(users).where(eq(users.id, owner.userId));
    expect(user.bannerUrl).toMatch(new RegExp(`^/uploads/banners/${owner.householdId}/`));
    const served = await request(owner.app).get(user.bannerUrl!).set(owner.headers).buffer(true).expect(200);
    expect(sha(served.body as Buffer)).toBe(sha(bytes));
  });

  it("a trailing dot or space, a stream suffix or a device name is refused before authorization and the legacy fallback", async () => {
    const base = `banners/${owner.householdId}/${randomUUID()}.png`;
    for (const name of [`${base}.`, `${base} `, `${base}:stream`, `banners/${owner.householdId}/nul.png`, `banners/${owner.householdId}/COM1`]) {
      expect(uploadNameOf(`/uploads/${name}`), name).toBeNull();
    }
    // A stale legacy copy that Windows would open for "id.png." without a checksum.
    const stored = `/uploads/${base}`;
    await putUploadObject({ stored, householdId: owner.householdId, purpose: "banner", bytes: await png(4), mediaType: "image/png", userId: owner.userId });
    const legacy = path.join(UPLOADS_ROOT, ...base.split("/"));
    await fs.mkdir(path.dirname(legacy), { recursive: true });
    await fs.writeFile(legacy, Buffer.from("stale legacy bytes"));
    for (const alias of [`${stored}.`, `${stored}%20`, `${stored}%3Astream`, `/uploads/banners/${owner.householdId}/nul.png`]) {
      await request(owner.app).get(alias).set(owner.headers).expect(403);
    }
  });

  it("a co-member erasure removes the user's unreferenced banner and picture objects, not jointly owned uploads", async () => {
    const memberId = randomUUID();
    const email = `ops001-co-${memberId}@example.invalid`;
    await db.insert(users).values({ id: memberId, email, username: `ops001-co-${memberId}`, passwordHash: "x", emailVerified: true });
    await db.insert(householdMembers).values({ householdId: owner.householdId, userId: memberId, role: "member" });
    const put = async (stored: string, purpose: "banner" | "profile-picture" | "receipt", seed: number) =>
      putUploadObject({ stored, householdId: owner.householdId, purpose, bytes: await png(seed), mediaType: "image/png", userId: memberId });
    // Stored just before a crash: no users row names them.
    const banner = await put(`/uploads/banners/${owner.householdId}/${randomUUID()}.png`, "banner", 5);
    const picture = await put(`/uploads/profile-pictures/${owner.householdId}/${randomUUID()}.png`, "profile-picture", 6);
    const joint = await put(`uploads/receipts/${owner.householdId}/${randomUUID()}.png`, "receipt", 7);
    try {
      expect(await eraseAccount({ userId: memberId, householdId: owner.householdId, userEmail: email })).toMatchObject({ householdDeleted: false });
      for (const personal of [banner, picture]) {
        expect(await manifestByKey(personal.key!), personal.name).toBeUndefined();
        expect(await exists(objectFile(personal.key!)), personal.name).toBe(false);
      }
      expect(await manifestByKey(joint.key!)).toBeDefined();
      expect(await exists(objectFile(joint.key!))).toBe(true);
    } finally {
      await db.delete(auditLogs).where(eq(auditLogs.userId, memberId));
      await db.delete(householdMembers).where(and(eq(householdMembers.householdId, owner.householdId), eq(householdMembers.userId, memberId)));
      await db.delete(users).where(eq(users.id, memberId));
    }
  }, 60_000);

  it("a rollback whose object delete failed after its manifest row went is finished by a rerun", async () => {
    const solo = await createSignedHousehold("ops001-rerun");
    const bannerUrl = `/uploads/banners/${solo.householdId}/${randomUUID()}.png`;
    const legacy = path.join(UPLOADS_ROOT, ...bannerUrl.slice("/uploads/".length).split("/"));
    await fs.mkdir(path.dirname(legacy), { recursive: true });
    await fs.writeFile(legacy, await png(8));
    await db.update(users).set({ bannerUrl }).where(eq(users.id, solo.userId));
    try {
      const report = await moveLegacyUploads({ apply: true, householdIds: [solo.householdId] });
      const [{ key }] = report.moved;
      const store = getObjectStore();
      const failing = vi.spyOn(store, "delete").mockRejectedValueOnce(new StorageError("UNAVAILABLE", "unknown"));
      try {
        expect(await rollbackLegacyMove([key])).toMatchObject({ removed: 0, pendingCleanup: [key] });
      } finally {
        failing.mockRestore();
      }
      expect(await manifestByKey(key)).toBeUndefined();
      expect(await exists(objectFile(key))).toBe(true);

      expect(await rollbackLegacyMove([key])).toEqual({ removed: 0, restored: 0, refused: [], skipped: 0, retried: 1, pendingCleanup: [] });
      expect(await exists(objectFile(key))).toBe(false);
      await request(solo.app).get(bannerUrl).set(solo.headers).expect(200);
    } finally {
      await fs.rm(path.dirname(legacy), { recursive: true, force: true });
      await solo.cleanup(async () => {
        await db.delete(storageObjects).where(like(storageObjects.uploadName, `banners/${solo.householdId}/%`));
        await db.update(users).set({ bannerUrl: null }).where(eq(users.id, solo.userId));
      });
    }
  }, 60_000);
});
