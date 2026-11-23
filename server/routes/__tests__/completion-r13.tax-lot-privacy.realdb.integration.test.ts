import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { accounts, holdings, householdMembers, investmentTransactions, securities, taxLotDisposals, taxLots, transactions, users } from "@shared/schema";
import { db } from "../../db";
import { investmentService } from "../../modules/investments/investments.service";
import { a, b, actors, app, ids, reset, start, stop, type Role } from "../../modules/tags/__tests__/completion-r04.tags.fixture";

const publicSecurity = randomUUID(), privateSecurity = randomUUID(), publicHolding = randomUUID(), privateHolding = randomUUID();
const publicMarker = "R13_LOT_PUBLIC", privateMarker = "R13_LOT_PRIVATE";
let publicLot: string, privateLot: string, acquisition: string;
const get = (query = "", role: Role = "member") => request(app).get(`/api/investments/tax-lots${query}`).set("Cookie", actors.get(role)!.cookie)
  .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a);
function trade(type: "buy" | "sell", privateSource = false) {
  return request(app).post("/api/investments/transactions").set("Cookie", actors.get("owner")!.cookie)
    .set("X-Capital-Subject", actors.get("owner")!.id).set("X-Capital-Household", a).send({
      accountId: privateSource ? ids.privateAccount : ids.sharedAccount, holdingId: privateSource ? privateHolding : publicHolding,
      securityId: privateSource ? privateSecurity : publicSecurity, type, quantity: "1", price: privateSource ? "777.77" : type === "buy" ? "100.00" : "120.00",
      amount: privateSource ? "777.77" : type === "buy" ? "100.00" : "120.00", currency: "ZMW",
      transactionDate: type === "sell" ? "2031-02-01" : privateSource ? "2030-01-01" : "2030-02-01",
    });
}
async function clean() {
  await db.delete(taxLotDisposals).where(inArray(taxLotDisposals.householdId, [a, b]));
  await db.delete(taxLots).where(inArray(taxLots.householdId, [a, b]));
  await db.delete(investmentTransactions).where(inArray(investmentTransactions.householdId, [a, b]));
  await db.delete(holdings).where(inArray(holdings.householdId, [a, b]));
  await db.delete(securities).where(inArray(securities.id, [publicSecurity, privateSecurity]));
}
async function closePublicLot() {
  const sale = await trade("sell").expect(201);
  const [disposal] = await db.select().from(taxLotDisposals).where(eq(taxLotDisposals.transactionId, sale.body.data.id));
  expect(disposal).toMatchObject({ taxLotId: publicLot, quantity: "1.00000000", proceeds: "120.00", costBasis: "100.00", realizedGain: "20.00" });
  return { saleId: sale.body.data.id as string, disposalId: disposal.id };
}

