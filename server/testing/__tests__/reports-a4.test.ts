import { describe, expect, it } from "vitest";
import { createReportsA4Plan } from "../fixtures/reports-a4";

// Independent fixture arithmetic only: never import production report or Money helpers.
const cents = (value: string) => BigInt(value.replace(".", ""));
const rateUnits = (value: string) => BigInt(value.replace(".", ""));
const convert = (amount: bigint, rate: string) => (amount * rateUnits(rate) + 5000n) / 10000n;

describe("portable A4 reports input contract", () => {
  it("owns fresh data and an explicit historical clock without credentials or runtime targets", () => {
    const first = createReportsA4Plan();
    const second = createReportsA4Plan();
    expect(first).toEqual(second);
    expect(first.accounts).not.toBe(second.accounts);
    expect(first.operations[8]).not.toBe(second.operations[8]);
    expect(first.clock).toEqual({ asOfDate: "2026-10-14", householdTimezone: "Africa/Lusaka", serverTimezone: "UTC" });
    expect(first.identity).toEqual({ owner: "OWNER", household: "HOUSEHOLD", baseCurrency: "ZMW" });
    first.accounts[0].opening = "0.00";
    const split = first.operations.find(row => row.key === "T9");
    if (!split || split.type === "transfer" || !split.splits) throw new Error("Missing split fixture");
    split.splits[0].amount = "0.00";
    expect(second).toEqual(createReportsA4Plan());
  });

  it("retains complete logical ownership, categories, merchants and split/transfer identities", () => {
    const plan = createReportsA4Plan();
    expect(plan.accounts).toHaveLength(5);
    expect(plan.operations).toHaveLength(13);
    expect(new Set(plan.operations.map(row => row.key)).size).toBe(13);
    const accounts = new Map(plan.accounts.map(row => [row.key, row]));
    const categories = new Map(plan.categories.map(row => [row.key, row]));
    expect([...plan.rates].sort((a, b) => a.date.localeCompare(b.date))).toEqual(plan.rates);
    for (const rate of plan.rates) {
      expect(rate).toMatchObject({ from: "USD", to: "ZMW" });
      expect(rate.rate).toMatch(/^\d+\.\d{4}$/);
    }
    for (const account of plan.accounts) expect(account.opening).toMatch(/^\d+\.\d{2}$/);
    let transactionRows = 0;
    let allocationRows = 0;
    for (const operation of plan.operations) {
      expect(operation.amount).toMatch(/^\d+\.\d{2}$/);
      expect(operation.date <= plan.clock.asOfDate).toBe(true);
      if (operation.type === "transfer") {
        transactionRows += 2;
        expect(operation.from).not.toBe(operation.to);
        expect(accounts.get(operation.from)?.currency).toBe(operation.currency);
        expect(accounts.get(operation.to)?.currency).toBe(operation.currency);
        continue;
      }
      transactionRows++;
      expect(accounts.get(operation.account)?.currency).toBe(operation.currency);
      if (operation.merchant) expect(plan.merchants).toContain(operation.merchant);
      if (operation.splits) {
        expect(operation.category).toBeNull();
        allocationRows += operation.splits.length;
        expect(operation.splits.reduce((sum, row) => sum + cents(row.amount), 0n)).toBe(cents(operation.amount));
        for (const split of operation.splits) {
          expect(split.amount).toMatch(/^\d+\.\d{2}$/);
          expect(categories.get(split.category)?.type).toBe("expense");
        }
      } else expect(categories.get(operation.category!)?.type).toBe(operation.type);
    }
    expect(transactionRows).toBe(14);
    expect(allocationRows).toBe(2);
    expect(accounts.get("PRIV")).toMatchObject({ visibility: "private", owner: "OWNER" });
    expect(plan.operations.some(row => row.amount === "7.77")).toBe(false);
  });

  it("reconstructs account balances and positive card debt from every operation", () => {
    const plan = createReportsA4Plan();
    const balances = new Map(plan.accounts.map(row => [row.key, cents(row.opening)]));
    for (const operation of plan.operations) {
      const amount = cents(operation.amount);
      if (operation.type === "transfer") {
        balances.set(operation.from, balances.get(operation.from)! - amount);
        balances.set(operation.to, balances.get(operation.to)! + amount);
      } else {
        const liability = plan.accounts.find(row => row.key === operation.account)!.type === "credit";
        const effect = (operation.type === "income") !== liability ? amount : -amount;
        balances.set(operation.account, balances.get(operation.account)! + effect);
      }
    }
    expect(Object.fromEntries(balances)).toEqual({ CHK: 3684803n, SAV: 300000n, USD: 7500n, CC: 54550n, PRIV: 28766n });
    const rate = plan.rates.filter(row => row.date <= plan.clock.asOfDate).at(-1)!.rate;
    const assets = balances.get("CHK")! + balances.get("SAV")! + balances.get("PRIV")! + convert(balances.get("USD")!, rate);
    expect(assets).toBe(4212319n);
    expect(assets - balances.get("CC")!).toBe(4157769n);
    // Wrong decreasing-positive-debt semantics must not satisfy the oracle.
    expect(assets - (50000n - 4550n)).toBe(4166869n);
    expect(assets - (50000n - 4550n)).not.toBe(4157769n);
  });

  it("uses transaction-date FX, half-up cents and split allocations without double counting", () => {
    const plan = createReportsA4Plan();
    const months = new Map<string, bigint>();
    const octoberCategories = new Map<string, bigint>();
    for (const operation of plan.operations) {
      if (operation.type !== "expense") continue;
      const rate = operation.currency === "ZMW" ? "1.0000" : plan.rates.filter(row => row.date <= operation.date).at(-1)!.rate;
      const amount = convert(cents(operation.amount), rate);
      const month = operation.date.slice(0, 7);
      months.set(month, (months.get(month) ?? 0n) + amount);
      if (month !== "2026-10") continue;
      for (const allocation of operation.splits ?? [{ category: operation.category!, amount: operation.amount }]) {
        octoberCategories.set(allocation.category, (octoberCategories.get(allocation.category) ?? 0n) + convert(cents(allocation.amount), rate));
      }
    }
    expect(Object.fromEntries(months)).toEqual({ "2026-09": 156415n, "2026-10": 127375n });
    expect([...months.values()].reduce((sum, amount) => sum + amount, 0n)).toBe(283790n);
    expect(octoberCategories.get("Groceries")).toBe(21999n);
    expect(octoberCategories.get("Entertainment")).toBe(70809n);
    expect([...octoberCategories.values()].reduce((sum, amount) => sum + amount, 0n)).toBe(127375n);
    expect(convert(2500n, "25.1234")).toBe(62809n);
    const wrongLatestTotal = 127375n - 62809n + convert(2500n, "26.5000");
    expect(wrongLatestTotal).toBe(130816n);
    expect(wrongLatestTotal).not.toBe(127375n);
  });
});
