/**
 * FIN-03: an account-level import overwrite ("prioritize_csv") must refuse, with 409 and no
 * write at all, when the rows it would soft-delete include a transfer leg or the cash row of
 * a confirmed GRZ principal settlement. Real HTTP request, real Postgres, no mocks.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { transactions } from "@shared/schema";
import { db, pool } from "../../../db";
import {
  createSignedHousehold, insertAccount, type SignedHousehold,
} from "../../../__tests__/signed-household-fixture";

const DAY = "2026-03-10";
let fx: SignedHousehold;
let accountId: string;
let otherAccountId: string;

async function ledgerState() {
  return {
    accounts: (await pool.query("SELECT * FROM accounts WHERE household_id=$1 ORDER BY id", [fx.householdId])).rows,
    transactions: (await pool.query("SELECT * FROM transactions WHERE household_id=$1 ORDER BY id", [fx.householdId])).rows,
    audits: (await pool.query("SELECT id FROM audit_logs WHERE household_id=$1 ORDER BY id", [fx.householdId])).rows,
    events: (await pool.query("SELECT id FROM outbox_events WHERE household_id=$1 ORDER BY id", [fx.householdId])).rows,
  };
}

function overwrite(targetAccountId: string) {
  return request(fx.app).post("/api/import/execute").set(fx.headers).send({
    targetAccountId,
    strategy: "prioritize_csv",
    mapping: { date: "Date", amount: "Amount", merchant: "Merchant" },
    dateFormat: "auto",
    categoryMapping: {},
    rows: [{ Date: DAY, Amount: "-12.50", Merchant: "Synthetic statement row" }],
  });
}

/**
 * The binding triggers refuse a settlement cash row without its full GRZ event chain.
 * The row is seeded with triggers off (replica role) so the test reaches the application
 * guard itself; the import under test still runs with every trigger enabled.
 */
async function seedSettlementCash(targetAccountId: string): Promise<string> {
  const id = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = 'replica'");
    await client.query(`INSERT INTO transactions(id,household_id,account_id,owner_user_id,name,type,amount,currency,date,source,
      is_private,posted_balance_delta,posted_account_is_asset,posting_mode)
      VALUES ($1,$2,$3,$4,'Synthetic principal settlement cash','asset_settlement',1000,$5,$6,'manual',false,1000,true,'posted')`,
      [id, fx.householdId, targetAccountId, fx.userId, fx.currency, DAY]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return id;
}

describe("FIN-03 import overwrite refuses rows it cannot reverse (real Postgres)", () => {
  beforeAll(async () => {
    fx = await createSignedHousehold("fin03-overwrite");
    accountId = await insertAccount(fx, { name: "Overwrite target" });
    otherAccountId = await insertAccount(fx, { name: "Transfer counterpart" });
  }, 30000);

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  it("returns 409 and writes nothing when the overwrite would delete a transfer leg", async () => {
    await db.insert(transactions).values({
      householdId: fx.householdId, accountId, ownerUserId: fx.userId, name: "Synthetic transfer leg", date: DAY,
      amount: "40.00", currency: fx.currency, type: "transfer", transferAccountId: otherAccountId, isTransferIn: false,
    });
    const before = await ledgerState();
    expect(before.transactions).toHaveLength(1);

    const res = await overwrite(accountId);

    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/transfer/i);
    expect(await ledgerState()).toEqual(before);
  });

  it("returns 409 and writes nothing when the overwrite would delete a GRZ principal settlement cash row", async () => {
    // Opening 100.00 plus the 1000.00 settlement already posted: a consistent ledger, so the
    // only reason to refuse is the settlement row (not an insufficient-funds check).
    const principalAccountId = await insertAccount(fx, { name: "Principal settlement target", balance: "1100.00" });
    const settlementId = await seedSettlementCash(principalAccountId);
    const before = await ledgerState();
    expect(before.transactions.find(row => row.id === settlementId)).toMatchObject({ type: "asset_settlement", deleted_at: null });

    const res = await overwrite(principalAccountId);

    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/settlement/i);
    expect(await ledgerState()).toEqual(before);
  });
});
