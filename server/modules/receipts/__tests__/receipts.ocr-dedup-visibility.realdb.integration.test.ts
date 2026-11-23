/**
 * Receipt writes and duplicate detection follow the read visibility (Rule 11).
 * A receipt linked to a transaction takes that transaction's privacy.
 *
 * A-14: a member cannot store OCR results on a receipt linked to another
 * member's private transaction (404, ocr_data unchanged).
 * A-38: an upload whose image matches only such a hidden receipt is not a
 * duplicate, and the response never carries the hidden receipt's id.
 * Real HTTP, real Postgres.
 */
import { createHash, randomUUID } from "node:crypto";
import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLogs, householdMembers, pendingReceipts, transactions, users } from "@shared/schema";
import { db, pool } from "../../../db";
import { hashPassword } from "../../../auth";
import { removeUploadObject } from "../../../core/storage/upload-objects";
import { receiptRepository } from "../../../repositories/ReceiptRepository";
import { createSignedHousehold, insertAccount, type SignedHousehold } from "../../../__tests__/signed-household-fixture";

const PASSWORD = "SyntheticReceiptOcrDedup123!";
const HIDDEN_IMAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwUMMAYAj4IP8cvlVgcAAAAASUVORK5CYII=",
  "base64",
);
const ORIGINAL_OCR = { merchantName: "Owner private merchant", amount: "12.00" };

interface Member { userId: string; headers: Record<string, string> }

let owner: SignedHousehold;
let member: Member;
let visibleImage: Buffer;
const visibleKey = randomUUID();
const ids = { hidden: "", visible: "", privateTransaction: "" };

async function addMember(household: SignedHousehold): Promise<Member> {
  const userId = randomUUID();
  const email = `receipt-ocr-member-${userId}@example.invalid`;
  await db.insert(users).values({ id: userId, email, username: `receipt-ocr-member-${userId}`, passwordHash: await hashPassword(PASSWORD), emailVerified: true });
  await db.insert(householdMembers).values({ householdId: household.householdId, userId, role: "member" });
  const login = await request(household.app).post("/api/auth/login").send({ email, password: PASSWORD }).expect(200);
  const cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  return { userId, headers: { Cookie: cookie, "X-Capital-Subject": userId, "X-Capital-Household": household.householdId } };
}

async function insertPrivateTransaction(accountId: string): Promise<string> {
  const id = randomUUID();
  await db.insert(transactions).values({ id, householdId: owner.householdId, accountId, ownerUserId: owner.userId,
    date: "2026-11-20", name: "Synthetic private purchase", amount: "12.00", type: "expense", isPrivate: true });
  return id;
}

async function insertReceipt(image: Buffer, matchedTransactionId: string | null, idempotencyKey?: string): Promise<string> {
  const id = randomUUID();
  await db.insert(pendingReceipts).values({ id, householdId: owner.householdId, uploadedBy: owner.userId, filename: `${id}.png`,
    originalFilename: "synthetic.png", mimeType: "image/png", size: image.length, storagePath: `uploads/receipts/${owner.householdId}/${id}.png`,
    imageHash: createHash("sha256").update(image).digest("hex"), idempotencyKey, ocrStatus: "completed", ocrData: ORIGINAL_OCR,
    matchStatus: matchedTransactionId ? "matched" : "pending", matchedTransactionId });
  return id;
}

function upload(image: Buffer, idempotencyKey?: string) {
  const headers = idempotencyKey ? { ...member.headers, "X-Idempotency-Key": idempotencyKey } : member.headers;
  return request(owner.app).post("/api/receipts/upload").set(headers)
    .attach("file", image, { filename: "member-upload.png", contentType: "image/png" });
}

beforeAll(async () => {
  owner = await createSignedHousehold("receipt-ocr-dedup");
  member = await addMember(owner);
  const sharedAccount = await insertAccount(owner);
  visibleImage = await sharp({ create: { width: 3, height: 3, channels: 3, background: { r: 10, g: 120, b: 30 } } }).png().toBuffer();
  ids.hidden = await insertReceipt(HIDDEN_IMAGE, await insertPrivateTransaction(sharedAccount));
  ids.visible = await insertReceipt(visibleImage, null, visibleKey);
  ids.privateTransaction = await insertPrivateTransaction(sharedAccount);
}, 60_000);

afterAll(async () => {
  await owner.cleanup(async () => {
    const uploaded = await db.select({ id: pendingReceipts.id, storagePath: pendingReceipts.storagePath, thumbnailPath: pendingReceipts.thumbnailPath })
      .from(pendingReceipts).where(eq(pendingReceipts.uploadedBy, member.userId));
    await db.delete(pendingReceipts).where(eq(pendingReceipts.householdId, owner.householdId));
    for (const row of uploaded) {
      await removeUploadObject(row.storagePath);
      if (row.thumbnailPath) await removeUploadObject(row.thumbnailPath);
    }
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [member.userId]);
    await db.delete(auditLogs).where(eq(auditLogs.userId, member.userId));
    await db.delete(householdMembers).where(eq(householdMembers.userId, member.userId));
    await db.delete(users).where(eq(users.id, member.userId));
  });
}, 60_000);

