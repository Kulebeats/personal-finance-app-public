/**
 * A-19: archiving a merchant tells the caller how many of ITS transactions
 * stay with it, counted with the same visibility as merchant detail. Another
 * member's private account or private transaction is not in the returned
 * count; the full count stays in the audit row only. REAL HTTP, REAL DB.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs, merchants, transactions } from "@shared/schema";
import { db } from "../../../db";
import { a, b, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

let merchantId: string;
const privateTx = randomUUID();

const as = (role: "owner" | "member", call: request.Test) => call.set("Cookie", actors.get(role)!.cookie)
  .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a);

async function clean() {
  await db.delete(transactions).where(inArray(transactions.householdId, [a, b]));
  await db.delete(merchants).where(inArray(merchants.householdId, [a, b]));
}

async function seed() {
  const [merchant] = await db.insert(merchants).values({ householdId: a, name: "A-19 merchant", isActive: true }).returning();
  merchantId = merchant.id;
  const owner = actors.get("owner")!.id;
  await db.insert(transactions).values({
    id: privateTx, householdId: a, accountId: ids.sharedAccount, ownerUserId: owner, merchantId,
    date: "2026-10-06", name: "A-19 owner private", amount: "40.00", type: "expense", isPrivate: true,
  });
  // The fixture's rows: "PRIVSECRET purchase" sits in the owner's private account, "SHAREDTXN coffee" is shared.
  await db.update(transactions).set({ merchantId }).where(inArray(transactions.id, [ids.privateTx, ids.sharedTx]));
}

async function detailCount(role: "owner" | "member") {
  const res = await as(role, request(app).get(`/api/merchants/${merchantId}`)).expect(200);
  return res.body.data.merchant.transactionCount as number;
}

async function archiveAudit() {
  return db.select().from(auditLogs).where(and(
    eq(auditLogs.householdId, a), eq(auditLogs.entityId, merchantId), eq(auditLogs.action, "DELETE"),
  ));
}

describe("A-19 merchant archive counts only what the caller can see (real HTTP/DB)", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => { await clean(); await reset(); await seed(); });
  afterAll(async () => { await clean(); await stop(); });

  it("a member gets the count merchant detail shows them, not the owner's private rows", async () => {
    expect(await detailCount("member")).toBe(1);

    const res = await as("member", request(app).delete(`/api/merchants/${merchantId}`));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ action: "archive", keptTransactionCount: 1 });
    // The archived merchant it returns carries the same visible count, not a stored merchant-wide one.
    expect(res.body.data.merchant.transactionCount).toBe(1);
    // The audit row keeps the merchant-wide count: all three rows stay with it.
    const [audit] = await archiveAudit();
    expect(audit.details).toMatchObject({ operation: "archive", keptTransactionCount: 3 });
  });

  it("the owner, who can see all three rows, gets all three", async () => {
    expect(await detailCount("owner")).toBe(3);

    const res = await as("owner", request(app).delete(`/api/merchants/${merchantId}`)).expect(200);

    expect(res.body.data.keptTransactionCount).toBe(3);
  });
});
