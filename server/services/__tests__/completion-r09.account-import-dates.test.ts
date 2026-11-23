import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../account/AccountReportingService", () => ({ AccountReportingService: class {} }));
vi.mock("../../repositories/AccountRepository", () => ({ accountRepository: {
  findByIdWithVisibility: vi.fn().mockResolvedValue({ id: "account", name: "Test", currency: "USD" }),
} }));
vi.mock("../../repositories/CategoryRepository", () => ({ categoryRepository: {} }));
vi.mock("../../repositories/TagRepository", () => ({ tagRepository: {} }));
vi.mock("../GoalAccountAssignmentService", () => ({ goalAccountAssignmentService: {} }));
vi.mock("../TransactionService", () => ({ transactionService: {
  createTransaction: vi.fn().mockResolvedValue({ transaction: { id: "tx" }, isDuplicate: false }),
} }));
vi.mock("../BusinessAuditService", () => ({ businessAuditService: { logCreate: vi.fn() } }));
// The summary locks the current grant and target account (#367 review P2-1); persistence is mocked here.
vi.mock("../../repositories/TransactionCreateBoundary", async importOriginal => ({
  ...(await importOriginal<typeof import("../../repositories/TransactionCreateBoundary")>()),
  lockTransactionCreateGrant: vi.fn(async () => ({ householdId: "house", userId: "user", role: "owner" })),
}));
vi.mock("../import/ledger", async importOriginal => ({
  ...(await importOriginal<typeof import("../import/ledger")>()),
  lockImportAccount: vi.fn(async () => ({ id: "account", name: "Test", currency: "USD", isPrivate: false })),
}));
vi.mock("../../utils/withTransaction", () => ({ withTransaction: vi.fn() }));
vi.mock("../../db", () => ({ db: { transaction: (callback: (tx: object) => unknown) => callback({}), select: vi.fn(() => ({
  // The import-history lookup ends in .limit(); the key preflight awaits where() itself.
  from: vi.fn(() => ({ where: vi.fn(() => Object.assign(Promise.resolve([]), { limit: vi.fn().mockResolvedValue([]) })) })),
})) } }));
vi.mock("../import/candidates", () => ({ readLedgerCandidates: vi.fn().mockResolvedValue([]) }));
vi.mock("../import/admission", () => ({
  accountImportKey: (id: string) => id,
  withImportAdmission: (work: (admission: { acquire: () => Promise<void>; transaction: (callback: (tx: object) => unknown) => unknown }) => unknown) =>
    work({ acquire: async () => undefined, transaction: callback => callback({}) }),
}));
// NEW-17: the data_imports write is covered against real Postgres in completion-r09.import-identity.
vi.mock("../import/batch", () => ({ recordImportBatch: vi.fn() }));
vi.mock("../transaction/idempotentReplay", () => ({ readVisibleIdempotentReplay: vi.fn() }));
import { AccountImportService } from "../account/AccountImportService";
import { transactionService } from "../TransactionService";

describe("account import date writer boundary (UNIT, mocked persistence)", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each(["2026-02-30", "2026-02-29", "01/02/2026"])(
    "refuses %s before any writer, even after a valid row", async (date) => {
      const service = new AccountImportService();
      await expect(service.importTransactions("account", [
        { date: "2026-03-14", merchant: "First", amount: "1.00" },
        { date, merchant: "Second", amount: "1.00" },
      ], false, "house", "user")).rejects.toMatchObject({
        code: "VALIDATION_ERROR", fields: [{ field: "transactions.1.date" }],
      });
      expect(transactionService.createTransaction).not.toHaveBeenCalled();
    },
  );
  it("passes a valid leap day unchanged to the writer", async () => {
    await new AccountImportService().importTransactions("account", [
      { date: "2028-02-29", merchant: "Test", amount: "1.00" },
    ], false, "house", "user");
    expect(transactionService.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ date: "2028-02-29", currency: "USD" }), "house", "user",
      expect.any(String), undefined, { postingMode: "history_only", producer: "account_import",
        onCommitted: expect.any(Function), accountImportTransaction: expect.any(Function) });
  });
});
