import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { pendingReceipts, tags } from "@shared/schema";
import { receiptTransactionService } from "../../../services/receipt/transaction.service";
import { businessAuditService } from "../../../services/BusinessAuditService";
import { a, actors, app, ids, reset, roles, snapshot, start, stop } from "./completion-r04.tags.fixture";

async function counts(tagId: string) {
  const result = await pool.query('SELECT usage_count, (SELECT count(*)::int FROM transaction_tags WHERE tag_id = tags.id) AS physical FROM tags WHERE id = $1', [tagId]);
  return result.rows[0];
}
const singleRemove = (tagId: string) => request(app).delete(`/api/tags/transaction/${ids.sharedTx}/${tagId}`)
  .set("Cookie", actors.get("member")!.cookie);
async function receipt() {
  const id = randomUUID();
  await db.insert(pendingReceipts).values({ id, householdId: a, uploadedBy: actors.get("member")!.id,
    filename: "synthetic.jpg", originalFilename: "synthetic.jpg", mimeType: "image/jpeg", size: 1, storagePath: "synthetic/no-file" });
  return id;
}
describe("C2 cross-writer persistence (coordinator database window required)", () => {
  beforeAll(start, 20000);
  beforeEach(async () => { await db.delete(pendingReceipts).where(eq(pendingReceipts.householdId, a)); await reset(); });
  afterAll(async () => { await db.delete(pendingReceipts).where(eq(pendingReceipts.householdId, a)); await stop(); });
  it.each(roles)("bulk %s then single edit preserves physical usage", async role => {
    const id = randomUUID(); await db.insert(tags).values({ id, householdId: a, name: id, usageCount: 0 });
    const before = await snapshot();
    const allowed = ["owner", "admin", "member"].includes(role);
    await request(app).put("/api/transactions/bulk-tags").set("Cookie", actors.get(role)!.cookie)
      .send({ transactionIds: [ids.sharedTx], tagIds: [id, id] }).expect(allowed ? 200 : 403);
    if (!allowed) { expect(await snapshot()).toEqual(before); return; }
    expect(await counts(id)).toEqual({ usage_count: 1, physical: 1 });
    await singleRemove(id).expect(200);
    expect(await counts(id)).toEqual({ usage_count: 0, physical: 0 });
  });
  it("receipt link then single edit preserves counts and duplicate retry", async () => {
    const receiptId = await receipt();
    await receiptTransactionService.linkReceiptToTransaction(receiptId, ids.sharedTx, a, actors.get("member")!.id);
    await receiptTransactionService.linkReceiptToTransaction(receiptId, ids.sharedTx, a, actors.get("member")!.id);
    const [tag] = await db.select().from(tags).where(and(eq(tags.householdId, a), eq(tags.name, "Receipt Import")));
    expect(await counts(tag.id)).toEqual({ usage_count: 1, physical: 1 });
    await singleRemove(tag.id).expect(200);
    expect(await counts(tag.id)).toEqual({ usage_count: 0, physical: 0 });
  });
  it("bulk retry writes exactly one actual-effect audit per item and preserves counts", async () => {
    const id = randomUUID(); await db.insert(tags).values({ id, householdId: a, name: id, usageCount: 0 });
    const send = () => request(app).put("/api/transactions/bulk-tags").set("Cookie", actors.get("member")!.cookie)
      .send({ transactionIds: [ids.sharedTx], tagIds: [id, id] });
    await send().expect(200);
    let audits = (await snapshot()).audit;
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ entityId: ids.sharedTx, action: "LINK",
      details: { operation: "add_tags", addedTagIds: [id], removedTagIds: [] } });
    expect(audits[0].ipAddress).toBeTruthy();
    const firstAuditId = audits[0].id;
    await send().expect(200);
    audits = (await snapshot()).audit;
    expect(audits).toHaveLength(2);
    expect(audits.find(row => row.id !== firstAuditId)).toMatchObject({ entityId: ids.sharedTx, action: "LINK",
      details: { operation: "add_tags", addedTagIds: [], removedTagIds: [] } });
    expect(await counts(id)).toEqual({ usage_count: 1, physical: 1 });
  });
  it("bulk reconciliation refusal produces no links, counter changes or audit", async () => {
    await db.update(tags).set({ usageCount: 0 }).where(eq(tags.id, ids.tag));
    const before = await snapshot();
    const response = await request(app).put("/api/transactions/bulk-tags").set("Cookie", actors.get("member")!.cookie)
      .send({ transactionIds: [ids.sharedTx], tagIds: [ids.tag] }).expect(200);
    expect(response.body.data.successCount).toBe(0);
    expect(await snapshot()).toEqual(before);
  });
  it("bulk audit failure rolls back its inserted audit, links and counter", async () => {
    const id = randomUUID(); await db.insert(tags).values({ id, householdId: a, name: id, usageCount: 0 });
    const before = await snapshot(), original = businessAuditService.log.bind(businessAuditService);
    const audit = vi.spyOn(businessAuditService, "log").mockImplementationOnce(async entry => {
      expect(entry.tx).toBeTruthy(); await original(entry); throw new Error("Synthetic after-insert audit failure");
    });
    try {
      const response = await request(app).put("/api/transactions/bulk-tags").set("Cookie", actors.get("member")!.cookie)
        .send({ transactionIds: [ids.sharedTx], tagIds: [id] }).expect(200);
      expect(response.body.data.successCount).toBe(0);
      expect(await snapshot()).toEqual(before);
    } finally { audit.mockRestore(); }
  });
  it("receipt mismatch rolls back receipt status and preserves historical data", async () => {
    await db.update(tags).set({ name: "Receipt Import", usageCount: 0 }).where(eq(tags.id, ids.tag));
    const receiptId = await receipt(), before = await snapshot();
    await expect(receiptTransactionService.linkReceiptToTransaction(receiptId, ids.sharedTx, a, actors.get("member")!.id)).rejects.toThrow("reconciliation");
    expect(await snapshot()).toEqual(before);
    const result = await pool.query('SELECT match_status, matched_transaction_id FROM pending_receipts WHERE id = $1', [receiptId]);
    expect(result.rows[0]).toEqual({ match_status: "pending", matched_transaction_id: null });
  });
});
