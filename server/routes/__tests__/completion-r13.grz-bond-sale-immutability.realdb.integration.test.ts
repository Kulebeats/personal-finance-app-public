/**
 * R13.2 hardening, migration 0039 (#221). Real HTTP, real Postgres.
 * Once a GRZ bond sale has settled cash, its sale fields cannot change and the bond row
 * cannot be deleted while the household or that cash survives, as 0025 guards principal
 * events. Account erasure still removes it, and still keeps it for a surviving co-member.
 * Rows without settled sale cash (active, legacy sold) are not refused.
 * Amounts are synthetic fixtures, not legal or tax claims (OI-03).
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { auditLogs, grzBonds, householdMembers, households, transactions, users } from "@shared/schema";
import { db, pool } from "../../db";
import { eraseAccount } from "../../modules/settings/settings.account-deletion.service";
import { createSignedHousehold, insertAccount, type SignedHousehold } from "../../__tests__/signed-household-fixture";

const IMMUTABLE = /A settled GRZ bond sale is immutable/;
const ERASURE_ONLY = /A settled GRZ bond sale requires whole-household erasure/;

let fx: SignedHousehold;
let accountId: string;
let bondId: string;
let cashId: string;
let extraUsers: string[] = [];

const send = (method: "post" | "put", path: string) => request(fx.app)[method](path).set(fx.headers);
const bondRow = async (id = bondId) => (await db.select().from(grzBonds).where(eq(grzBonds.id, id)))[0];

let isinSeq = 0;
/** 1000 face, 8% semiannual, bought for 950.00; a distinct ISIN per bond. */
async function createBond(name: string) {
  isinSeq += 1;
  const created = await send("post", "/api/grz/bonds").send({ accountId, isin: `ZM00000039${String(isinSeq).padStart(2, "0")}`, bondName: name, tenorYears: 2,
    faceValue: "1000.00", purchasePrice: "950.00", couponRate: "0.0800", couponFrequency: 2, purchaseDate: "2025-06-30",
    firstCouponDate: "2025-12-31", maturityDate: "2027-12-31" }).expect(201);
  return created.body.data.id as string;
}

/** Delete a bond and its schedule in one transaction, so only the deferred guard decides. */
async function deleteBond(id: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM grz_bond_payments WHERE bond_id=$1", [id]);
    await client.query("DELETE FROM grz_bonds WHERE id=$1", [id]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Whole-household erasure of every remaining member, then the fixture's user rows. */
async function eraseAll() {
  const members = await db.select({ id: householdMembers.userId }).from(householdMembers)
    .where(eq(householdMembers.householdId, fx.householdId));
  for (const { id } of members) {
    if (!id) continue;
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, id));
    if (user) await eraseAccount({ userId: id, userEmail: user.email, householdId: fx.householdId });
  }
  const fixtureUsers = [fx.userId, ...extraUsers];
  await db.delete(auditLogs).where(inArray(auditLogs.userId, fixtureUsers));
  for (const id of fixtureUsers) await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [id]);
  await pool.query("DELETE FROM security_audit_logs WHERE user_id = ANY($1::uuid[])", [fixtureUsers]);
  await db.delete(users).where(inArray(users.id, fixtureUsers));
  extraUsers = [];
}

describe("R13.2 a settled bond sale is immutable until whole-household erasure (0039)", () => {
  beforeEach(async () => {
    fx = await createSignedHousehold("r13-sale-guard", "ZMW");
    accountId = await insertAccount(fx, { name: "Synthetic ZMW cash" });
    bondId = await createBond("R13_SALE_IMMUTABLE");
    const sold = await send("put", `/api/grz/bonds/${bondId}/sell`)
      .send({ soldDate: "2026-08-15", soldPrice: "980.50", fees: "5.25", soldYield: 0.081, accountId }).expect(200);
    cashId = sold.body.data.settlement.cashTransactionId;
  }, 30_000);
  afterEach(eraseAll, 30_000);

  it.each([
    ["status", "'active'"], ["sold_date", "'2026-08-16'"], ["sold_price", "990.50"], ["sold_yield", "0.0900"],
    ["sale_cash_transaction_id", "NULL"], ["sale_fees", "6.25"], ["sale_cost_basis", "951.00"], ["sale_realized_gain", "24.25"],
  ])("refuses changing %s on a settled sale", async (column, value) => {
    const before = await bondRow();
    await expect(pool.query(`UPDATE grz_bonds SET ${column}=${value} WHERE id=$1`, [bondId])).rejects.toThrow(IMMUTABLE);
    expect(await bondRow()).toEqual(before);
  });

  it("still allows changes outside the sale fields", async () => {
    await pool.query("UPDATE grz_bonds SET bond_name='R13_SALE_RENAMED', updated_at=now() WHERE id=$1", [bondId]);
    expect(await bondRow()).toMatchObject({ bondName: "R13_SALE_RENAMED", status: "sold", soldPrice: "980.50", saleCashTransactionId: cashId });
  });

  it("refuses deleting a settled sale while its household lives", async () => {
    await expect(deleteBond(bondId)).rejects.toThrow(ERASURE_ONLY);
    expect(await bondRow()).toMatchObject({ status: "sold", saleCashTransactionId: cashId });
  });

  it("does not refuse bonds without settled sale cash", async () => {
    const legacy = await createBond("R13_LEGACY_SOLD");
    await pool.query("UPDATE grz_bonds SET status='sold', sold_date='2026-08-15', sold_price=980.50 WHERE id=$1", [legacy]);
    await pool.query("UPDATE grz_bonds SET sold_price=990.50 WHERE id=$1", [legacy]);
    expect((await bondRow(legacy)).soldPrice).toBe("990.50");
    await deleteBond(legacy);
    const active = await createBond("R13_ACTIVE");
    await deleteBond(active);
    expect(await db.select().from(grzBonds).where(inArray(grzBonds.id, [legacy, active]))).toEqual([]);
  });

  it("lets the sole owner's account erasure remove the sold bond, its cash and the household", async () => {
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, fx.userId));
    expect(await eraseAccount({ userId: fx.userId, userEmail: user.email, householdId: fx.householdId })).toEqual({ householdDeleted: true });
    expect(await db.select().from(grzBonds).where(eq(grzBonds.id, bondId))).toEqual([]);
    expect(await db.select().from(transactions).where(eq(transactions.id, cashId))).toEqual([]);
    expect(await db.select().from(households).where(eq(households.id, fx.householdId))).toEqual([]);
  });

  it("keeps the settled sale unchanged when a co-member survives the seller's erasure", async () => {
    const successor = randomUUID(); extraUsers.push(successor);
    await db.insert(users).values({ id: successor, email: `r13-sale-successor-${successor}@example.invalid`,
      username: `r13-sale-successor-${successor}`, passwordHash: "!synthetic-no-login", emailVerified: true });
    // One owner per household (NEW-12): the co-member joins as admin and erasure promotes them.
    await db.insert(householdMembers).values({ householdId: fx.householdId, userId: successor, role: "admin" });
    const before = await bondRow();
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, fx.userId));
    expect(await eraseAccount({ userId: fx.userId, userEmail: user.email, householdId: fx.householdId })).toEqual({ householdDeleted: false });
    expect(await bondRow()).toEqual(before);
    expect(await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, cashId))).toEqual([{ id: cashId }]);
  });
});
