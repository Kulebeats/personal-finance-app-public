/**
 * OPS-001 hardening (#249 Astra 6.2 round):
 * - a legacy move whose COMMIT acknowledgement is lost is reconciled by key,
 *   and a moved personal image keeps its owner (createdBy);
 * - a server answer that leaves the outcome unknown (40003) is not a rollback;
 * - a receipt linked to a private transaction is a 404 to other members on
 *   every route, and receipts are never served by name;
 * - a row naming another household's file is refused by the move and never
 *   reaches erasure;
 * - a banner upload rechecks live membership under the erasure lock order;
 * - a receipt or attachment delete removes each file on its own, a re-encoded
 *   receipt records its real type, and the logo sweep removes a file only
 *   after its record is retired.
 * Real HTTP, real Postgres, local driver.
 */
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import pg from "pg";
import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, like } from "drizzle-orm";
import {
  auditLogs, householdMembers, merchantLogoUploads, merchants, pendingReceipts, storageObjects, transactionAttachments,
  transactions, users,
} from "@shared/schema";
import { db, pool } from "../../db";
import { hashPassword } from "../../auth";
import { createSignedHousehold, insertAccount, type SignedHousehold } from "../../__tests__/signed-household-fixture";
import { completionUnknown, loseAcknowledgement } from "../../__tests__/lost-ack-fixture";
import { getObjectStore, resolveObjectStoreConfiguration } from "../storage/runtime";
import { isDefiniteRollback, putUploadObject, uploadNameOf } from "../storage/upload-objects";
import { moveLegacyUploads } from "../storage/legacy-move";
import { StorageError } from "../storage";
import { eraseAccount } from "../../modules/settings/settings.account-deletion.service";
import { sweepOrphanMerchantLogos } from "../../modules/merchants/merchants.logo-sweep";

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const PASSWORD = "SyntheticOwnership123!";
const WAIT_STEP_MS = 50;
const WAIT_LIMIT_MS = 10_000;
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const png = (seed: number, width = 40 + seed) =>
  sharp({ create: { width, height: 20, channels: 3, background: { r: seed * 20, g: 70, b: 120 } } }).png().toBuffer();
const objectFile = (key: string) => {
  const configuration = resolveObjectStoreConfiguration(process.env);
  if (configuration.driver !== "local") throw new Error("this suite runs on the local-disk driver");
  return path.join(configuration.root, ...key.split("/"));
};
const legacyFile = (name: string) => path.join(UPLOADS_ROOT, ...name.split("/"));
const exists = (file: string) => fs.access(file).then(() => true, () => false);
const manifestByName = async (stored: string) =>
  (await db.select().from(storageObjects).where(eq(storageObjects.uploadName, uploadNameOf(stored)!)))[0];

interface Member { userId: string; headers: Record<string, string> }

async function addMember(household: SignedHousehold): Promise<Member> {
  const userId = randomUUID();
  const email = `ops001-own-${userId}@example.invalid`;
  await db.insert(users).values({ id: userId, email, username: `ops001-own-${userId}`, passwordHash: await hashPassword(PASSWORD), emailVerified: true });
  await db.insert(householdMembers).values({ householdId: household.householdId, userId, role: "member" });
  const login = await request(household.app).post("/api/auth/login").send({ email, password: PASSWORD }).expect(200);
  const cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  return { userId, headers: { Cookie: cookie, "X-Capital-Subject": userId, "X-Capital-Household": household.householdId } };
}

async function removeMember(member: Member): Promise<void> {
  await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [member.userId]);
  await db.delete(auditLogs).where(eq(auditLogs.userId, member.userId));
  await db.delete(storageObjects).where(eq(storageObjects.createdBy, member.userId));
  await db.delete(householdMembers).where(eq(householdMembers.userId, member.userId));
  await db.delete(users).where(eq(users.id, member.userId));
}

