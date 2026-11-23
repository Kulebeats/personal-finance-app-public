/**
 * Merchant names and aliases share one case-insensitive namespace per household
 * (merchants.name-guard). The automatic writers (CSV import, rule
 * add_merchant_alias, default seeding) must link to the merchant that already
 * claims a name instead of creating a duplicate; only user-driven create and
 * rename answer 409. Every case goes through real HTTP against real Postgres.
 */
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { merchantAliases, merchants, rules, transactions } from "@shared/schema";
import { eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import {
  createSignedHousehold, insertAccount, type SignedHousehold,
} from "../../../__tests__/signed-household-fixture";

let fx: SignedHousehold;

async function insertMerchant(name: string, aliases: string[] = []): Promise<string> {
  const [merchant] = await db.insert(merchants).values({ householdId: fx.householdId, name }).returning({ id: merchants.id });
  for (const aliasName of aliases) {
    await db.insert(merchantAliases).values({ merchantId: merchant.id, aliasName });
  }
  return merchant.id;
}

/** Merchants in the fixture household whose name matches, case-insensitively. */
async function merchantsNamed(name: string) {
  return (await pool.query(
    "SELECT id, name FROM merchants WHERE household_id=$1 AND LOWER(name)=LOWER($2) ORDER BY id", [fx.householdId, name],
  )).rows as { id: string; name: string }[];
}

async function aliasNamesOf(merchantId: string): Promise<string[]> {
  const rows = await db.select({ aliasName: merchantAliases.aliasName }).from(merchantAliases)
    .where(eq(merchantAliases.merchantId, merchantId));
  return rows.map((row) => row.aliasName).sort();
}

async function merchantIdsOfAccount(accountId: string): Promise<(string | null)[]> {
  const rows = await db.select({ merchantId: transactions.merchantId }).from(transactions)
    .where(eq(transactions.accountId, accountId));
  return rows.map((row) => row.merchantId);
}

function importRow(accountId: string, merchant: string) {
  return request(fx.app).post("/api/import/execute").set(fx.headers).send({
    targetAccountId: accountId, strategy: "prioritize_coppercoin", dateFormat: "auto", categoryMapping: {},
    mapping: { date: "Date", amount: "Amount", merchant: "Merchant" },
    rows: [{ Date: "2026-03-04", Amount: "-12.50", Merchant: merchant }],
  });
}

describe("merchant name/alias writers share one namespace (real Postgres)", () => {
  beforeAll(async () => {
    fx = await createSignedHousehold("merchant-names");
  }, 30000);

  afterAll(async () => {
    if (fx) await fx.cleanup(async () => {
      await db.delete(rules).where(eq(rules.householdId, fx.householdId));
    });
  });

  describe("CSV import", () => {
    it("links a row whose merchant text is another merchant's alias to that merchant", async () => {
      const owner = await insertMerchant("Synthetic Shoprite Import", ["SHOPRITE LSK 042"]);
      const accountId = await insertAccount(fx);

      const res = await importRow(accountId, "shoprite lsk 042");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ imported: 1, errors: [] });
      expect(await merchantIdsOfAccount(accountId)).toEqual([owner]);
      expect(await merchantsNamed("shoprite lsk 042")).toEqual([]);
    });

    it("links a row whose merchant text differs only in case to the existing merchant", async () => {
      const owner = await insertMerchant("Synthetic Case Grocer");
      const accountId = await insertAccount(fx);

      const res = await importRow(accountId, "SYNTHETIC CASE GROCER");

      expect(res.status).toBe(200);
      expect(await merchantIdsOfAccount(accountId)).toEqual([owner]);
      expect(await merchantsNamed("Synthetic Case Grocer")).toEqual([{ id: owner, name: "Synthetic Case Grocer" }]);
    });

    it("creates one merchant when two imports bring the same new name at once", async () => {
      const [first, second] = [await insertAccount(fx), await insertAccount(fx)];

      const responses = await Promise.all([
        importRow(first, "Synthetic Concurrent Newco"),
        importRow(second, "Synthetic Concurrent Newco"),
      ]);

      expect(responses.map((res) => res.status)).toEqual([200, 200]);
      const created = await merchantsNamed("Synthetic Concurrent Newco");
      expect(created).toHaveLength(1);
      expect([...await merchantIdsOfAccount(first), ...await merchantIdsOfAccount(second)])
        .toEqual([created[0].id, created[0].id]);
    });
  });

  describe("user-driven create", () => {
    it("answers one of two concurrent creates of the same name with 409 and keeps one merchant", async () => {
      const create = () => request(fx.app).post("/api/merchants").set(fx.headers).send({ name: "Synthetic Concurrent Create" });

      const statuses = (await Promise.all([create(), create()])).map((res) => res.status).sort();

      expect(statuses).toEqual([201, 409]);
      expect(await merchantsNamed("Synthetic Concurrent Create")).toHaveLength(1);
    });
  });

  describe("rule add_merchant_alias", () => {
    it("does not give a merchant an alias another merchant already claims, and still adds a free one", async () => {
      const source = await insertMerchant("Synthetic Rule Source");
      const claimant = await insertMerchant("Synthetic Rule Claimant", ["SYNTHETIC CLAIMED ALIAS"]);
      const accountId = await insertAccount(fx);
      await db.insert(transactions).values({
        householdId: fx.householdId, accountId, ownerUserId: fx.userId, merchantId: source,
        date: "2026-03-05", name: "Synthetic Rule Source 001", amount: "8.00", type: "expense", currency: fx.currency,
      });

      const res = await request(fx.app).post("/api/rules").set(fx.headers).send({
        name: `Alias rule ${randomUUID()}`, applyToPast: true,
        conditions: [{ type: "merchant_name", operator: "contains", value: "Synthetic Rule Source" }],
        actions: [
          { type: "add_merchant_alias", value: "synthetic rule claimant" },
          { type: "add_merchant_alias", value: "synthetic claimed alias" },
          { type: "add_merchant_alias", value: "Synthetic Rule Free Alias" },
        ],
      });

      expect(res.status).toBe(201);
      expect(await aliasNamesOf(source)).toEqual(["Synthetic Rule Free Alias"]);
      expect(await aliasNamesOf(claimant)).toEqual(["SYNTHETIC CLAIMED ALIAS"]);
    });
  });

  describe("default merchant seeding", () => {
    it("skips a default name that an existing merchant already holds as an alias", async () => {
      const holder = await insertMerchant("Synthetic Seed Holder", ["shoprite"]);

      const res = await request(fx.app).post("/api/merchants/seed").set(fx.headers);

      expect(res.status).toBe(200);
      expect(res.body.data.merchants.map((merchant: { name: string }) => merchant.name)).not.toContain("Shoprite");
      expect(await merchantsNamed("Shoprite")).toEqual([]);
      expect(await aliasNamesOf(holder)).toEqual(["shoprite"]);
    });
  });
});