describe("A-14 POST /api/receipts/:id/ocr-results binds the write to read visibility", () => {
  it("a member gets 404 for a receipt linked to another member's private transaction, and its OCR data is unchanged", async () => {
    const res = await request(owner.app).post(`/api/receipts/${ids.hidden}/ocr-results`).set(member.headers)
      .send({ merchantName: "Overwritten by member", amount: "99.00", confidence: 0.9 });

    expect(res.status).toBe(404);
    const [row] = await db.select({ ocrData: pendingReceipts.ocrData }).from(pendingReceipts).where(eq(pendingReceipts.id, ids.hidden));
    expect(row.ocrData).toEqual(ORIGINAL_OCR);
  });

  it("a member can still store OCR results on a receipt they can read", async () => {
    await request(owner.app).post(`/api/receipts/${ids.visible}/ocr-results`).set(member.headers)
      .send({ merchantName: "Visible merchant", amount: "5.00", confidence: 0.8 }).expect(200);
    const [row] = await db.select({ ocrData: pendingReceipts.ocrData }).from(pendingReceipts).where(eq(pendingReceipts.id, ids.visible));
    expect(row.ocrData).toMatchObject({ merchantName: "Visible merchant" });
  });

  it.each(["transaction", "account", "grant"] as const)("waits for a concurrent %s change before updating the OCR result", async change => {
    const sourceAccount = await insertAccount(owner);
    const sourceTransaction = await insertPrivateTransaction(sourceAccount);
    await db.update(transactions).set({ isPrivate: false }).where(eq(transactions.id, sourceTransaction));
    const receiptId = await insertReceipt(Buffer.from(`synthetic OCR source lock: ${change}`), sourceTransaction);
    const blocker = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    let settled = false;
    let waiting = false;
    try {
      await blocker.query("BEGIN");
      const { rows: [{ pid }] } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      if (change === "transaction") {
        await blocker.query("UPDATE transactions SET is_private=true WHERE id=$1", [sourceTransaction]);
      } else if (change === "account") {
        await blocker.query("UPDATE accounts SET is_private=true WHERE id=$1", [sourceAccount]);
      } else {
        await blocker.query("UPDATE household_members SET role='view_only' WHERE household_id=$1 AND user_id=$2",
          [owner.householdId, member.userId]);
      }
      pending = request(owner.app).post(`/api/receipts/${receiptId}/ocr-results`).set(member.headers)
        .send({ merchantName: "Late replacement", amount: "99.00", confidence: 0.9 }).timeout(10_000)
        .then(response => response).finally(() => { settled = true; });
      void pending.catch(() => undefined);
      const deadline = Date.now() + 5_000;
      while (!waiting && !settled && Date.now() < deadline) {
        const { rows: [row] } = await pool.query<{ waiting: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS waiting", [pid]);
        waiting = row.waiting;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 25));
      }
      await blocker.query("COMMIT");
    } finally {
      try { await blocker.query("ROLLBACK"); } finally { blocker.release(); }
      if (pending) await Promise.allSettled([pending]);
      if (change === "grant") await db.update(householdMembers).set({ role: "member" }).where(and(
        eq(householdMembers.householdId, owner.householdId), eq(householdMembers.userId, member.userId),
      ));
    }
    expect(waiting).toBe(true);
    expect((await pending!).status).toBe(404);
    const [row] = await db.select({ ocrData: pendingReceipts.ocrData }).from(pendingReceipts)
      .where(eq(pendingReceipts.id, receiptId));
    expect(row.ocrData).toEqual(ORIGINAL_OCR);
  }, 15_000);

  it("does not change matching state when the OCR writer loses their grant after the OCR commit", async () => {
    const receiptId = await insertReceipt(Buffer.from("synthetic OCR match grant"), null);
    const memberGrant = and(eq(householdMembers.householdId, owner.householdId), eq(householdMembers.userId, member.userId));
    const original = receiptRepository.updateVisibleOcrResults.bind(receiptRepository);
    const cut = vi.spyOn(receiptRepository, "updateVisibleOcrResults").mockImplementationOnce(async (...args) => {
      const stored = await original(...args);
      await db.update(householdMembers).set({ role: "view_only" }).where(memberGrant);
      return stored;
    });
    try {
      await request(owner.app).post(`/api/receipts/${receiptId}/ocr-results`).set(member.headers)
        .send({ merchantName: "Stored while permitted", confidence: 0.9 }).expect(200);
      const [row] = await db.select().from(pendingReceipts).where(eq(pendingReceipts.id, receiptId));
      expect(row.ocrData).toMatchObject({ merchantName: "Stored while permitted" });
      expect(row.matchStatus).toBe("pending");
      expect(row.ocrErrorMessage).toBeNull();
    } finally {
      cut.mockRestore();
      await db.update(householdMembers).set({ role: "member" }).where(memberGrant);
    }
  });

  it("does not disclose another user's OCR amount when the receipt becomes private during passive matching", async () => {
    const accountId = await insertAccount(owner);
    const targetId = await insertPrivateTransaction(accountId);
    const amount = "432.10";
    const hiddenAmount = "9876.54";
    const date = "2026-11-20";
    await db.update(transactions).set({ amount, isPrivate: false }).where(eq(transactions.id, targetId));
    const receiptId = await insertReceipt(Buffer.from("synthetic OCR matching privacy change"), null);
    const original = receiptRepository.findTransactionsForMatch.bind(receiptRepository);
    const cut = vi.spyOn(receiptRepository, "findTransactionsForMatch").mockImplementationOnce(async (...args) => {
      const candidates = await original(...args);
      expect(candidates.map(candidate => candidate.id)).toContain(targetId);
      await db.update(pendingReceipts).set({
        ocrData: { amount: hiddenAmount }, matchedTransactionId: ids.privateTransaction, matchStatus: "matched",
      }).where(eq(pendingReceipts.id, receiptId));
      return candidates;
    });
    try {
      const result = await request(owner.app).post(`/api/receipts/${receiptId}/ocr-results`).set(member.headers)
        .send({ amount, date, confidence: 0.9 }).expect(200);
      expect(cut).toHaveBeenCalledOnce();
      expect(result.body.data).toMatchObject({ ocrStored: true, autoMatched: false });
      expect(result.body.data.matchedTransactionId).toBeUndefined();
      expect(JSON.stringify(result.body)).not.toContain(hiddenAmount);
      expect(JSON.stringify(result.body)).not.toContain(ids.privateTransaction);
    } finally {
      cut.mockRestore();
    }

    const manual = await request(owner.app).post(`/api/receipts/${receiptId}/match`).set(member.headers)
      .send({ transactionId: targetId }).expect(404);
    expect(JSON.stringify(manual.body)).not.toContain(hiddenAmount);
    expect(JSON.stringify(manual.body)).not.toContain(ids.privateTransaction);

    const visible = await insertReceipt(Buffer.from("synthetic visible manual mismatch"), null);
    const mismatch = await request(owner.app).post(`/api/receipts/${visible}/match`).set(member.headers)
      .send({ transactionId: targetId }).expect(400);
    expect(JSON.stringify(mismatch.body)).toContain("AMOUNT_MISMATCH");
  });
});

