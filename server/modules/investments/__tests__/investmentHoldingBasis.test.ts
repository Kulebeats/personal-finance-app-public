import { describe, expect, it } from "vitest";
import { calculateHoldingRemainingBasis, type HoldingBasisFrame } from "../investmentHoldingBasis";

function frame(currency = "ZMW"): HoldingBasisFrame {
  return {
    holding: { id: "holding", householdId: "home", accountId: "account", securityId: "security", quantity: "2", costBasis: "0", costBasisZmw: "0" },
    currency,
    accounts: [{ id: "account", householdId: "home", deletedAt: null }],
    cash: [],
    lots: [{ id: "lot", householdId: "home", holdingId: "holding", transactionId: "buy", quantity: "2", remainingQuantity: "2", costBasis: "101", costBasisZmw: null, acquisitionFxRate: null, acquiredDate: "2031-01-01" }],
    activity: [{ id: "buy", householdId: "home", accountId: "account", holdingId: "holding", securityId: "security", type: "buy", quantity: "2", amount: "101", currency, amountZmw: null, fxRate: null, linkedTransactionId: null, transactionDate: "2031-01-01" }],
    disposals: [],
    claims: [{ id: "lot", transactionId: "buy" }],
  };
}
function partial(): HoldingBasisFrame {
  const input = frame();
  input.holding.quantity = "1";
  input.lots[0].remainingQuantity = "1";
  input.activity.push({ ...input.activity[0], id: "sell", type: "sell", quantity: "1", amount: "60", transactionDate: "2031-02-01" });
  input.disposals.push({ id: "disposal", householdId: "home", holdingId: "holding", taxLotId: "lot", transactionId: "sell", quantity: "1", costBasis: "50.50", costBasisZmw: null, proceeds: "60", proceedsZmw: null, realizedGain: "9.50", realizedGainZmw: null, disposedDate: "2031-02-01" });
  return input;
}

