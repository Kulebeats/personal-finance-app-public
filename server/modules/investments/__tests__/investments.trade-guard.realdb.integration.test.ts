/**
 * NEW-20: a buy or sell must carry a quantity and a price that are both greater than zero.
 * A negative sale used to create phantom holding quantity. Real HTTP against real Postgres:
 * every refusal must leave the holding and the trade ledger untouched.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { holdings, securities } from "@shared/schema";
import { db, pool } from "../../../db";
import {
  createSignedHousehold, insertAccount, type SignedHousehold,
} from "../../../__tests__/signed-household-fixture";

let fx: SignedHousehold;
let accountId: string;
let securityId: string;
let holdingId: string;

async function tradeState() {
  return {
    holding: (await pool.query("SELECT quantity, cost_basis FROM holdings WHERE id=$1", [holdingId])).rows,
    trades: (await pool.query("SELECT id FROM investment_transactions WHERE household_id=$1", [fx.householdId])).rows,
    lots: (await pool.query("SELECT id FROM tax_lots WHERE household_id=$1", [fx.householdId])).rows,
    balance: (await pool.query("SELECT balance FROM accounts WHERE id=$1", [accountId])).rows,
  };
}

function trade(type: "buy" | "sell", overrides: { quantity: string; price: string }) {
  return request(fx.app).post("/api/investments/transactions").set(fx.headers).send({
    accountId, holdingId, securityId, type, currency: fx.currency, transactionDate: "2026-03-12",
    amount: "500.00", ...overrides,
  });
}

describe("NEW-20 investment trade quantity and price guard (real Postgres)", () => {
  beforeAll(async () => {
    fx = await createSignedHousehold("new20-trade");
    accountId = await insertAccount(fx, { name: "Synthetic brokerage", type: "investment" });
    securityId = randomUUID();
    await db.insert(securities).values({
      id: securityId, symbol: "NEW20", name: "Synthetic security", type: "stock", currency: fx.currency, currentPrice: "100.00",
    });
    holdingId = randomUUID();
    await db.insert(holdings).values({
      id: holdingId, householdId: fx.householdId, accountId, securityId, quantity: "10", costBasis: "1000.00", acquiredDate: "2026-01-01",
    });
  }, 30000);

  afterAll(async () => {
    if (!fx) return;
    await fx.cleanup(async () => {
      await pool.query("DELETE FROM tax_lot_disposals WHERE household_id=$1", [fx.householdId]);
      await pool.query("DELETE FROM tax_lots WHERE household_id=$1", [fx.householdId]);
      await pool.query("DELETE FROM investment_transactions WHERE household_id=$1", [fx.householdId]);
      await pool.query("DELETE FROM holdings WHERE household_id=$1", [fx.householdId]);
      await pool.query("DELETE FROM securities WHERE id=$1", [securityId]);
    });
  });

  const refusals = [
    { label: "negative quantity", field: "quantity", values: { quantity: "-5", price: "100.00" } },
    { label: "zero quantity", field: "quantity", values: { quantity: "0", price: "100.00" } },
    { label: "zero price", field: "price", values: { quantity: "5", price: "0" } },
    { label: "negative price", field: "price", values: { quantity: "5", price: "-100.00" } },
    { label: "negative quantity and price together", field: "quantity", values: { quantity: "-5", price: "-100.00" } },
  ] as const;

  describe.each(["buy", "sell"] as const)("%s", type => {
    it.each(refusals)("refuses $label with 400 and writes nothing", async ({ field, values }) => {
      const before = await tradeState();
      expect(before.holding).toHaveLength(1);

      const res = await trade(type, values);

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(new RegExp(field, "i"));
      expect(await tradeState()).toEqual(before);
    });
  });
});
