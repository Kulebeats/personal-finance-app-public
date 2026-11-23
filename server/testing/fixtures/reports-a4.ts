/**
 * Portable synthetic input plan, not a database seeder or a report implementation.
 * Keys are logical references; a protected provisioner must allocate fresh IDs.
 * Source and independent arithmetic: docs/reviews/completion-v2-evidence/R20/A4-RECONSTRUCTION.md.
 */
type Currency = "ZMW" | "USD";
type AccountKey = "CHK" | "SAV" | "USD" | "CC" | "PRIV";
type CategoryKey = "Salary" | "Groceries" | "Dining" | "Utilities" | "Transport" | "Entertainment";
type MerchantKey = "Shoprite" | "Zesco" | "Pizza Inn";
interface Posting {
  key: string;
  date: string;
  type: "income" | "expense";
  account: AccountKey;
  amount: string;
  currency: Currency;
  category: CategoryKey | null;
  merchant: MerchantKey | null;
  splits?: { category: CategoryKey; amount: string }[];
}
interface Transfer {
  key: string;
  date: string;
  type: "transfer";
  from: AccountKey;
  to: AccountKey;
  amount: string;
  currency: Currency;
}
export interface ReportsA4Plan {
  version: 1;
  fixture: "reports-a4";
  identity: { owner: "OWNER"; household: "HOUSEHOLD"; baseCurrency: "ZMW" };
  clock: { asOfDate: string; householdTimezone: "Africa/Lusaka"; serverTimezone: "UTC" };
  accounts: {
    key: AccountKey;
    type: "checking" | "savings" | "credit";
    currency: Currency;
    opening: string;
    visibility: "shared" | "private";
    owner: "OWNER";
  }[];
  categories: { key: CategoryKey; type: "income" | "expense" }[];
  merchants: MerchantKey[];
  operations: (Posting | Transfer)[];
  rates: { date: string; from: "USD"; to: "ZMW"; rate: string }[];
}

/** Each caller owns its copy; scenario mutations cannot contaminate another plan. */
export function createReportsA4Plan(): ReportsA4Plan {
  return {
    version: 1,
    fixture: "reports-a4",
    identity: { owner: "OWNER", household: "HOUSEHOLD", baseCurrency: "ZMW" },
    clock: { asOfDate: "2026-10-14", householdTimezone: "Africa/Lusaka", serverTimezone: "UTC" },
    accounts: [
      { key: "CHK", type: "checking", currency: "ZMW", opening: "10000.00", visibility: "shared", owner: "OWNER" },
      { key: "SAV", type: "savings", currency: "ZMW", opening: "2000.00", visibility: "shared", owner: "OWNER" },
      { key: "USD", type: "checking", currency: "USD", opening: "100.00", visibility: "shared", owner: "OWNER" },
      { key: "CC", type: "credit", currency: "ZMW", opening: "500.00", visibility: "shared", owner: "OWNER" },
      { key: "PRIV", type: "checking", currency: "ZMW", opening: "300.00", visibility: "private", owner: "OWNER" },
    ],
    categories: [
      { key: "Salary", type: "income" },
      { key: "Groceries", type: "expense" },
      { key: "Dining", type: "expense" },
      { key: "Utilities", type: "expense" },
      { key: "Transport", type: "expense" },
      { key: "Entertainment", type: "expense" },
    ],
    merchants: ["Shoprite", "Zesco", "Pizza Inn"],
    operations: [
      { key: "T1", date: "2026-09-01", type: "income", account: "CHK", amount: "15000.00", currency: "ZMW", category: "Salary", merchant: null },
      { key: "T2", date: "2026-09-05", type: "expense", account: "CHK", amount: "1234.56", currency: "ZMW", category: "Groceries", merchant: "Shoprite" },
      { key: "T3", date: "2026-09-12", type: "expense", account: "CHK", amount: "33.33", currency: "ZMW", category: "Utilities", merchant: "Zesco" },
      { key: "T4", date: "2026-09-20", type: "expense", account: "CHK", amount: "0.01", currency: "ZMW", category: "Dining", merchant: "Pizza Inn" },
      { key: "T5", date: "2026-09-30", type: "expense", account: "CHK", amount: "250.75", currency: "ZMW", category: "Transport", merchant: null },
      { key: "T6", date: "2026-09-15", type: "expense", account: "CC", amount: "45.50", currency: "ZMW", category: "Dining", merchant: "Pizza Inn" },
      { key: "T7", date: "2026-10-01", type: "income", account: "CHK", amount: "15000.00", currency: "ZMW", category: "Salary", merchant: null },
      { key: "T8", date: "2026-10-01", type: "expense", account: "CHK", amount: "99.99", currency: "ZMW", category: "Groceries", merchant: "Shoprite" },
      { key: "T9", date: "2026-10-07", type: "expense", account: "CHK", amount: "200.00", currency: "ZMW", category: null, merchant: null,
        splits: [{ category: "Groceries", amount: "120.00" }, { category: "Entertainment", amount: "80.00" }] },
      { key: "T10", date: "2026-10-10", type: "transfer", from: "CHK", to: "SAV", amount: "1000.00", currency: "ZMW" },
      { key: "T11", date: "2026-10-11", type: "expense", account: "USD", amount: "25.00", currency: "USD", category: "Entertainment", merchant: null },
      { key: "T12", date: "2026-10-14", type: "expense", account: "CHK", amount: "333.33", currency: "ZMW", category: "Utilities", merchant: "Zesco" },
      { key: "T13", date: "2026-10-09", type: "expense", account: "PRIV", amount: "12.34", currency: "ZMW", category: "Dining", merchant: null },
    ],
    rates: [
      { date: "2026-10-01", from: "USD", to: "ZMW", rate: "25.1234" },
      { date: "2026-10-12", from: "USD", to: "ZMW", rate: "26.5432" },
      { date: "2026-10-13", from: "USD", to: "ZMW", rate: "26.5000" },
    ],
  };
}