describe("full attributable remaining holding basis", () => {
  it("reconstructs fee-inclusive acquisition costs instead of preserving a stale zero aggregate", () => {
    expect(calculateHoldingRemainingBasis(frame())).toEqual({ quantity: "2.00000000", costBasis: "101.00", costBasisZmw: "101.00", acquisitionFxRate: null });
  });
  it("deducts only booked FIFO disposal cost, including its cent residual", () => {
    const input = partial();
    input.lots[0].costBasis = input.activity[0].amount = "1";
    input.lots[0].quantity = input.activity[0].quantity = "3";
    input.holding.quantity = input.lots[0].remainingQuantity = "2";
    input.disposals[0].costBasis = "0.33"; input.disposals[0].realizedGain = "59.67";
    expect(calculateHoldingRemainingBasis(input).costBasis).toBe("0.67");
  });
  it("keeps foreign basis dated to acquisition and actual disposal cost", () => {
    const input = partial(); input.currency = "USD";
    for (const row of input.activity) row.currency = "USD";
    input.lots[0].costBasisZmw = input.activity[0].amountZmw = "2020";
    input.lots[0].acquisitionFxRate = input.activity[0].fxRate = "20";
    input.activity[1].amountZmw = input.disposals[0].proceedsZmw = "1800";
    input.activity[1].fxRate = "30";
    input.disposals[0].costBasisZmw = "1010"; input.disposals[0].realizedGainZmw = "790";
    expect(calculateHoldingRemainingBasis(input)).toMatchObject({ costBasis: "50.50", costBasisZmw: "1010.00", acquisitionFxRate: null });
  });
  it("preserves an unknown foreign component instead of using a later purchase's rate", () => {
    const input = frame("USD");
    input.holding.quantity = "4";
    input.lots.push({ ...input.lots[0], id: "second", transactionId: "second-buy", costBasisZmw: "2525", acquisitionFxRate: "25" });
    input.activity.push({ ...input.activity[0], id: "second-buy", amountZmw: "2525", fxRate: "25" });
    input.claims.push({ id: "second", transactionId: "second-buy" });
    expect(calculateHoldingRemainingBasis(input)).toMatchObject({ costBasis: "202.00", costBasisZmw: null, acquisitionFxRate: null });
  });
  it.each([
    { native: "10", base: "9999", rate: "20" },
    { native: "0", base: "100", rate: null },
  ])("rejects matching BUY/lot fields whose stored foreign conversion contradicts the native cost: %j", source => {
    const input = frame("USD");
    input.activity[0].amount = input.lots[0].costBasis = source.native;
    input.activity[0].amountZmw = input.lots[0].costBasisZmw = source.base;
    input.activity[0].fxRate = input.lots[0].acquisitionFxRate = source.rate;
    expect(() => calculateHoldingRemainingBasis(input)).toThrow("Investment sale sources are unavailable");
  });
  it("rejects a persisted foreign sale conversion even when all allocations agree with it", () => {
    const input = partial(); input.currency = "USD";
    for (const row of input.activity) row.currency = "USD";
    input.activity[1].amountZmw = input.disposals[0].proceedsZmw = "9999";
    input.activity[1].fxRate = "20";
    expect(() => calculateHoldingRemainingBasis(input)).toThrow("Investment sale sources are unavailable");
  });
  it("does not require private source read visibility for internal basis maintenance", () => {
    const input = frame(); input.activity[0].linkedTransactionId = "private-cash";
    input.cash.push({ id: "private-cash", householdId: "home", accountId: "account", currency: "ZMW", deletedAt: null });
    expect(calculateHoldingRemainingBasis(input).costBasis).toBe("101.00");
  });
  it("closes an exhausted fully recorded lot at zero", () => {
    const input = partial(); input.holding.quantity = input.lots[0].remainingQuantity = "0";
    input.activity[1].quantity = input.disposals[0].quantity = "2";
    input.disposals[0].costBasis = "101"; input.disposals[0].realizedGain = "-41";
    expect(calculateHoldingRemainingBasis(input)).toMatchObject({ costBasis: "0.00", costBasisZmw: "0.00" });
  });
  it("refuses a resulting position beyond the holding's numeric capacity", () => {
    const input = frame();
    input.holding.quantity = input.lots[0].quantity = input.lots[0].remainingQuantity = input.activity[0].quantity = "10000000000";
    expect(() => calculateHoldingRemainingBasis(input)).toThrow("Investment sale sources are unavailable");
  });
  it.each(["opening", "partial opening", "purchase currency", "foreign lot", "missing purchase", "duplicate purchase", "missing sale", "duplicated disposal", "changed native cost", "exhausted residual", "foreign cash"])("refuses unproven or contradictory %s without source details", problem => {
    const input = partial();
    if (problem === "opening") { input.lots = []; input.activity = []; input.disposals = []; input.claims = []; input.holding.costBasis = null; }
    if (problem === "partial opening") input.holding.quantity = "2";
    if (problem === "purchase currency") input.activity[0].currency = "USD";
    if (problem === "foreign lot") input.lots[0].householdId = "foreign";
    if (problem === "missing purchase") input.activity.shift();
    if (problem === "duplicate purchase") input.claims.push({ id: "other-lot", transactionId: "buy" });
    if (problem === "missing sale") input.activity.pop();
    if (problem === "duplicated disposal") input.disposals.push({ ...input.disposals[0], id: "duplicate" });
    if (problem === "changed native cost") input.lots[0].costBasis = "100";
    if (problem === "exhausted residual") { input.holding.quantity = input.lots[0].remainingQuantity = "0"; input.activity[1].quantity = input.disposals[0].quantity = "2"; }
    if (problem === "foreign cash") { input.activity[0].linkedTransactionId = "cash"; input.cash.push({ id: "cash", householdId: "foreign", accountId: "account", currency: "ZMW", deletedAt: null }); }
    expect(() => calculateHoldingRemainingBasis(input)).toThrow("Investment sale sources are unavailable");
  });
});
