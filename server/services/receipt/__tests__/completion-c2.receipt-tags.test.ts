import { beforeEach, describe, expect, it, vi } from "vitest";
import { tags, transactionTags } from "@shared/schema";
const state = vi.hoisted(() => ({ count: 0, usage: 0, inserted: true, updates: vi.fn(), inserts: vi.fn() }));
vi.mock("../conversion-evidence", () => ({ receiptRequestHash: () => "a".repeat(64), lockedConversionResult: async () => undefined }));
vi.mock("../../BusinessAuditService", () => ({ businessAuditService: { log: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("../../../repositories/ReceiptRepository", () => ({ receiptRepository: { findForSignedMatch: async () => ({ householdId: "household" }) } }));
vi.mock("../../../repositories/AccountRepository", () => ({ accountRepository: { findByIdWithVisibility: async () => ({ id: "account" }) } }));
vi.mock("../../../repositories/TransactionRepository", () => ({ transactionRepository: { createWithinTransaction: async () => ({ transaction: { id: "transaction" } }) } }));
vi.mock("../../merchantRecognition", () => ({ resolveMerchantMatch: async () => ({ merchant: null, cleanedName: "Receipt" }), ensureMerchantAlias: vi.fn() }));
vi.mock("../../../utils/withTransaction", () => ({ withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
  const tx = {
    select: (projection?: unknown) => ({ from: (table: unknown) => {
      const rows = table === tags ? [{ id: "tag", householdId: "household", usageCount: state.usage }]
        : projection ? [{ value: state.count }] : [];
      const chain = { where: () => chain, limit: () => chain, for: () => chain,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve) };
      return chain;
    } }),
    update: (table: unknown) => ({ set: (value: unknown) => ({ where: async () => state.updates(table, value) }) }),
    insert: (table: unknown) => ({ values: (value: unknown) => {
      const rows = state.inserted ? [{ tagId: "tag" }] : [];
      const chain = { onConflictDoNothing: () => chain, returning: async () => { state.inserts(table, value); return rows; },
        then: (resolve: (value: unknown) => unknown) => { state.inserts(table, value); return Promise.resolve(rows).then(resolve); } };
      return chain;
    } }),
  };
  return fn(tx);
} }));
import { receiptTransactionService } from "../transaction.service";
const create = () => receiptTransactionService.createTransactionFromReceipt("receipt", "household", "user", {
  accountId: "account", name: "Receipt", amount: "1.00", date: "2026-10-31",
});
describe("C2 receipt tag accounting through existing create caller (UNIT transaction adapter)", () => {
  beforeEach(() => { vi.clearAllMocks(); state.count = 0; state.usage = 0; state.inserted = true; });
  it("maintains the counter in the same transaction as a newly inserted link", async () => {
    await create();
    expect(state.inserts).toHaveBeenCalledWith(transactionTags, { transactionId: "transaction", tagId: "tag" });
    expect(state.updates.mock.calls.filter(([table]) => table === tags)).toHaveLength(1);
  });
  it("does not increment when the insert reports an existing link", async () => {
    state.inserted = false; await create();
    expect(state.updates.mock.calls.filter(([table]) => table === tags)).toHaveLength(0);
  });
  it("refuses historical mismatch without inserting a link or guessing a counter", async () => {
    state.count = 1;
    await expect(create()).rejects.toThrow("reconciliation");
    expect(state.inserts).not.toHaveBeenCalled();
    expect(state.updates.mock.calls.filter(([table]) => table === tags)).toHaveLength(0);
  });
});
