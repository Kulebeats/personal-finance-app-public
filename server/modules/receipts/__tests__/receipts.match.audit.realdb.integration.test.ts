/**
 * FIN-16: a receipt match audits the link and any transaction change it makes,
 * in the same database transaction (Rule 9). REAL HTTP, REAL DB.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { merchants, outboxEvents, pendingReceipts, transactions } from "@shared/schema";
import { db, pool } from "../../../db";
import { a, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const MERCHANT_NAME = "Receipt Audit Merchant";
const signed = (call: request.Test) => call.set("Cookie", actors.get("owner")!.cookie)
  .set("X-Capital-Subject", actors.get("owner")!.id).set("X-Capital-Household", a);

let merchantId: string;
let receiptId: string;
let transactionId: string;

async function clean() {
  await pool.query("delete from receipt_conversion_records where household_id=$1", [a]);
  await db.delete(pendingReceipts).where(eq(pendingReceipts.householdId, a));
  await db.delete(transactions).where(eq(transactions.householdId, a));
  await db.delete(merchants).where(eq(merchants.householdId, a));
  await pool.query("delete from audit_logs where household_id=$1", [a]);
  await db.delete(outboxEvents).where(eq(outboxEvents.householdId, a));
}

async function seed(ocrMerchant: string | undefined) {
  merchantId = randomUUID(); receiptId = randomUUID(); transactionId = randomUUID();
  await db.insert(merchants).values({ id: merchantId, householdId: a, name: MERCHANT_NAME });
  await db.insert(transactions).values({
    id: transactionId, householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id,
    date: "2026-11-10", name: "raw bank text 0042", amount: "25.00", type: "expense", isPrivate: false,
  });
  await db.insert(pendingReceipts).values({
    id: receiptId, householdId: a, uploadedBy: actors.get("owner")!.id, filename: "r.png", originalFilename: "r.png",
    mimeType: "image/png", size: 10, storagePath: `receipts/${receiptId}.png`, ocrStatus: "completed",
    ocrData: { merchantName: ocrMerchant, amount: "25.00" },
  });
}

const auditRows = async (entityType: string, entityId: string) =>
  (await pool.query("select * from audit_logs where entity_type=$1 and entity_id=$2 order by created_at, id", [entityType, entityId])).rows;

describe("FIN-16 receipt match audit (real HTTP/DB)", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => { await clean(); await reset(); });
  afterAll(async () => {
    await pool.query("drop trigger if exists block_match_audit on audit_logs");
    await pool.query("drop function if exists block_match_audit()");
    await clean();
    await stop();
  });

  it("audits the merchant/name change the match made to the transaction, with the receipt id", async () => {
    await seed(MERCHANT_NAME);
    await signed(request(app).post(`/api/receipts/${receiptId}/match`)).send({ transactionId }).expect(200);

    const [row, ...rest] = await auditRows("transaction", transactionId);
    expect(rest).toHaveLength(0);
    expect(row.action).toBe("UPDATE");
    expect(row.household_id).toBe(a);
    expect(row.user_id).toBe(actors.get("owner")!.id);
    expect(row.details.receiptId).toBe(receiptId);
    expect(row.details.changes.merchantId).toEqual({ before: null, after: merchantId });
    expect(row.details.changes.name).toEqual({ before: "raw bank text 0042", after: MERCHANT_NAME });
    expect(Object.keys(row.details.changes).sort()).toEqual(["merchantId", "name"]);

    const events = await pool.query(
      "select 1 from outbox_events where aggregate_id=$1 and event_type='transaction.updated'", [transactionId]);
    expect(events.rowCount).toBe(1);
  });

  it("writes exactly one receipt LINK row, in the same transaction as the link", async () => {
    await seed(undefined);
    await signed(request(app).post(`/api/receipts/${receiptId}/match`)).send({ transactionId }).expect(200);

    const links = await auditRows("receipt", receiptId);
    expect(links).toHaveLength(1);
    expect(links[0].action).toBe("LINK");
    expect(links[0].details.transactionId).toBe(transactionId);
    // Nothing about the transaction changed, so no transaction UPDATE row.
    expect(await auditRows("transaction", transactionId)).toHaveLength(0);
  });

  it("rolls the match back when the audit insert fails", async () => {
    await seed(MERCHANT_NAME);
    await pool.query(`create or replace function block_match_audit() returns trigger language plpgsql as $$
      begin
        if new.entity_type in ('receipt', 'transaction') then raise exception 'audit blocked for test'; end if;
        return new;
      end $$`);
    await pool.query("create trigger block_match_audit before insert on audit_logs for each row execute function block_match_audit()");
    try {
      const res = await signed(request(app).post(`/api/receipts/${receiptId}/match`)).send({ transactionId });
      expect(res.status).toBeGreaterThanOrEqual(500);
      const [receipt] = await db.select().from(pendingReceipts).where(eq(pendingReceipts.id, receiptId));
      expect(receipt.matchStatus).not.toBe("matched");
      expect(receipt.matchedTransactionId).toBeNull();
      const [transaction] = await db.select().from(transactions).where(eq(transactions.id, transactionId));
      expect(transaction.merchantId).toBeNull();
      expect(transaction.name).toBe("raw bank text 0042");
    } finally {
      await pool.query("drop trigger if exists block_match_audit on audit_logs");
    }
  });
});
