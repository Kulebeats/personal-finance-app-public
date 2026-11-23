import { vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { accounts, providerFxQuotes, householdMembers, households, type Account } from "@shared/schema";

export type SummaryAccountInput = Pick<Account, "id" | "balance" | "isAsset" | "type" | "currency">;
type Rows = readonly unknown[];
function query(rows: Rows) {
  const builder = {
    where: vi.fn((_predicate: SQL) => builder), innerJoin: vi.fn(() => builder), orderBy: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    then: (resolve: (rows: Rows) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
  };
  return builder;
}

/** SQL-only unit boundary: real reader, grant flow, quote selection and money math.
 * Authorized account inputs are a unit fixture; signed real-DB tests prove SQL visibility. */
export function createAccountSummarySqlFixture(input: SummaryAccountInput[], currency = "ZMW", rates: Array<{ fromCurrency: string; rate: string }> = []) {
  const date = new Date().toISOString().slice(0, 10);
  const rows = new Map<unknown, Rows>([
    [householdMembers, [{ role: "member" }]], [households, [{ currency }]],
    [providerFxQuotes, rates.map((rate, index) => ({ ...rate, id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      toCurrency: currency, provider: "yahoo_finance", quotedAt: new Date(`${date}T00:00:00Z`), effectiveDate: date, validThrough: date }))],
    [accounts, input.map(account => ({ estimatedValue: null, isHidden: false, isArchived: false,
      deletedAt: null, excludeFromNetWorth: false, createdAt: `${date}T00:00:00.000Z`, updatedAt: `${date}T00:00:00.000Z`, ...account }))],
  ]);
  const select = () => ({ from: vi.fn((table: unknown) => query(rows.get(table) ?? [])) });
  const tx = { select: vi.fn(select), selectDistinctOn: vi.fn(select) };
  const transaction = vi.fn(async (operation: (transaction: typeof tx) => Promise<unknown>) => operation(tx));
  // The second boundary is one publication SELECT, not an earlier RR snapshot.
  // Real-DB regressions independently exercise its grant/source/capture SQL.
  const publication = vi.fn((_statement: SQL) => Promise.resolve({ rows: [{
    allowed: true, financialsMatch: true, cut: [], changed: [], accounts: rows.get(accounts),
  }] }));
  return { tx, transaction, publication };
}
