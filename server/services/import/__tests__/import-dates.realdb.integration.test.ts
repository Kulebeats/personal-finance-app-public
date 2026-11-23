/**
 * FIN-15: CSV import dates are strict calendar days. 2026-02-30 is refused instead of rolling
 * into March, and an ambiguous slash date (03/04/2026) is refused in auto mode. Both import
 * entrances are exercised over real HTTP against real Postgres:
 *   - POST /api/import/execute               (server/services/import/parse.ts)
 *   - POST /api/accounts/:id/transactions/import (server/services/account/AccountImportService.ts)
 */
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../../db";
import {
  createSignedHousehold, insertAccount, type SignedHousehold,
} from "../../../__tests__/signed-household-fixture";

let fx: SignedHousehold;

async function savedRows(accountId: string) {
  return (await pool.query(
    "SELECT date::text AS date, amount, source, deleted_at FROM transactions WHERE account_id=$1 ORDER BY id", [accountId],
  )).rows;
}

describe("FIN-15 strict import dates (real Postgres)", () => {
  beforeAll(async () => {
    fx = await createSignedHousehold("fin15-dates");
  }, 30000);

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  describe("global import (parse.ts)", () => {
    const run = (accountId: string, date: string, dateFormat: "auto" | "DD/MM/YYYY" | "MM/DD/YYYY" = "auto") =>
      request(fx.app).post("/api/import/execute").set(fx.headers).send({
        targetAccountId: accountId, strategy: "prioritize_coppercoin", dateFormat, categoryMapping: {},
        mapping: { date: "Date", amount: "Amount", merchant: "Merchant" },
        rows: [{ Date: date, Amount: "-12.50", Merchant: "Synthetic date probe" }],
      });

    it("refuses 2026-02-30 and saves nothing", async () => {
      const accountId = await insertAccount(fx);

      const res = await run(accountId, "2026-02-30");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ imported: 0, errors: [{ rowIndex: 1, field: "date", value: "2026-02-30" }] });
      expect(await savedRows(accountId)).toEqual([]);
    });

    it("refuses the ambiguous 03/04/2026 in auto mode and saves nothing", async () => {
      const accountId = await insertAccount(fx);

      const res = await run(accountId, "03/04/2026");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ imported: 0, errors: [{ rowIndex: 1, field: "date", value: "03/04/2026" }] });
      expect(res.body.errors[0].reason).toMatch(/ambiguous/i);
      expect(await savedRows(accountId)).toEqual([]);
    });

    it("imports a valid date exactly as written", async () => {
      const accountId = await insertAccount(fx);

      const res = await run(accountId, "2026-03-04");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ imported: 1, errors: [] });
      expect(await savedRows(accountId)).toEqual([
        { date: "2026-03-04", amount: "12.50", source: "csv_import", deleted_at: null },
      ]);
    });

    it("imports 03/04/2026 once the day/month order is stated", async () => {
      const accountId = await insertAccount(fx);

      const res = await run(accountId, "03/04/2026", "DD/MM/YYYY");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ imported: 1, errors: [] });
      expect((await savedRows(accountId)).map(row => row.date)).toEqual(["2026-04-03"]);
    });
  });

  describe("account import (AccountImportService.ts)", () => {
    const run = (accountId: string, date: string) =>
      request(fx.app).post(`/api/accounts/${accountId}/transactions/import`).set(fx.headers).send({
        adjustBalance: false, transactions: [{ date, merchant: "Synthetic date probe", amount: "-12.50" }],
      });

    it.each(["2026-02-30", "03/04/2026"])("refuses %s with 400 and saves nothing", async date => {
      const accountId = await insertAccount(fx);

      const res = await run(accountId, date);

      expect(res.status).toBe(400);
      expect(await savedRows(accountId)).toEqual([]);
    });

    it("imports a valid date exactly as written", async () => {
      const accountId = await insertAccount(fx);

      const res = await run(accountId, "2026-03-04");

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ imported: 1, skipped: 0 });
      expect(await savedRows(accountId)).toEqual([
        { date: "2026-03-04", amount: "12.50", source: "csv_import", deleted_at: null },
      ]);
    });
  });
});
