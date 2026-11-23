/**
 * NEW-18: converting a receipt into a transaction must not charge twice, and must not accept
 * a negative amount. Real HTTP request against real Postgres; the receipt row is the only seed.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pendingReceipts } from "@shared/schema";
import { db, pool } from "../../../db";
import {
  createSignedHousehold, insertAccount, type SignedHousehold,
} from "../../../__tests__/signed-household-fixture";

let fx: SignedHousehold;

async function insertReceipt(): Promise<string> {
  const [row] = await db.insert(pendingReceipts).values({
    householdId: fx.householdId, uploadedBy: fx.userId, filename: `${randomUUID()}.png`,
    originalFilename: "synthetic-receipt.png", mimeType: "image/png", size: 1024, storagePath: `uploads/receipts/synthetic/${randomUUID()}.png`,
  }).returning({ id: pendingReceipts.id });
  return row.id;
}

function convert(receiptId: string, accountId: string, amount: string) {
  return request(fx.app).post(`/api/receipts/${receiptId}/create-transaction`).set(fx.headers).send({
    accountId, name: "Synthetic receipt vendor", amount, date: "2026-03-12",
  });
}

async function state(receiptId: string, accountId: string) {
  return {
    balance: (await pool.query("SELECT balance FROM accounts WHERE id=$1", [accountId])).rows[0].balance as string,
    postings: (await pool.query("SELECT id, amount, type, source FROM transactions WHERE account_id=$1 ORDER BY id", [accountId])).rows,
    receipt: (await pool.query("SELECT match_status, matched_transaction_id FROM pending_receipts WHERE id=$1", [receiptId])).rows[0],
    conversions: (await pool.query("SELECT transaction_id FROM receipt_conversion_records WHERE receipt_id=$1", [receiptId])).rows,
  };
}

describe("NEW-18 receipt create-transaction (real Postgres)", () => {
  beforeAll(async () => {
    fx = await createSignedHousehold("new18-receipt");
  }, 30000);

  afterAll(async () => {
    // Conversion records are immutable evidence: only the household delete may remove them.
    if (fx) await fx.cleanup(undefined, true);
  });

  it("charges once: an identical replay returns the same posting and a changed repeat is refused with 409", async () => {
    const accountId = await insertAccount(fx);
    const receiptId = await insertReceipt();

    const first = await convert(receiptId, accountId, "25.00");
    expect(first.status).toBe(201);
    const transactionId = first.body.data.transactionId as string;
    const posted = await state(receiptId, accountId);
    expect(posted.balance).toBe("75.00");
    expect(posted.postings).toEqual([{ id: transactionId, amount: "25.00", type: "expense", source: "receipt_scan" }]);
    expect(posted.receipt).toEqual({ match_status: "matched", matched_transaction_id: transactionId });
    expect(posted.conversions).toEqual([{ transaction_id: transactionId }]);

    const replay = await convert(receiptId, accountId, "25.00");
    expect(replay.status).toBe(200);
    expect(replay.body.data.transactionId).toBe(transactionId);
    expect(await state(receiptId, accountId)).toEqual(posted);

    const changed = await convert(receiptId, accountId, "30.00");
    expect(changed.status).toBe(409);
    expect(await state(receiptId, accountId)).toEqual(posted);
  });

  it("serializes two concurrent conversions of one receipt: exactly one posting wins, the other gets 409", async () => {
    const accountId = await insertAccount(fx);
    const receiptId = await insertReceipt();

    const responses = await Promise.all([convert(receiptId, accountId, "10.00"), convert(receiptId, accountId, "20.00")]);

    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    const after = await state(receiptId, accountId);
    expect(after.postings).toHaveLength(1);
    expect(after.conversions).toHaveLength(1);
    const winner = responses.find(response => response.status === 201)!;
    expect(after.postings[0].id).toBe(winner.body.data.transactionId);
    // Charged exactly once: 100.00 less the winning amount, never less both.
    expect(after.balance).toBe(after.postings[0].amount === "10.00" ? "90.00" : "80.00");
  });

  it("refuses a negative amount with 400 at the route and changes nothing", async () => {
    const accountId = await insertAccount(fx);
    const receiptId = await insertReceipt();
    const before = await state(receiptId, accountId);

    const res = await convert(receiptId, accountId, "-25.00");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(await state(receiptId, accountId)).toEqual(before);
    expect(before.balance).toBe("100.00");
    expect(before.postings).toEqual([]);
  });
});
