import { describe, expect, it } from "vitest";
import { createBudgetA1Plan, type BudgetA1Plan } from "../fixtures/budgets-a1";

// Independent integer cents, never application budget/FX/Money code.
const cents = (amount: string) => BigInt(amount.replace(".", ""));
function spend(plan: BudgetA1Plan) {
  const totals = new Map<string, bigint>();
  for (const row of plan.operations) {
    if (row.currency !== "ZMW") throw new Error("Missing conversion");
    for (const allocation of row.splits ?? [{ category: row.category!, amount: row.amount }]) {
      const key = `${row.date.slice(0, 7)}:${allocation.category}`;
      totals.set(key, (totals.get(key) ?? 0n) + cents(allocation.amount));
    }
  }
  return Object.fromEntries(totals);
}

describe("A1 isolated budget input plans", () => {
  it("reconstructs clean months and account effects without repeated historical attempts", () => {
    const plan = createBudgetA1Plan();
    expect(plan.operations).toHaveLength(7);
    expect(new Set(plan.operations.map(row => row.key)).size).toBe(7);
    expect(spend(plan)).toEqual({ "2026-09:Groceries": 55000n, "2026-10:Groceries": 65074n,
      "2026-11:Groceries": 7777n, "2026-10:Dining": 10000n });
    const total = plan.operations.reduce((sum, row) => sum + cents(row.amount), 0n);
    expect(total).toBe(137851n);
    expect(cents(plan.accounts[0].opening) - total).toBe(862149n);
    const october = spend(plan)["2026-10:Groceries"];
    expect(100000n - october).toBe(34926n);
    expect((october * 10000n + 50000n) / 100000n).toBe(6507n);
    const split = plan.operations.find(row => row.key === "SPLIT")!;
    expect(split.category).toBeNull();
    expect(split.splits).toHaveLength(2);
    expect(split.splits!.reduce((sum, row) => sum + cents(row.amount), 0n)).toBe(cents(split.amount));
    for (const row of plan.operations) {
      expect(row).toMatchObject({ status: "cleared", isPending: false, type: "expense" });
      expect(row.date < plan.clock.asOfDate).toBe(true);
      expect(plan.accounts.find(account => account.key === row.account)?.currency).toBe(row.currency);
    }
  });

  it("isolates overspend and missing-rate variants instead of accumulating earlier probes", () => {
    const over = createBudgetA1Plan("overspend");
    expect(over.operations).toHaveLength(8);
    expect(spend(over)["2026-10:Groceries"]).toBe(115074n);
    expect(100000n - spend(over)["2026-10:Groceries"]).toBe(-15074n);
    expect(cents(over.accounts[0].opening) - over.operations.reduce((sum, row) => sum + cents(row.amount), 0n)).toBe(812149n);
    const missing = createBudgetA1Plan("missing-fx");
    expect(missing.operations).toHaveLength(8);
    expect(missing.operations.at(-1)).toMatchObject({ account: "USD", currency: "USD", amount: "50.00" });
    expect(missing.rates).toEqual([]);
    expect(missing.operations.some(row => row.key === "OVERSPEND")).toBe(false);
    expect(() => spend(missing)).toThrow("Missing conversion");
    // A wrong 1:1 fallback would produce this distinct, unacceptable value.
    expect(65074n + 5000n).toBe(70074n);
  });

  it("declares elapsed zero months and keeps rollover isolated from average preview", () => {
    const average = createBudgetA1Plan("average");
    expect(average.clock).toEqual({ asOfDate: "2026-10-01", householdTimezone: "Africa/Lusaka", serverTimezone: "UTC" });
    expect(average.averagingPeriods).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(average.operations).toHaveLength(2);
    const monthTotals = spend(average);
    const elapsedSpend = average.averagingPeriods.reduce((sum, month) => sum + (monthTotals[`${month}:Groceries`] ?? 0n), 0n);
    expect(elapsedSpend).toBe(55000n);
    expect((elapsedSpend + 1n) / 3n).toBe(18333n);
    expect(average.budgets.find(row => row.key === "Dining")?.amount).toBe("500.00");
    expect(average.policy.autoRolloverBudget).toBe(false);
    const rollover = createBudgetA1Plan("rollover");
    expect(rollover.operations).toHaveLength(2);
    expect(rollover.policy).toEqual({ autoRolloverBudget: true, rolloverPercentage: 100 });
    expect(rollover.averagingPeriods).toEqual([]);
    expect(100000n - spend(rollover)["2026-09:Groceries"]).toBe(45000n);
  });

  it("gives every scenario independent nested data with logical identities only", () => {
    const first = createBudgetA1Plan();
    const second = createBudgetA1Plan();
    first.accounts[0].opening = "0.00";
    first.operations.find(row => row.key === "SPLIT")!.splits![0].amount = "0.00";
    first.budgets[0].amount = "0.00";
    expect(second).toEqual(createBudgetA1Plan());
    expect(second.identity).toEqual({ owner: "OWNER", household: "HOUSEHOLD", baseCurrency: "ZMW" });
    expect(second.clock.asOfDate).toBe("2026-11-02");
    expect(() => createBudgetA1Plan("unsupported" as "base")).toThrow("Unknown A1 budget scenario");
  });
});
