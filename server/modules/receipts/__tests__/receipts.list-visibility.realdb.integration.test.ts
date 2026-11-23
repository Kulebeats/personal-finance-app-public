/**
 * Receipt list visibility (Rule 11, OPS-001 follow-up A). A receipt has no
 * privacy of its own: linked to a transaction, it takes that transaction's
 * privacy and its account's. GET /api/receipts already 404s such a receipt by
 * id; the list and its total must leave it out the same way, for every status
 * filter and page. Real HTTP, real Postgres.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, householdMembers, pendingReceipts, transactions, users } from "@shared/schema";
import { db, pool } from "../../../db";
import { hashPassword } from "../../../auth";
import { createSignedHousehold, insertAccount, type SignedHousehold } from "../../../__tests__/signed-household-fixture";

const PASSWORD = "SyntheticReceiptList123!";

interface Member { userId: string; headers: Record<string, string> }

let owner: SignedHousehold;
let member: Member;
const ids = { unlinked: "", privateTransaction: "", privateAccount: "", shared: "" };

async function addMember(household: SignedHousehold): Promise<Member> {
  const userId = randomUUID();
  const email = `receipt-list-member-${userId}@example.invalid`;
  await db.insert(users).values({ id: userId, email, username: `receipt-list-member-${userId}`, passwordHash: await hashPassword(PASSWORD), emailVerified: true });
  await db.insert(householdMembers).values({ householdId: household.householdId, userId, role: "member" });
  const login = await request(household.app).post("/api/auth/login").send({ email, password: PASSWORD }).expect(200);
  const cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  return { userId, headers: { Cookie: cookie, "X-Capital-Subject": userId, "X-Capital-Household": household.householdId } };
}

async function insertTransaction(accountId: string, isPrivate: boolean): Promise<string> {
  const id = randomUUID();
  await db.insert(transactions).values({ id, householdId: owner.householdId, accountId, ownerUserId: owner.userId,
    date: "2026-11-20", name: "Synthetic receipt purchase", amount: "12.00", type: "expense", isPrivate });
  return id;
}

async function insertReceipt(label: string, matchedTransactionId: string | null): Promise<string> {
  const id = randomUUID();
  await db.insert(pendingReceipts).values({ id, householdId: owner.householdId, uploadedBy: owner.userId, filename: `${id}.png`,
    originalFilename: `${label}.png`, mimeType: "image/png", size: 10, storagePath: `uploads/receipts/${owner.householdId}/${id}.png`,
    ocrStatus: "completed", matchStatus: matchedTransactionId ? "matched" : "pending", matchedTransactionId });
  return id;
}

async function listIds(headers: Record<string, string>, query: Record<string, string | number>) {
  const response = await request(owner.app).get("/api/receipts").query(query).set(headers).expect(200);
  return { ids: (response.body.data as { id: string }[]).map((row) => row.id).sort(), total: response.body.pagination.total as number };
}

beforeAll(async () => {
  owner = await createSignedHousehold("receipt-list");
  member = await addMember(owner);
  const sharedAccount = await insertAccount(owner);
  const privateAccount = await insertAccount(owner, { isPrivate: true });
  ids.unlinked = await insertReceipt("unlinked", null);
  ids.privateTransaction = await insertReceipt("private-transaction", await insertTransaction(sharedAccount, true));
  ids.privateAccount = await insertReceipt("private-account", await insertTransaction(privateAccount, false));
  ids.shared = await insertReceipt("shared", await insertTransaction(sharedAccount, false));
}, 60_000);

afterAll(async () => {
  await owner.cleanup(async () => {
    await db.delete(pendingReceipts).where(eq(pendingReceipts.householdId, owner.householdId));
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [member.userId]);
    await db.delete(auditLogs).where(eq(auditLogs.userId, member.userId));
    await db.delete(householdMembers).where(eq(householdMembers.userId, member.userId));
    await db.delete(users).where(eq(users.id, member.userId));
  });
}, 60_000);

describe("GET /api/receipts visibility (real Postgres)", () => {
  it("another member's list and total leave out receipts linked to a private transaction or account", async () => {
    expect(await listIds(member.headers, { status: "all" })).toEqual({ ids: [ids.unlinked, ids.shared].sort(), total: 2 });
    expect(await listIds(member.headers, { status: "matched" })).toEqual({ ids: [ids.shared], total: 1 });
  });

  it("the owner still sees every receipt", async () => {
    expect(await listIds(owner.headers, { status: "all" }))
      .toEqual({ ids: [ids.unlinked, ids.privateTransaction, ids.privateAccount, ids.shared].sort(), total: 4 });
  });

  it("a page counts only what the member can see", async () => {
    const first = await listIds(member.headers, { status: "all", limit: 1, offset: 0 });
    const second = await listIds(member.headers, { status: "all", limit: 1, offset: 1 });
    expect([first.total, second.total]).toEqual([2, 2]);
    expect([...first.ids, ...second.ids].sort()).toEqual([ids.unlinked, ids.shared].sort());
  });
});
