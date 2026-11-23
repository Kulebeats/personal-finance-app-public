/**
 * ORG-008: merging a merchant and undoing the merge tell the caller only what
 * they can see, as archive does (A-19). Every count in the response is counted
 * with the merchant-detail visibility (another member's private account or
 * private transaction left out, deleted rows left out). The merge and undo
 * still act on every row of the household, and the full counts stay in the
 * audit row only. REAL HTTP, REAL DB.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs, merchants, transactions } from "@shared/schema";
import { db } from "../../../db";
import { a, b, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

type Role = "owner" | "member";
let sourceId: string;
let targetId: string;
let elsewhereId: string;
const ownerPrivateTx = randomUUID();
const deletedTx = randomUUID();

const as = (role: Role, call: request.Test) => call.set("Cookie", actors.get(role)!.cookie)
  .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a);

async function clean() {
  await db.delete(transactions).where(inArray(transactions.householdId, [a, b]));
  await db.delete(merchants).where(inArray(merchants.householdId, [a, b]));
}

async function seed() {
  const rows = await db.insert(merchants).values([
    { householdId: a, name: "ORG-008 source", isActive: true },
    { householdId: a, name: "ORG-008 target", isActive: true },
    { householdId: a, name: "ORG-008 elsewhere", isActive: true },
  ]).returning();
  [sourceId, targetId, elsewhereId] = rows.map((row) => row.id);
  const owner = actors.get("owner")!.id;
  await db.insert(transactions).values([
    { id: ownerPrivateTx, householdId: a, accountId: ids.sharedAccount, ownerUserId: owner, merchantId: sourceId,
      date: "2026-10-06", name: "ORG-008 owner private", amount: "40.00", type: "expense", isPrivate: true },
    // Shared, but deleted: never counted for anyone.
    { id: deletedTx, householdId: a, accountId: ids.sharedAccount, ownerUserId: owner, merchantId: sourceId,
      date: "2026-10-07", name: "ORG-008 deleted", amount: "9.00", type: "expense", isPrivate: false,
      deletedAt: new Date("2026-10-08T00:00:00Z") },
  ]);
  // The fixture's rows: "PRIVSECRET purchase" sits in the owner's private account, "SHAREDTXN coffee" is shared.
  await db.update(transactions).set({ merchantId: sourceId }).where(inArray(transactions.id, [ids.privateTx, ids.sharedTx]));
}

async function merchantOf(transactionId: string) {
  const [row] = await db.select({ merchantId: transactions.merchantId }).from(transactions).where(eq(transactions.id, transactionId));
  return row.merchantId;
}

async function auditDetails(action: "MERGE" | "RESTORE", entityId: string) {
  const [row] = await db.select().from(auditLogs).where(and(
    eq(auditLogs.householdId, a), eq(auditLogs.entityId, entityId), eq(auditLogs.action, action),
  ));
  return row.details;
}

/** Merge source into target, then move one of the owner's private rows away so the undo skips it. */
async function mergeAndMoveOneAway(role: Role) {
  const merged = await as(role, request(app).post("/api/merchants/merge")).send({ sourceId, targetId });
  expect(merged.status).toBe(200);
  await db.update(transactions).set({ merchantId: elsewhereId }).where(eq(transactions.id, ids.privateTx));
  return merged.body.data as { mergedTransactionCount: number; mergeHistoryId: string };
}

describe("ORG-008 merchant merge and undo count only what the caller can see (real HTTP/DB)", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => { await clean(); await reset(); await seed(); });
  afterAll(async () => { await clean(); await stop(); });

  it("a member's merge reports only the shared row, yet moves every row; the audit keeps the full count", async () => {
    const merged = await mergeAndMoveOneAway("member");

    expect(merged.mergedTransactionCount).toBe(1);
    for (const id of [ownerPrivateTx, deletedTx, ids.sharedTx]) expect(await merchantOf(id)).toBe(targetId);
    expect(await auditDetails("MERGE", targetId)).toMatchObject({ mergedTransactionCount: 4 });
  });

  it("a member's undo reports only what they can see, yet restores every row; the audit keeps the full counts", async () => {
    const { mergeHistoryId } = await mergeAndMoveOneAway("member");

    const res = await as("member", request(app).post(`/api/merchants/merge/${mergeHistoryId}/undo`));

    expect(res.status).toBe(200);
    // Restored: the shared row (the owner's private row and the deleted row are restored too, but not counted).
    // Skipped: the owner's private-account row moved away, which the member cannot see.
    expect(res.body.data).toMatchObject({ restoredTransactionCount: 1, skippedTransactionCount: 0 });
    expect(res.body.data.restoredMerchant).toMatchObject({ id: sourceId, transactionCount: 1 });
    expect(res.body.data.target).toMatchObject({ id: targetId, transactionCount: 0 });
    for (const id of [ownerPrivateTx, deletedTx, ids.sharedTx]) expect(await merchantOf(id)).toBe(sourceId);
    expect(await auditDetails("RESTORE", sourceId)).toMatchObject({ restoredTransactionCount: 3, skippedTransactionCount: 1 });
  });

  it("the owner, who can see their own private rows, gets them counted; deleted rows still are not", async () => {
    const merged = await mergeAndMoveOneAway("owner");
    expect(merged.mergedTransactionCount).toBe(3);

    const res = await as("owner", request(app).post(`/api/merchants/merge/${merged.mergeHistoryId}/undo`)).expect(200);

    expect(res.body.data).toMatchObject({ restoredTransactionCount: 2, skippedTransactionCount: 1 });
    expect(res.body.data.restoredMerchant).toMatchObject({ id: sourceId, transactionCount: 2 });
    expect(res.body.data.target).toMatchObject({ id: targetId, transactionCount: 0 });
  });
});