describe("R13 tax-lot GET/list protects every financial source before filtering and pagination", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await clean(); await reset();
    await db.insert(securities).values([
      { id: privateSecurity, symbol: "R13_LOT_PRIVATE", name: privateMarker, type: "stock", currency: "ZMW" },
      { id: publicSecurity, symbol: "R13_LOT_PUBLIC", name: publicMarker, type: "stock", currency: "ZMW" },
    ]);
    await db.insert(holdings).values([
      { id: privateHolding, householdId: a, accountId: ids.privateAccount, securityId: privateSecurity, quantity: "0", costBasis: "0", acquiredDate: "2030-01-01" },
      { id: publicHolding, householdId: a, accountId: ids.sharedAccount, securityId: publicSecurity, quantity: "0", costBasis: "0", acquiredDate: "2030-02-01" },
    ]);
    // The actual normal BUY caller supplies both basis provenance and FIFO lot.
    await trade("buy", true).expect(201);
    const bought = await trade("buy").expect(201); acquisition = bought.body.data.id;
    privateLot = (await db.select().from(taxLots).where(eq(taxLots.holdingId, privateHolding)))[0].id;
    publicLot = (await db.select().from(taxLots).where(eq(taxLots.holdingId, publicHolding)))[0].id;
  });
  afterEach(async () => { vi.restoreAllMocks(); await clean(); });
  afterAll(async () => { await clean(); await stop(); });

  it.each(["admin", "member", "view_only", "professional"] as const)("shows shared lots to %s without exposing another member's custody/basis", async role => {
    const response = await get("", role).expect(200);
    expect(response.body.data).toEqual([expect.objectContaining({ id: publicLot, transactionId: acquisition, costBasis: "100.00", remainingQuantity: "1.00000000",
      holding: expect.objectContaining({ id: publicHolding }), security: expect.objectContaining({ name: publicMarker }) })]);
    expect(response.text).not.toContain(privateMarker); expect(response.text).not.toContain(privateLot); expect(response.text).not.toContain("777.77");
  });
  it("preserves the owner's private native values and the established response shape", async () => {
    const response = await get("", "owner").expect(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: privateLot, costBasis: "777.77", quantity: "1.00000000",
      holding: expect.objectContaining({ id: privateHolding }), security: expect.objectContaining({ name: privateMarker }) })]));
    expect(response.body.data.every((row: Record<string, unknown>) => !Object.hasOwn(row, "disposals"))).toBe(true);
  });
  it("applies privacy before an explicit private holding filter or a limit of one", async () => {
    expect((await get(`?holdingId=${privateHolding}&includeDisposals=true`).expect(200)).body.data).toEqual([]);
    expect((await get("?limit=1").expect(200)).body.data).toEqual([expect.objectContaining({ id: publicLot })]);
  });
  it.each(["holding account", "holding household", "lot household", "acquisition account", "acquisition household", "acquisition private cash", "deleted custody", "deleted acquisition"])(
    "does not promote an unsupported or inaccessible %s into shared lot data", async source => {
      if (source === "holding account") await db.update(holdings).set({ accountId: ids.privateAccount }).where(eq(holdings.id, publicHolding));
      if (source === "holding household") await db.update(holdings).set({ householdId: b }).where(eq(holdings.id, publicHolding));
      if (source === "lot household") await db.update(taxLots).set({ householdId: b }).where(eq(taxLots.id, publicLot));
      if (source === "acquisition account") await db.update(investmentTransactions).set({ accountId: ids.privateAccount }).where(eq(investmentTransactions.id, acquisition));
      if (source === "acquisition household") await db.update(investmentTransactions).set({ householdId: b }).where(eq(investmentTransactions.id, acquisition));
      if (source === "acquisition private cash") await db.update(investmentTransactions).set({ linkedTransactionId: ids.privateTx }).where(eq(investmentTransactions.id, acquisition));
      if (source === "deleted custody") await db.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, ids.sharedAccount));
      if (source === "deleted acquisition") {
        await db.delete(investmentTransactions).where(eq(investmentTransactions.id, acquisition));
        expect((await db.select().from(taxLots).where(eq(taxLots.id, publicLot)))[0].transactionId).toBeNull();
      }
      for (const suffix of ["", "&includeDisposals=true"]) expect((await get(`?holdingId=${publicHolding}${suffix}`).expect(200)).body.data).toEqual([]);
    });
  it("includes the real public FIFO disposal only when requested", async () => {
    const { disposalId } = await closePublicLot();
    const response = await get(`?holdingId=${publicHolding}&includeDisposals=true`).expect(200);
    expect(response.body.data).toEqual([expect.objectContaining({ id: publicLot, remainingQuantity: "0.00000000",
      disposals: [expect.objectContaining({ id: disposalId, realizedGain: "20.00", proceeds: "120.00", costBasis: "100.00" })] })]);
  });
  it.each(["closing account", "closing household", "closing holding", "closing private cash", "disposal household", "disposal holding", "deleted closing"])(
    "withholds derived lot state after %s withdrawal, including when disposals were not requested", async source => {
      const { saleId, disposalId } = await closePublicLot();
      if (source === "closing account") await db.update(investmentTransactions).set({ accountId: ids.privateAccount }).where(eq(investmentTransactions.id, saleId));
      if (source === "closing household") await db.update(investmentTransactions).set({ householdId: b }).where(eq(investmentTransactions.id, saleId));
      if (source === "closing holding") await db.update(investmentTransactions).set({ holdingId: privateHolding }).where(eq(investmentTransactions.id, saleId));
      if (source === "closing private cash") await db.update(investmentTransactions).set({ linkedTransactionId: ids.privateTx }).where(eq(investmentTransactions.id, saleId));
      if (source === "disposal household") await db.update(taxLotDisposals).set({ householdId: b }).where(eq(taxLotDisposals.id, disposalId));
      if (source === "disposal holding") await db.update(taxLotDisposals).set({ holdingId: privateHolding }).where(eq(taxLotDisposals.id, disposalId));
      if (source === "deleted closing") await db.delete(investmentTransactions).where(eq(investmentTransactions.id, saleId));
      for (const suffix of ["", "&includeDisposals=true"]) expect((await get(`?holdingId=${publicHolding}${suffix}`).expect(200)).body.data).toEqual([]);
    });
  it.each(["membership", "identity"])("rechecks current %s at the protected reader after the signed HTTP preflight", async source => {
    const original = investmentService.getTaxLots.bind(investmentService);
    vi.spyOn(investmentService, "getTaxLots").mockImplementationOnce(async (...args) => {
      if (source === "membership") await db.delete(householdMembers).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actors.get("member")!.id)));
      else await db.update(users).set({ erasedAt: new Date() }).where(eq(users.id, actors.get("member")!.id));
      return original(...args);
    });
    const response = await get(); expect(response.status).toBe(403); expect(response.text).not.toContain(publicMarker); expect(response.text).not.toContain(privateMarker);
  });
});
