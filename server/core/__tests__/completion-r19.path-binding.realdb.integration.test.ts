/**
 * OPS-001 follow-up B: a stored path or manifest name that does not match its
 * row is refused, never followed.
 * - a receipt row whose paths name another receipt's files serves neither;
 * - the legacy move and its rollback audit a private receipt's digest without
 *   household scope;
 * - an attachment delete never removes a file outside its own transaction;
 * - last-member erasure never unlinks a legacy file outside its household,
 *   whatever a manifest row names.
 * Each case plants the inconsistent path. Real HTTP, real Postgres, local driver.
 */
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { auditLogs, householdMembers, pendingReceipts, storageObjects, transactionAttachments, transactions, users } from "@shared/schema";
import { db, pool } from "../../db";
import { hashPassword } from "../../auth";
import { createSignedHousehold, insertAccount, type SignedHousehold } from "../../__tests__/signed-household-fixture";
import { resolveObjectStoreConfiguration } from "../storage/runtime";
import { putUploadObject, uploadNameOf } from "../storage/upload-objects";
import { moveLegacyUploads, rollbackLegacyMove } from "../storage/legacy-move";
import { nameMatchesReceipt } from "../storage/receipt-files";
import { eraseAccount } from "../../modules/settings/settings.account-deletion.service";

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const PASSWORD = "SyntheticPathBinding123!";
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const png = (seed: number) =>
  sharp({ create: { width: 30 + seed, height: 20, channels: 3, background: { r: seed * 20, g: 90, b: 40 } } }).png().toBuffer();
const objectFile = (key: string) => {
  const configuration = resolveObjectStoreConfiguration(process.env);
  if (configuration.driver !== "local") throw new Error("this suite runs on the local-disk driver");
  return path.join(configuration.root, ...key.split("/"));
};
const legacyFile = (name: string) => path.join(UPLOADS_ROOT, ...name.split("/"));
const exists = (file: string) => fs.access(file).then(() => true, () => false);
const manifestByName = async (stored: string) =>
  (await db.select().from(storageObjects).where(eq(storageObjects.uploadName, uploadNameOf(stored)!)))[0];

async function writeLegacy(name: string, bytes: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(legacyFile(name)), { recursive: true });
  await fs.writeFile(legacyFile(name), bytes);
}

async function removeObject(key: string): Promise<void> {
  await fs.rm(objectFile(key), { force: true });
  await fs.rm(`${objectFile(key)}.json`, { force: true });
}

interface Member { userId: string; headers: Record<string, string> }

async function addMember(household: SignedHousehold): Promise<Member> {
  const userId = randomUUID();
  const email = `ops001-bind-${userId}@example.invalid`;
  await db.insert(users).values({ id: userId, email, username: `ops001-bind-${userId}`, passwordHash: await hashPassword(PASSWORD), emailVerified: true });
  await db.insert(householdMembers).values({ householdId: household.householdId, userId, role: "member" });
  const login = await request(household.app).post("/api/auth/login").send({ email, password: PASSWORD }).expect(200);
  const cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  return { userId, headers: { Cookie: cookie, "X-Capital-Subject": userId, "X-Capital-Household": household.householdId } };
}

async function insertTransaction(household: SignedHousehold, isPrivate: boolean, accountPrivate = false): Promise<string> {
  const accountId = await insertAccount(household, { isPrivate: accountPrivate });
  const id = randomUUID();
  await db.insert(transactions).values({ id, householdId: household.householdId, accountId, ownerUserId: household.userId,
    date: "2026-11-20", name: "Synthetic path-binding purchase", amount: "9.00", type: "expense", isPrivate });
  return id;
}

let owner: SignedHousehold;
let member: Member;

beforeAll(async () => {
  owner = await createSignedHousehold("ops001-binding");
  member = await addMember(owner);
}, 60_000);

