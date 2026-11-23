import { beforeEach, expect, it, vi } from "vitest";
import { Money } from "../../../core/money";
import { projectCashFlow } from "../ai.cashflow-projection";
import { renderLocalSummary } from "../ai.local-templates";
import { sanitizeCashFlowData } from "../ai.sanitizer";

const { readRules, readQuotes } = vi.hoisted(() => ({ readRules: vi.fn(), readQuotes: vi.fn() }));
vi.mock("../../../db", () => ({ db: { transaction: (run: (tx: object) => unknown) => run({}) } }));
vi.mock("../../../services/recurring/RecurringAudienceQuery", () => ({ listVisibleRecurringRules: readRules }));
vi.mock("../../../repositories/AccountValuationFx", async importOriginal => ({
  ...await importOriginal<typeof import("../../../repositories/AccountValuationFx")>(),
  readAccountValuationQuotes: readQuotes,
}));

const today = new Date("2026-10-14T12:00:00.000Z");
const actor = { householdId: "household", userId: "viewer", role: "member" } as const;
const bill = {
  id: "verified-bill", type: "expense", amount: "100.00", verifiedCurrency: "ZMW",
  frequency: "weekly", isActive: true, isPaused: false, nextDueDate: "2026-11-03",
};
const unprovenBill = { ...bill, id: "unproven-bill", frequency: "monthly", verifiedCurrency: null, amount: "10.00" };
function quote(fromCurrency: string, toCurrency: string, rate: string) {
  return { fromCurrency, toCurrency, rate, provider: "yahoo_finance", effectiveDate: "2026-10-14",
    validThrough: "2026-10-14", quotedAt: new Date("2026-10-14T10:00:00.000Z") };
}
function usdProjection(months = 1) {
  return projectCashFlow({ actor, currency: "USD", months, today, balances: [{ accountId: "account", accountName: "Checking",
    accountType: "checking", currency: "USD", balance: new Money("100.00", "USD"), isActive: true }] });
}

beforeEach(() => { readRules.mockReset(); readQuotes.mockReset(); readQuotes.mockResolvedValue([]); });

it("converts the verified ZMW bill at a trusted dated quote", async () => {
  readRules.mockResolvedValue([bill]);
  readQuotes.mockResolvedValue([quote("ZMW", "USD", "0.04")]);

  const [month] = await usdProjection();
  expect(month.outflow?.currency).toBe("USD");
  expect(month.outflow?.toString()).toBe("17.32");
  expect(month.projectedEndingBalance?.toString()).toBe("82.68");
  expect(readRules).toHaveBeenCalledWith(actor);
  expect(readQuotes).toHaveBeenCalledWith(expect.anything(), ["ZMW"], "USD", today);
});

it("uses the reciprocal of a trusted same-day quote when the market only publishes the other direction", async () => {
  readRules.mockResolvedValue([bill]);
  readQuotes.mockImplementation(async (_tx: unknown, _sources: string[], target: string) =>
    target === "ZMW" ? [quote("USD", "ZMW", "25")] : []);

  const [month] = await usdProjection();
  expect(month.outflow?.toString()).toBe("17.32");
  expect(month.projectedEndingBalance?.toString()).toBe("82.68");
  expect(readQuotes).toHaveBeenCalledWith(expect.anything(), ["USD"], "ZMW", today);
});

it("reports missing verified FX without obscuring zero inflow or restoring an unknown running balance", async () => {
  readRules.mockResolvedValue([{ ...bill, endDate: "2026-11-30" }]);
  const tooLate = { ...quote("ZMW", "USD", "0.04"), quotedAt: new Date("2026-10-14T13:00:00.000Z") };
  readQuotes.mockResolvedValue([tooLate]);

  const points = await usdProjection(2);
  expect(sanitizeCashFlowData(points).projections).toEqual([
    { month: "2026-11", inflow: "0.00", outflow: null, net: null, projectedEndingBalance: null },
    { month: "2026-12", inflow: "0.00", outflow: "0.00", net: "0.00", projectedEndingBalance: null },
  ]);
  const summary = renderLocalSummary([sanitizeCashFlowData(points)], "USD");
  expect(summary).toContain("in USD 0.00, out unavailable, net unavailable, balance unavailable");
});

it("keeps same-currency normalization and skips the FX lookup", async () => {
  readRules.mockResolvedValue([bill]);
  const [month] = await projectCashFlow({ actor, currency: "ZMW", balances: [], months: 1, today });
  expect(month.outflow?.toString()).toBe("433.00");
  expect(readQuotes).not.toHaveBeenCalled();
});

it.each(["income", "expense"] as const)("limits unproven %s to relevant months and leaves the opposite side known", async (type) => {
  const known = { ...bill, type: type === "income" ? "expense" : "income", amount: "40.00", frequency: "monthly" };
  readRules.mockResolvedValue([
    known,
    { ...unprovenBill, type, nextDueDate: "2026-12-31", endDate: "2027-01-01" },
    { ...unprovenBill, id: "after-horizon", nextDueDate: "2027-03-01" },
  ]);

  const points = await projectCashFlow({ actor, currency: "ZMW", balances: [], months: 4, today });
  const signedNet = type === "income" ? "-40.00" : "40.00";
  const money = (amount: string | null) => ({ inflow: type === "income" ? amount : "40.00",
    outflow: type === "expense" ? amount : "40.00" });
  expect(sanitizeCashFlowData(points).projections).toEqual([
    { month: "2026-11", ...money("0.00"), net: signedNet, projectedEndingBalance: signedNet },
    { month: "2026-12", ...money(null), net: null, projectedEndingBalance: null },
    { month: "2027-01", ...money(null), net: null, projectedEndingBalance: null },
    { month: "2027-02", ...money("0.00"), net: signedNet, projectedEndingBalance: null },
  ]);
  expect(readQuotes).not.toHaveBeenCalled();
});

it("keeps a known rule out of months before its first due date", async () => {
  readRules.mockResolvedValue([{ ...bill, nextDueDate: "2026-12-31" }]);
  const points = await projectCashFlow({ actor, currency: "ZMW", balances: [], months: 2, today });
  expect(points.map(month => month.outflow?.toString())).toEqual(["0.00", "433.00"]);
});
