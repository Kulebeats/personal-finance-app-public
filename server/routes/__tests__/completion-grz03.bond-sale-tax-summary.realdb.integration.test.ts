/**
 * GRZ-03: a confirmed GRZ bond sale records its realised gain or loss on the
 * bond (`grz_bonds.sale_realized_gain`). The investment tax summary must count
 * it as a realised gain in the sale's tax year, in ZMW, household-scoped, and
 * only for a reader who can see the sale: a bond in a private custody account,
 * or one sold into a private account, counts for its owner alone.
 *
 * Real HTTP against real Postgres. Amounts are synthetic fixtures, not legal
 * or tax claims (OI-03).
 */
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { a, actors, app, ids, start, stop, type Role } from "../../modules/tags/__tests__/completion-r04.tags.fixture";
import { eraseSaleHouseholds, freshSaleHouseholds } from "./grz-sale-household.fixture";

const owner = () => actors.get("owner")!;
const send = (method: "put" | "post", path: string) => request(app)[method](path).set("Cookie", owner().cookie)
  .set("X-Capital-Subject", owner().id).set("X-Capital-Household", a);
const summary = async (year: number, role: Role = "owner") => (await request(app).get(`/api/investments/tax/summary?year=${year}`)
  .set("Cookie", actors.get(role)!.cookie).set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a).expect(200)).body;

/** 1000 face bought for 950.00, so the gain is the sale price less fees less 950.00. */
async function soldBond(sale: { soldDate: string; soldPrice: string; fees: string }, custody = ids.sharedAccount,
  destination = ids.sharedAccount, purchaseDate = "2025-06-30") {
  const created = await send("post", "/api/grz/bonds").send({ accountId: custody, isin: "ZM0000000003", bondName: "GRZ03_TAX_BOND",
    tenorYears: 2, faceValue: "1000.00", purchasePrice: "950.00", couponRate: "0.0800", couponFrequency: 2, purchaseDate,
    firstCouponDate: "2025-12-31", maturityDate: "2027-12-31" }).expect(201);
  const sold = await send("put", `/api/grz/bonds/${created.body.data.id}/sell`).send({ ...sale, accountId: destination }).expect(200);
  return sold.body.data.settlement.realizedGain;
}

describe("GRZ-03: a GRZ bond sale's realised gain or loss reaches the tax summary", () => {
  beforeAll(async () => { await start(); }, 30_000);
  beforeEach(freshSaleHouseholds);
  afterAll(async () => { await eraseSaleHouseholds(); await stop(); });

  it("adds each sale's gain or loss to its own tax year, in ZMW", async () => {
    expect(await soldBond({ soldDate: "2026-08-15", soldPrice: "980.50", fees: "5.25" })).toEqual({ amount: "25.25", currency: "ZMW" });
    expect(await soldBond({ soldDate: "2026-09-01", soldPrice: "930.00", fees: "0.00" })).toEqual({ amount: "-20.00", currency: "ZMW" });
    expect(await soldBond({ soldDate: "2025-09-01", soldPrice: "900.00", fees: "0.00" })).toEqual({ amount: "-50.00", currency: "ZMW" });

    expect(await summary(2026)).toEqual({ year: 2026, realizedGains: "5.25", interestIncome: "0.00", dividendIncome: "0.00",
      grossIncome: "5.25", totalWht: "0.00", netIncome: "5.25", currency: "ZMW" });
    expect(await summary(2025)).toMatchObject({ year: 2025, realizedGains: "-50.00", grossIncome: "-50.00", netIncome: "-50.00", currency: "ZMW" });
    expect(await summary(2027)).toMatchObject({ realizedGains: "0.00", grossIncome: "0.00" });
  });

  it("counts a sale held in, or sold into, a private account for its owner only", async () => {
    await soldBond({ soldDate: "2026-08-15", soldPrice: "980.50", fees: "5.25" });
    // Private custody, proceeds to the shared account.
    await soldBond({ soldDate: "2026-08-20", soldPrice: "980.50", fees: "0.00" }, ids.privateAccount, ids.sharedAccount);
    // Shared custody, proceeds to the owner's private account.
    await soldBond({ soldDate: "2026-09-01", soldPrice: "930.00", fees: "0.00" }, ids.sharedAccount, ids.privateAccount);

    expect(await summary(2026, "owner")).toMatchObject({ realizedGains: "35.75", grossIncome: "35.75", netIncome: "35.75" });
    expect(await summary(2026, "member")).toMatchObject({ realizedGains: "25.25", grossIncome: "25.25", netIncome: "25.25" });
  });
});