afterAll(async () => {
  const rows = await db.select().from(storageObjects).where(eq(storageObjects.householdId, owner.householdId));
  for (const row of rows) await removeObject(row.key);
  await fs.rm(path.join(UPLOADS_ROOT, "receipts", owner.householdId), { recursive: true, force: true });
  await owner.cleanup(async () => {
    await db.delete(pendingReceipts).where(eq(pendingReceipts.householdId, owner.householdId));
    await db.delete(storageObjects).where(eq(storageObjects.householdId, owner.householdId));
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [member.userId]);
    await db.delete(auditLogs).where(eq(auditLogs.userId, member.userId));
    await db.delete(householdMembers).where(eq(householdMembers.userId, member.userId));
    await db.delete(users).where(eq(users.id, member.userId));
  });
}, 60_000);

describe("OPS-001 stored paths bound to their rows (real Postgres)", () => {
  it("a receipt's own legacy image name binds for any extension the old writer kept from the original filename", () => {
    const receipt = { id: randomUUID(), householdId: randomUUID() };
    for (const ext of [".png", ".JPEG", ".heic", ".final_v2", ".jp-g"]) {
      expect(nameMatchesReceipt(`receipts/${receipt.householdId}/${receipt.id}${ext}`, receipt, "receipt")).toBe(true);
    }
    expect(nameMatchesReceipt(`receipts/${receipt.householdId}/${receipt.id.toUpperCase()}_thumb.jpg`, receipt, "receipt-thumbnail")).toBe(true);
    expect(nameMatchesReceipt(`receipts/${receipt.householdId}/${randomUUID()}.png`, receipt, "receipt")).toBe(false);
    expect(nameMatchesReceipt(`receipts/${receipt.householdId}/${receipt.id}_thumb.jpg`, receipt, "receipt")).toBe(false);
    expect(nameMatchesReceipt(`receipts/${randomUUID()}/${receipt.id}.png`, receipt, "receipt")).toBe(false);
  });

  it("a receipt row whose paths name another member's private receipt files serves neither", async () => {
    const privateTransaction = await insertTransaction(owner, true);
    const upload = await request(owner.app).post("/api/receipts/upload").set(owner.headers)
      .attach("file", await png(1), { filename: "receipt.png", contentType: "image/png" }).expect(201);
    const privateId: string = upload.body.data.receiptId;
    await db.update(pendingReceipts).set({ matchedTransactionId: privateTransaction, matchStatus: "matched" }).where(eq(pendingReceipts.id, privateId));
    const [privateReceipt] = await db.select().from(pendingReceipts).where(eq(pendingReceipts.id, privateId));

    // The member's own, unlinked receipt row, its paths planted to name the private receipt's files.
    const [stale] = await db.insert(pendingReceipts).values({ householdId: owner.householdId, uploadedBy: member.userId, filename: "stale.png",
      originalFilename: "stale.png", mimeType: "image/png", size: 10, storagePath: privateReceipt.storagePath,
      thumbnailPath: privateReceipt.thumbnailPath, ocrStatus: "completed", matchStatus: "pending" }).returning();

    await request(owner.app).get(`/api/receipts/${stale.id}`).set(member.headers).expect(200);
    for (const route of ["/ocr-image", "/thumbnail"]) {
      await request(owner.app).get(`/api/receipts/${stale.id}${route}`).set(member.headers).expect(404);
      await request(owner.app).get(`/api/receipts/${stale.id}${route}`).set(owner.headers).expect(404);
      await request(owner.app).get(`/api/receipts/${privateId}${route}`).set(owner.headers).expect(200);
    }
  });

  it("the legacy move and its rollback audit a private receipt's digest without household scope", async () => {
    const privateTransaction = await insertTransaction(owner, false, true);
    const privateId = randomUUID();
    const sharedId = randomUUID();
    const folder = `uploads/receipts/${owner.householdId}`;
    const planted = [
      { id: privateId, matched: privateTransaction, image: await png(2), thumb: await png(3) },
      { id: sharedId, matched: null, image: await png(4), thumb: await png(5) },
    ];
    for (const receipt of planted) {
      const storagePath = `${folder}/${receipt.id}.png`;
      const thumbnailPath = `${folder}/${receipt.id}_thumb.jpg`;
      await writeLegacy(uploadNameOf(storagePath)!, receipt.image);
      await writeLegacy(uploadNameOf(thumbnailPath)!, receipt.thumb);
      await db.insert(pendingReceipts).values({ id: receipt.id, householdId: owner.householdId, uploadedBy: owner.userId, filename: `${receipt.id}.png`,
        originalFilename: "legacy.png", mimeType: "image/png", size: receipt.image.length, storagePath, thumbnailPath, ocrStatus: "completed",
        matchStatus: receipt.matched ? "matched" : "pending", matchedTransactionId: receipt.matched });
    }
    const report = await moveLegacyUploads({ apply: true, householdIds: [owner.householdId] });
    const movedByReceipt = (id: string) => report.moved.filter((moved) => moved.name.includes(id));
    expect(movedByReceipt(privateId)).toHaveLength(2);
    expect(movedByReceipt(sharedId)).toHaveLength(2);
    const keys = report.moved.map((moved) => moved.key);
    const auditScope = async (action: string, id: string) => {
      const entityIds = movedByReceipt(id).map((moved) => moved.key.slice(-36));
      const rows = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "storage_object"), eq(auditLogs.action, action),
        inArray(auditLogs.entityId, entityIds)));
      return rows.map((row) => row.householdId);
    };
    try {
      expect(await auditScope("CREATE", privateId)).toEqual([null, null]);
      expect(await auditScope("CREATE", sharedId)).toEqual([owner.householdId, owner.householdId]);
      const privateDigests = movedByReceipt(privateId).map((moved) => moved.sha256);
      expect(privateDigests).toEqual(expect.arrayContaining([sha(planted[0].image), sha(planted[0].thumb)]));
      const householdRows = await db.select({ details: auditLogs.details }).from(auditLogs).where(eq(auditLogs.householdId, owner.householdId));
      for (const digest of privateDigests) expect(JSON.stringify(householdRows)).not.toContain(digest);

      expect((await rollbackLegacyMove(keys)).removed).toBe(4);
      expect(await auditScope("DELETE", privateId)).toEqual([null, null]);
      expect(await auditScope("DELETE", sharedId)).toEqual([owner.householdId, owner.householdId]);
      const afterRollback = await db.select({ details: auditLogs.details }).from(auditLogs).where(eq(auditLogs.householdId, owner.householdId));
      for (const digest of privateDigests) expect(JSON.stringify(afterRollback)).not.toContain(digest);
    } finally {
      await db.delete(auditLogs).where(and(eq(auditLogs.entityType, "storage_object"), inArray(auditLogs.entityId, keys.map((key) => key.slice(-36)))));
      await rollbackLegacyMove(keys).catch(() => undefined);
      for (const key of keys) await removeObject(key);
    }
  }, 60_000);

  it("an attachment delete leaves alone a thumbnail path that names another transaction's file", async () => {
    const mine = await insertTransaction(owner, false);
    const theirs = await insertTransaction(owner, true);
    const ownFolder = path.join(UPLOADS_ROOT, "transactions", mine);
    const ownFile = path.join(ownFolder, `${randomUUID()}.png`);
    await fs.mkdir(ownFolder, { recursive: true });
    await fs.writeFile(ownFile, await png(6));
    const victimStored = `uploads/transactions/${theirs}/${randomUUID()}_thumb.jpg`;
    const victimLegacy = `uploads/transactions/${theirs}/${randomUUID()}.png`;
    await writeLegacy(uploadNameOf(victimLegacy)!, await png(7));
    const victim = await putUploadObject({ stored: victimStored, householdId: owner.householdId, purpose: "attachment", bytes: await png(8),
      mediaType: "image/jpeg", userId: owner.userId });
    const [attachment] = await db.insert(transactionAttachments).values({ transactionId: mine, filename: path.basename(ownFile), originalFilename: "slip.png",
      mimeType: "image/png", size: 10, storagePath: ownFile, thumbnailPath: victimStored, uploadedBy: owner.userId }).returning();
    const [second] = await db.insert(transactionAttachments).values({ transactionId: mine, filename: "x.png", originalFilename: "slip2.png",
      mimeType: "image/png", size: 10, storagePath: victimLegacy, uploadedBy: owner.userId }).returning();
    try {
      await request(owner.app).delete(`/api/transactions/${mine}/attachments/${attachment.id}`).set(owner.headers).expect(200);
      await request(owner.app).delete(`/api/transactions/${mine}/attachments/${second.id}`).set(owner.headers).expect(200);
      expect(await exists(ownFile)).toBe(false);
      expect(await manifestByName(victimStored)).toMatchObject({ key: victim.key });
      expect(await exists(objectFile(victim.key!))).toBe(true);
      expect(await exists(legacyFile(uploadNameOf(victimLegacy)!))).toBe(true);
    } finally {
      await db.delete(storageObjects).where(eq(storageObjects.key, victim.key!));
      await removeObject(victim.key!);
      await fs.rm(ownFolder, { recursive: true, force: true });
      await fs.rm(path.join(UPLOADS_ROOT, "transactions", theirs), { recursive: true, force: true });
    }
  });

  it("last-member erasure deletes its manifest objects but never unlinks a legacy file outside its household", async () => {
    const victim = await createSignedHousehold("ops001-bind-victim");
    const erased = await createSignedHousehold("ops001-bind-erased");
    const victimTransaction = await insertTransaction(victim, true);
    const receiptName = `receipts/${victim.householdId}/${randomUUID()}.png`;
    const attachmentName = `transactions/${victimTransaction}/${randomUUID()}.png`;
    await writeLegacy(receiptName, await png(9));
    await writeLegacy(attachmentName, await png(10));
    // Manifest rows of the erased household whose names point into the victim's folders.
    const receiptObject = await putUploadObject({ stored: `uploads/${receiptName}`, householdId: erased.householdId, purpose: "receipt",
      bytes: await png(11), mediaType: "image/png", userId: erased.userId });
    const attachmentObject = await putUploadObject({ stored: `uploads/${attachmentName}`, householdId: erased.householdId, purpose: "attachment",
      bytes: await png(12), mediaType: "image/png", userId: erased.userId });
    try {
      const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, erased.userId));
      expect(await eraseAccount({ userId: erased.userId, householdId: erased.householdId, userEmail: user.email })).toEqual({ householdDeleted: true });
      expect([await exists(legacyFile(receiptName)), await exists(legacyFile(attachmentName))]).toEqual([true, true]);
      expect([await exists(objectFile(receiptObject.key!)), await exists(objectFile(attachmentObject.key!))]).toEqual([false, false]);
      expect(await db.select().from(storageObjects).where(eq(storageObjects.householdId, erased.householdId))).toEqual([]);
    } finally {
      await db.delete(storageObjects).where(inArray(storageObjects.key, [receiptObject.key!, attachmentObject.key!]));
      for (const key of [receiptObject.key!, attachmentObject.key!]) await removeObject(key);
      await db.delete(auditLogs).where(eq(auditLogs.userId, erased.userId));
      await db.delete(users).where(eq(users.id, erased.userId));
      await fs.rm(path.join(UPLOADS_ROOT, "receipts", victim.householdId), { recursive: true, force: true });
      await fs.rm(path.join(UPLOADS_ROOT, "transactions", victimTransaction), { recursive: true, force: true });
      await victim.cleanup(undefined, true);
    }
  }, 60_000);
});
