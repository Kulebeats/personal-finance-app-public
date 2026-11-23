import type { Client } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readAccountTransactionExport } from "../AccountTransactionExport";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), audit: vi.fn() }));
vi.mock("../../db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("../../services/BusinessAuditService", () => ({ businessAuditService: { log: mocks.audit } }));

const accountId = "00000000-0000-4000-8000-100000000001";
const householdId = "00000000-0000-4000-8000-100000000002";
const userId = "00000000-0000-4000-8000-100000000003";

describe("account transaction export lock query parameter cardinality", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.audit.mockResolvedValue(undefined); });

  it.each([1, 65_536])("locks all %s exported IDs through one bound UUID array", async count => {
    const ids = Array.from({ length: count }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
    const statements: Array<{ text: string; parameters: unknown[] }> = [];
    // Compile the actual production selects with Drizzle. Only the driver
    // results are synthetic; this client has no connection or network methods.
    const client = { query: vi.fn(async (query: { text: string }, parameters: unknown[]) => {
      statements.push({ text: query.text, parameters });
      if (query.text.startsWith('select "role" from "household_members"')) return { rows: [["member"]] };
      if (query.text.startsWith('select "id", "household_id", "name", "currency", "is_asset" from "accounts"')) {
        return { rows: [[accountId, householdId, "Synthetic account", "ZMW", true]] };
      }
      if (query.text.startsWith('select "id" from "accounts"')) return { rows: [[accountId]] };
      if (query.text.includes('from "transactions"')) {
        if (/for share$/i.test(query.text)) return { rows: [] };
        return { rows: ids.map(id => [id, "2026-10-05", "Synthetic transaction", "1.00", "expense", "ZMW", false, null, null, null, null, []]) };
      }
      throw new Error(`Unexpected generated query: ${query.text}`);
    }) };
    const tx = drizzle(client as unknown as Client);
    mocks.transaction.mockImplementation((callback: (database: NodePgDatabase) => Promise<unknown>) => callback(tx));

    const result = await readAccountTransactionExport(accountId, householdId, userId, {});
    expect(result.rows.map(row => row.id)).toEqual(ids);
    const locks = statements.filter(statement => statement.text.includes('from "transactions"') && /for share$/i.test(statement.text));
    expect(locks).toHaveLength(1);
    const lock = locks[0];
    expect(lock.parameters.length).toBe(1);
    expect(lock.parameters[0]).toEqual(ids);
    expect(lock.text).toMatch(/= ANY\(\$1::uuid\[\]\)/i);
    expect(lock.text).toMatch(/order by "transactions"\."id" for share$/i);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "repeatable read" });
    expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ tx,
      userId, householdId: null, action: "PROCESS", entityType: "data_export",
      details: { exportType: "account_transactions", fileFormat: "csv", recordCount: count } }));
    const sourceLockIndex = statements.indexOf(lock);
    expect(statements[sourceLockIndex + 1].text).toMatch(/from "accounts".*for share$/i);
  });
});