async function writeLegacy(name: string, bytes: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(legacyFile(name)), { recursive: true });
  await fs.writeFile(legacyFile(name), bytes);
}

/** Every COMMIT runs as a ROLLBACK and reports a serialization failure: a definite rollback. */
function failEveryCommit() {
  const host = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
  const original = host.query;
  return vi.spyOn(host, "query").mockImplementation(function (this: unknown, ...args: unknown[]) {
    const [first] = args;
    const text = typeof first === "string" ? first : first && typeof first === "object" && "text" in first ? String(first.text) : "";
    if (!/^commit$/i.test(text.trim())) return Reflect.apply(original, this, args);
    return Promise.resolve(Reflect.apply(original, this, ["rollback"])).then(() => {
      throw Object.assign(new pg.DatabaseError("could not serialize access", 0, "error"), { code: "40001" });
    });
  });
}

async function waitUntilBlockedBy(blockerPid: number): Promise<void> {
  for (let waited = 0; waited < WAIT_LIMIT_MS; waited += WAIT_STEP_MS) {
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [blockerPid]);
    if (rows[0].n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
  }
}

let owner: SignedHousehold;
let member: Member;

beforeAll(async () => {
  owner = await createSignedHousehold("ops001-ownership");
  member = await addMember(owner);
}, 60_000);

afterAll(async () => {
  const rows = await db.select().from(storageObjects).where(eq(storageObjects.householdId, owner.householdId));
  for (const row of rows) await fs.rm(objectFile(row.key), { force: true }).then(() => fs.rm(`${objectFile(row.key)}.json`, { force: true }));
  for (const folder of ["receipts", "banners", "merchant-logos"]) {
    await fs.rm(path.join(UPLOADS_ROOT, folder, owner.householdId), { recursive: true, force: true });
  }
  await owner.cleanup(async () => {
    await db.delete(pendingReceipts).where(eq(pendingReceipts.householdId, owner.householdId));
    await db.delete(storageObjects).where(eq(storageObjects.householdId, owner.householdId));
    await removeMember(member);
  });
}, 60_000);

