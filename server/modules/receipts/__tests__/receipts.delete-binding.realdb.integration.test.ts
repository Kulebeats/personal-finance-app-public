/**
 * Receipt delete and convert follow read visibility, and delete removes only
 * the receipt's own stored files. Real HTTP, real Postgres, real object store.
 *
 * R6-08: a member holding the id of a receipt linked to another member's
 * private transaction gets 404 from DELETE and from create-transaction, the
 * same answer as a missing id, never 400 "matched" or 409 "already linked".
 * A-28: a receipt row whose stored path names another receipt's file is
 * deleted, but that other file's object and manifest row stay.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, householdMembers, pendingReceipts, storageObjects, transactions, users } from "@shared/schema";
import { db, pool } from "../../../db";
import { hashPassword } from "../../../auth";
import { readUploadObject, removeUploadObject, uploadNameOf } from "../../../core/storage/upload-objects";
import { createSignedHousehold, insertAccount, type SignedHousehold } from "../../../__tests__/signed-household-fixture";

const PASSWORD = "SyntheticReceiptDeleteBinding123!";

interface Member { userId: string; headers: Record<string, string> }

let owner: SignedHousehold;
let member: Member;
let sharedAccount: string;
const uploadedPaths: string[] = [];

async function addMember(household: SignedHousehold): Promise<Member> {
  const userId = randomUUID();
  const email = `receipt-delete-member-${userId}@example.invalid`;
  await db.insert(users).values({ id: userId, email, username: `receipt-delete-member-${userId}`, passwordHash: await hashPassword(PASSWORD), emailVerified: true });
  await db.insert(householdMembers).values({ householdId: household.householdId, userId, role: "member" });
  const login = await request(household.app).post("/api/auth/login").send({ email, password: PASSWORD }).expect(200);
  const cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  return { userId, headers: { Cookie: cookie, "X-Capital-Subject": userId, "X-Capital-Household": household.householdId } };
}

async function insertTransaction(isPrivate: boolean): Promise<string> {
  const id = randomUUID();
  await db.insert(transactions).values({ id, householdId: owner.householdId, accountId: sharedAccount, ownerUserId: owner.userId,
    date: "2026-11-20", name: "Synthetic receipt purchase", amount: "12.00", type: "expense", isPrivate });
  return id;
}

/** A receipt row inserted directly; `storagePath` defaults to the receipt's own (absent) file. */
async function insertReceipt(matchedTransactionId: string | null, storagePath?: string): Promise<string> {
  const id = randomUUID();
  await db.insert(pendingReceipts).values({ id, householdId: owner.householdId, uploadedBy: owner.userId, filename: `${id}.png`,
    originalFilename: "synthetic.png", mimeType: "image/png", size: 10,
    storagePath: storagePath ?? `uploads/receipts/${owner.householdId}/${id}.png`, ocrStatus: "completed",
    matchStatus: matchedTransactionId ? "matched" : "pending", matchedTransactionId });
  return id;
}

async function receiptExists(id: string): Promise<boolean> {
  const [row] = await db.select({ id: pendingReceipts.id }).from(pendingReceipts).where(eq(pendingReceipts.id, id));
  return Boolean(row);
}

beforeAll(async () => {
  owner = await createSignedHousehold("receipt-delete-binding");
  member = await addMember(owner);
  sharedAccount = await insertAccount(owner);
}, 60_000);

afterAll(async () => {
  await owner.cleanup(async () => {
    await db.delete(pendingReceipts).where(eq(pendingReceipts.householdId, owner.householdId));
    for (const stored of uploadedPaths) await removeUploadObject(stored);
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [member.userId]);
    await db.delete(auditLogs).where(eq(auditLogs.userId, member.userId));
    await db.delete(householdMembers).where(eq(householdMembers.userId, member.userId));
    await db.delete(users).where(eq(users.id, member.userId));
  });
}, 60_000);

describe("R6-08 a hidden linked receipt reads as missing on delete and convert", () => {
  it("DELETE answers 404 and leaves the receipt in place", async () => {
    const hidden = await insertReceipt(await insertTransaction(true));

    const res = await request(owner.app).delete(`/api/receipts/${hidden}`).set(member.headers);

    expect(res.status).toBe(404);
    expect(await receiptExists(hidden)).toBe(true);
  });

  it("create-transaction answers 404 and creates nothing", async () => {
    const hidden = await insertReceipt(await insertTransaction(true));
    const before = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.householdId, owner.householdId));

    const res = await request(owner.app).post(`/api/receipts/${hidden}/create-transaction`).set(member.headers)
      .send({ accountId: sharedAccount, name: "Member conversion", amount: "12.00", date: "2026-11-20" });

    expect(res.status).toBe(404);
    const after = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.householdId, owner.householdId));
    expect(after).toHaveLength(before.length);
  });

  it("create-transaction with a random account id still answers 404 Receipt not found", async () => {
    const hidden = await insertReceipt(await insertTransaction(true));

    const res = await request(owner.app).post(`/api/receipts/${hidden}/create-transaction`).set(member.headers)
      .send({ accountId: randomUUID(), name: "Member conversion", amount: "12.00", date: "2026-11-20" });

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).toContain("Receipt not found");
    expect(JSON.stringify(res.body)).not.toContain("Account not found");
  });

  it("a matched receipt the member can read still refuses delete with 400", async () => {
    const visibleMatched = await insertReceipt(await insertTransaction(false));

    const res = await request(owner.app).delete(`/api/receipts/${visibleMatched}`).set(member.headers);

    expect(res.status).toBe(400);
    expect(await receiptExists(visibleMatched)).toBe(true);
  });
});

describe("A-28 receipt delete removes only the receipt's own stored files", () => {
  it("a row naming another receipt's file is deleted, and that file's object and manifest row stay", async () => {
    const image = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 40, b: 90 } } }).png().toBuffer();
    const uploaded = await request(owner.app).post("/api/receipts/upload").set(owner.headers)
      .attach("file", image, { filename: "owner-upload.png", contentType: "image/png" }).expect(201);
    const [source] = await db.select({ storagePath: pendingReceipts.storagePath, thumbnailPath: pendingReceipts.thumbnailPath })
      .from(pendingReceipts).where(eq(pendingReceipts.id, uploaded.body.data.receiptId));
    uploadedPaths.push(source.storagePath, ...(source.thumbnailPath ? [source.thumbnailPath] : []));
    const mismatched = await insertReceipt(null, source.storagePath);

    await request(owner.app).delete(`/api/receipts/${mismatched}`).set(owner.headers).expect(200);

    expect(await receiptExists(mismatched)).toBe(false);
    const [manifest] = await db.select({ key: storageObjects.key }).from(storageObjects)
      .where(eq(storageObjects.uploadName, uploadNameOf(source.storagePath) ?? ""));
    expect(manifest, "the other receipt's manifest row was deleted").toBeDefined();
    const stillStored = await readUploadObject(source.storagePath, owner.householdId, "receipt");
    expect(stillStored?.bytes.length, "the other receipt's object was deleted").toBeGreaterThan(0);
  });
});