describe("A-38 upload duplicate detection follows the uploader's visibility", () => {
  it("an image matching only a hidden receipt is stored as a new receipt and the hidden id never leaves", async () => {
    const res = await upload(HIDDEN_IMAGE).expect(201);

    expect(JSON.stringify(res.body)).not.toContain(ids.hidden);
    expect(res.body.data).toMatchObject({ isDuplicate: false });
    const [created] = await db.select({ uploadedBy: pendingReceipts.uploadedBy }).from(pendingReceipts)
      .where(eq(pendingReceipts.id, res.body.data.receiptId));
    expect(created).toEqual({ uploadedBy: member.userId });
  });

  it("an image matching a receipt the uploader can read is still reported as its duplicate", async () => {
    const res = await upload(visibleImage).expect(201);
    expect(res.body.data).toMatchObject({ isDuplicate: true, duplicateOf: ids.visible, receiptId: ids.visible });
  });

  it("a keyed retry is checked against current visibility before comparing image hashes", async () => {
    const replay = await upload(HIDDEN_IMAGE, visibleKey).expect(201);
    expect(replay.body.data).toMatchObject({ isDuplicate: true, receiptId: ids.visible });
    expect(replay.body.data).not.toHaveProperty("duplicateOf");

    await db.update(pendingReceipts).set({ matchStatus: "matched", matchedTransactionId: ids.privateTransaction })
      .where(eq(pendingReceipts.id, ids.visible));
    try {
      const denied = await upload(HIDDEN_IMAGE, visibleKey).expect(404);
      expect(denied.body.error).toMatchObject({ code: "NOT_FOUND", message: "Receipt not found" });
      expect(JSON.stringify(denied.body)).not.toContain(ids.visible);
    } finally {
      await db.update(pendingReceipts).set({ matchStatus: "pending", matchedTransactionId: null })
        .where(eq(pendingReceipts.id, ids.visible));
    }
  });
});