describe("OPS-001 upload ownership and outcomes (real Postgres)", () => {
  it("a legacy move whose COMMIT acknowledgement is lost keeps the object, and the moved banner keeps its owner", async () => {
    const solo = await createSignedHousehold("ops001-move-ack");
    const bannerUrl = `/uploads/banners/${solo.householdId}/${randomUUID()}.png`;
    const bytes = await png(1);
    await writeLegacy(uploadNameOf(bannerUrl)!, bytes);
    await db.update(users).set({ bannerUrl }).where(eq(users.id, solo.userId));
    try {
      const spy = loseAcknowledgement("client", /^commit$/i);
      let report;
      try {
        report = await moveLegacyUploads({ apply: true, householdIds: [solo.householdId] });
      } finally {
        spy.mockRestore();
      }
      expect(report.moved).toHaveLength(1);
      const [row] = await db.select().from(storageObjects).where(eq(storageObjects.key, report.moved[0].key));
      expect(row).toMatchObject({ uploadName: uploadNameOf(bannerUrl), createdBy: solo.userId, sha256: sha(bytes) });
      expect(await exists(objectFile(row.key))).toBe(true);
      await fs.rm(legacyFile(uploadNameOf(bannerUrl)!), { force: true });
      const served = await request(solo.app).get(bannerUrl).set(solo.headers).buffer(true).expect(200);
      expect(sha(served.body as Buffer)).toBe(sha(bytes));
    } finally {
      const rows = await db.select().from(storageObjects).where(like(storageObjects.uploadName, `banners/${solo.householdId}/%`));
      for (const row of rows) await fs.rm(objectFile(row.key), { force: true }).then(() => fs.rm(`${objectFile(row.key)}.json`, { force: true }));
      await fs.rm(path.join(UPLOADS_ROOT, "banners", solo.householdId), { recursive: true, force: true });
      await solo.cleanup(async () => {
        await db.delete(storageObjects).where(like(storageObjects.uploadName, `banners/${solo.householdId}/%`));
        await db.update(users).set({ bannerUrl: null }).where(eq(users.id, solo.userId));
      });
    }
  }, 60_000);

  it("a receipt insert answered with 'completion unknown' (40003) keeps both files when the row committed", async () => {
    expect(isDefiniteRollback(completionUnknown())).toBe(false);
    const spy = loseAcknowledgement("pool", /^insert into "pending_receipts"/i, completionUnknown);
    let upload;
    try {
      upload = await request(owner.app).post("/api/receipts/upload").set(owner.headers)
        .attach("file", await png(2), { filename: "receipt.png", contentType: "image/png" });
    } finally {
      spy.mockRestore();
    }
    expect(upload.status).toBe(201);
    await request(owner.app).get(`/api/receipts/${upload.body.data.receiptId}/ocr-image`).set(owner.headers).expect(200);
    await request(owner.app).get(`/api/receipts/${upload.body.data.receiptId}/thumbnail`).set(owner.headers).expect(200);
  });

  it("a receipt linked to a private transaction is a 404 to another member on every route, and never served by name", async () => {
    const accountId = await insertAccount(owner);
    const transactionId = randomUUID();
    await db.insert(transactions).values({ id: transactionId, householdId: owner.householdId, accountId, ownerUserId: owner.userId,
      date: "2026-11-18", name: "Synthetic private receipt purchase", amount: "14.00", type: "expense", isPrivate: true });
    const upload = await request(owner.app).post("/api/receipts/upload").set(owner.headers)
      .attach("file", await png(3), { filename: "receipt.png", contentType: "image/png" }).expect(201);
    const receiptId: string = upload.body.data.receiptId;
    await db.update(pendingReceipts).set({ matchedTransactionId: transactionId, matchStatus: "matched" }).where(eq(pendingReceipts.id, receiptId));
    const [receipt] = await db.select().from(pendingReceipts).where(eq(pendingReceipts.id, receiptId));

    for (const route of ["", "/ocr-image", "/thumbnail"]) {
      await request(owner.app).get(`/api/receipts/${receiptId}${route}`).set(member.headers).expect(404);
      await request(owner.app).get(`/api/receipts/${receiptId}${route}`).set(owner.headers).expect(200);
    }
    for (const stored of [receipt.storagePath, receipt.thumbnailPath!]) {
      await request(owner.app).get(`/uploads/${uploadNameOf(stored)}`).set(member.headers).expect(403);
      await request(owner.app).get(`/uploads/${uploadNameOf(stored)}`).set(owner.headers).expect(403);
    }
  });

  it("a receipt row naming another household's files is refused by the move and survives that household's erasure", async () => {
    const victim = await createSignedHousehold("ops001-victim");
    const stale = await createSignedHousehold("ops001-stale");
    const legacyOnly = `uploads/receipts/${victim.householdId}/${randomUUID()}.png`;
    const stored = `uploads/receipts/${victim.householdId}/${randomUUID()}_thumb.jpg`;
    await writeLegacy(uploadNameOf(legacyOnly)!, await png(4));
    const object = await putUploadObject({ stored, householdId: victim.householdId, purpose: "receipt-thumbnail", bytes: await png(5),
      mediaType: "image/jpeg", userId: victim.userId });
    await db.insert(pendingReceipts).values({ householdId: stale.householdId, uploadedBy: stale.userId, filename: "x.png",
      originalFilename: "x.png", mimeType: "image/png", size: 10, storagePath: legacyOnly, thumbnailPath: stored,
      ocrStatus: "pending", matchStatus: "pending" });
    try {
      const report = await moveLegacyUploads({ apply: true, householdIds: [stale.householdId] });
      expect(report.moved).toEqual([]);
      expect(report.refused).toEqual(expect.arrayContaining([
        { source: "pending_receipts.storage_path", reason: "outside its owner's folder" },
        { source: "pending_receipts.thumbnail_path", reason: "outside its owner's folder" },
      ]));
      expect(await manifestByName(legacyOnly)).toBeUndefined();

      const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, stale.userId));
      expect(await eraseAccount({ userId: stale.userId, householdId: stale.householdId, userEmail: user.email })).toEqual({ householdDeleted: true });
      expect(await exists(legacyFile(uploadNameOf(legacyOnly)!))).toBe(true);
      expect(await manifestByName(stored)).toMatchObject({ householdId: victim.householdId });
      expect(await exists(objectFile(object.key!))).toBe(true);
    } finally {
      await db.delete(pendingReceipts).where(eq(pendingReceipts.householdId, stale.householdId));
      await db.delete(auditLogs).where(eq(auditLogs.userId, stale.userId));
      await db.delete(users).where(eq(users.id, stale.userId));
      await fs.rm(objectFile(object.key!), { force: true }).then(() => fs.rm(`${objectFile(object.key!)}.json`, { force: true }));
      await fs.rm(path.join(UPLOADS_ROOT, "receipts", victim.householdId), { recursive: true, force: true });
      await victim.cleanup(async () => { await db.delete(storageObjects).where(eq(storageObjects.householdId, victim.householdId)); });
    }
  }, 60_000);

  it("a banner upload waiting behind the erasure's membership lock finds the member gone and stores nothing", async () => {
    const leaving = await addMember(owner);
    const eraser = await pool.connect();
    try {
      await eraser.query("BEGIN");
      await eraser.query("SELECT 1 FROM household_members WHERE household_id = $1 AND user_id = $2 FOR UPDATE", [owner.householdId, leaving.userId]);
      const { rows: [{ pid }] } = await eraser.query("SELECT pg_backend_pid() AS pid");
      const pending = request(owner.app).post("/api/settings/profile/banner").set(leaving.headers)
        .attach("banner", await png(6), { filename: "banner.png", contentType: "image/png" }).then((response) => response);
      await Promise.race([pending, waitUntilBlockedBy(pid)]);
      await eraser.query("DELETE FROM household_members WHERE household_id = $1 AND user_id = $2", [owner.householdId, leaving.userId]);
      await eraser.query("COMMIT");

      expect((await pending).status).toBe(404);
      const [user] = await db.select({ bannerUrl: users.bannerUrl }).from(users).where(eq(users.id, leaving.userId));
      expect(user.bannerUrl).toBeNull();
      expect(await db.select().from(storageObjects).where(eq(storageObjects.createdBy, leaving.userId))).toEqual([]);
    } finally {
      await eraser.query("ROLLBACK").catch(() => undefined);
      eraser.release();
      await removeMember(leaving);
    }
  }, 60_000);

  it("a receipt delete whose image removal fails still removes the thumbnail, and the image stays unreachable", async () => {
    const upload = await request(owner.app).post("/api/receipts/upload").set(owner.headers)
      .attach("file", await png(7), { filename: "receipt.png", contentType: "image/png" }).expect(201);
    const receiptId: string = upload.body.data.receiptId;
    const [receipt] = await db.select().from(pendingReceipts).where(eq(pendingReceipts.id, receiptId));
    const image = await manifestByName(receipt.storagePath);
    const thumbnail = await manifestByName(receipt.thumbnailPath!);

    const failing = vi.spyOn(getObjectStore(), "delete").mockRejectedValueOnce(new StorageError("UNAVAILABLE", "unknown"));
    try {
      await request(owner.app).delete(`/api/receipts/${receiptId}`).set(owner.headers).expect(200);
    } finally {
      failing.mockRestore();
    }
    expect(await manifestByName(receipt.storagePath)).toMatchObject({ key: image.key });
    expect(await manifestByName(receipt.thumbnailPath!)).toBeUndefined();
    expect(await exists(objectFile(thumbnail.key))).toBe(false);
    await request(owner.app).get(`/api/receipts/${receiptId}/ocr-image`).set(owner.headers).expect(404);
    await request(owner.app).get(`/uploads/${uploadNameOf(receipt.storagePath)}`).set(owner.headers).expect(403);
  });

  it("a receipt resized and re-encoded is recorded and served as JPEG", async () => {
    const upload = await request(owner.app).post("/api/receipts/upload").set(owner.headers)
      .attach("file", await png(8, 2100), { filename: "wide.png", contentType: "image/png" }).expect(201);
    const receiptId: string = upload.body.data.receiptId;
    const [receipt] = await db.select().from(pendingReceipts).where(eq(pendingReceipts.id, receiptId));
    expect(receipt).toMatchObject({ mimeType: "image/jpeg" });
    expect(receipt.storagePath).toMatch(/\.jpg$/);
    expect(await manifestByName(receipt.storagePath)).toMatchObject({ mediaType: "image/jpeg" });
    const served = await request(owner.app).get(`/api/receipts/${receiptId}/ocr-image`).set(owner.headers).expect(200);
    expect(served.headers["content-type"]).toMatch(/^image\/jpeg/);
  });

  it("an attachment delete removes the legacy thumbnail its row names, not only the file", async () => {
    const accountId = await insertAccount(owner);
    const transactionId = randomUUID();
    await db.insert(transactions).values({ id: transactionId, householdId: owner.householdId, accountId, ownerUserId: owner.userId,
      date: "2026-11-18", name: "Synthetic legacy attachment", amount: "4.00", type: "expense", isPrivate: false });
    const folder = path.join(UPLOADS_ROOT, "transactions", transactionId);
    const file = path.join(folder, `${randomUUID()}.png`);
    const thumb = path.join(folder, `${randomUUID()}_thumb.jpg`);
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(file, await png(9));
    await fs.writeFile(thumb, await png(10));
    const [attachment] = await db.insert(transactionAttachments).values({ transactionId, filename: path.basename(file), originalFilename: "slip.png",
      mimeType: "image/png", size: 10, storagePath: file, thumbnailPath: thumb, uploadedBy: owner.userId }).returning();
    try {
      await request(owner.app).delete(`/api/transactions/${transactionId}/attachments/${attachment.id}`).set(owner.headers).expect(200);
      expect([await exists(file), await exists(thumb)]).toEqual([false, false]);
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  });

  it("a logo sweep whose retirement rolls back keeps both the record and its file", async () => {
    const [merchant] = await db.insert(merchants).values({ householdId: owner.householdId, name: "Synthetic Ownership Sweep" })
      .returning({ id: merchants.id });
    const storedFilename = `${randomUUID()}.png`;
    const filePath = path.posix.join("uploads", "merchant-logos", owner.householdId, storedFilename);
    await writeLegacy(uploadNameOf(filePath)!, Buffer.from("synthetic logo bytes"));
    await db.insert(merchantLogoUploads).values({ merchantId: merchant.id, originalFilename: "logo.png", storedFilename, filePath,
      fileSize: 20, mimeType: "image/png", uploadedBy: owner.userId, uploadedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) });

    const spy = failEveryCommit();
    let summary;
    try {
      summary = await sweepOrphanMerchantLogos();
    } finally {
      spy.mockRestore();
    }
    expect(summary.failed).toBeGreaterThanOrEqual(1);
    const rows = await db.select().from(merchantLogoUploads).where(and(eq(merchantLogoUploads.merchantId, merchant.id), eq(merchantLogoUploads.filePath, filePath)));
    expect(rows).toHaveLength(1);
    expect(await exists(legacyFile(uploadNameOf(filePath)!))).toBe(true);
    await db.delete(merchantLogoUploads).where(eq(merchantLogoUploads.merchantId, merchant.id));
  });
});
