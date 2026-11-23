/** Pure synthetic inputs; no database, application writer, credentials or runtime target. */
type Category = "Groceries" | "Dining";
type Account = "CHECKING" | "SAVINGS" | "USD";
export type BudgetA1Scenario = "base" | "overspend" | "missing-fx" | "average" | "rollover";
interface Expense {
  key: string;
  account: Account;
  currency: "ZMW" | "USD";
  amount: string;
  date: string;
  type: "expense";
  status: "cleared";
  isPending: false;
  category: Category | null;
  splits?: { category: Category; amount: string }[];
}
export interface BudgetA1Plan {
  version: 1;
  fixture: "budgets-a1";
  scenario: BudgetA1Scenario;
  identity: { owner: "OWNER"; household: "HOUSEHOLD"; baseCurrency: "ZMW" };
  clock: { asOfDate: string; householdTimezone: "Africa/Lusaka"; serverTimezone: "UTC" };
  accounts: { key: Account; type: "checking" | "savings"; currency: "ZMW" | "USD";
    opening: string; visibility: "shared"; owner: "OWNER" }[];
  categories: { key: Category; name: string; type: "expense" }[];
  budgets: { key: Category; amount: string; currency: "ZMW"; rolloverEnabled: boolean }[];
  policy: { autoRolloverBudget: boolean; rolloverPercentage: 100 };
  operations: Expense[];
  rates: [];
  averagingPeriods: string[];
}

/** Fresh copies, isolated scenarios. Source/reset contract: R20/A1-BUDGET-RECONSTRUCTION.md. */
export function createBudgetA1Plan(scenario: BudgetA1Scenario = "base"): BudgetA1Plan {
  if (!["base", "overspend", "missing-fx", "average", "rollover"].includes(scenario)) {
    throw new Error("Unknown A1 budget scenario");
  }
  const expense = (key: string, date: string, amount: string): Expense => ({
    key, date, amount, account: "CHECKING", currency: "ZMW", category: "Groceries",
    type: "expense", status: "cleared", isPending: false,
  });
  const historicalOnly = scenario === "average" || scenario === "rollover";
  const operations: Expense[] = [
    expense("SEP_FIRST", "2026-09-01", "150.00"),
    expense("SEP_LAST", "2026-09-30", "400.00"),
  ];
  if (!historicalOnly) operations.push(
    expense("OCT_FIRST", "2026-10-01", "120.50"),
    expense("OCT_MIDDLE", "2026-10-14", "230.25"),
    expense("OCT_LAST", "2026-10-31", "99.99"),
    expense("NOV_FIRST", "2026-11-01", "77.77"),
    { ...expense("SPLIT", "2026-10-10", "300.00"), category: null,
      splits: [{ category: "Groceries", amount: "200.00" }, { category: "Dining", amount: "100.00" }] },
  );
  if (scenario === "overspend") operations.push(expense("OVERSPEND", "2026-10-20", "500.00"));
  if (scenario === "missing-fx") operations.push({
    ...expense("MISSING_FX", "2026-10-05", "50.00"), account: "USD", currency: "USD",
  });
  return {
    version: 1, fixture: "budgets-a1", scenario,
    identity: { owner: "OWNER", household: "HOUSEHOLD", baseCurrency: "ZMW" },
    clock: { asOfDate: historicalOnly ? "2026-10-01" : "2026-11-02",
      householdTimezone: "Africa/Lusaka", serverTimezone: "UTC" },
    accounts: [
      { key: "CHECKING", type: "checking", currency: "ZMW", opening: "10000.00", visibility: "shared", owner: "OWNER" },
      { key: "SAVINGS", type: "savings", currency: "ZMW", opening: "5000.00", visibility: "shared", owner: "OWNER" },
      { key: "USD", type: "checking", currency: "USD", opening: "1000.00", visibility: "shared", owner: "OWNER" },
    ],
    categories: [
      { key: "Groceries", name: "Groceries (Home Food)", type: "expense" },
      { key: "Dining", name: "Restaurants & Dining Out", type: "expense" },
    ],
    budgets: [
      { key: "Groceries", amount: "1000.00", currency: "ZMW", rolloverEnabled: true },
      { key: "Dining", amount: "500.00", currency: "ZMW", rolloverEnabled: false },
    ],
    policy: { autoRolloverBudget: scenario === "rollover", rolloverPercentage: 100 },
    operations, rates: [],
    averagingPeriods: scenario === "average" ? ["2026-07", "2026-08", "2026-09"] : [],
  };
}
