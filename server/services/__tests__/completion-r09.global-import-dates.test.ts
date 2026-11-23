import { beforeEach, describe, expect, it, vi } from "vitest";
const acquire = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../../db", () => ({ db: { transaction: vi.fn(async callback => callback({
  select: () => ({ from: () => ({ where: async () => [] }) }),
})) } }));
vi.mock("../../repositories/TransactionCreateBoundary", () => ({
  lockTransactionCreateGrant: vi.fn(async () => ({ householdId: "house", userId: "user", role: "owner" })),
}));
// The real module, so a new pure export (importedRowName, A-22) needs no mock; only the locks are faked.
vi.mock("../import/ledger", async importOriginal => ({
  ...(await importOriginal<typeof import("../import/ledger")>()),
  lockImportAccount: vi.fn(async () => ({ id: "account", currency: "ZMW", isAsset: true })),
  assertReplayableImportRow: vi.fn(),
}));
// NEW-17: the data_imports write is covered against real Postgres in completion-r09.import-identity.
vi.mock("../import/batch", () => ({ readImportBatchForUpdate: vi.fn(), replayImportBatch: vi.fn(),
  recordImportBatch: vi.fn(async () => "import-id") }));
vi.mock("../import/admission", async () => {
  const { db } = await import("../../db");
  return {
    accountImportKey: (id: string) => `csv-import:${id}`,
    withImportAdmission: (work: (admission: { acquire: typeof acquire; transaction: typeof db.transaction }) => unknown) =>
      work({ acquire, transaction: db.transaction }),
  };
});
vi.mock("../../repositories/TransactionRepository", () => ({ transactionRepository: {
  createWithinTransaction: vi.fn().mockResolvedValue({ transaction: { id: "test-transaction" } }),
} }));
vi.mock("../BusinessAuditService", () => ({ businessAuditService: { logCreate: vi.fn() } }));
vi.mock("../import/sideEffects", () => ({ runPostImportSideEffects: vi.fn() }));
// Date writer tests do not exercise the separate, visibility-scoped candidate read.
vi.mock("../import/candidates", () => ({ assignStatementCandidates: vi.fn(async () => new Map()) }));
import { ImportService } from "../ImportService";
import { transactionRepository } from "../../repositories/TransactionRepository";
import { previewImportDates } from "../../../client/src/components/import/datePreview";

describe("global import date writer boundary (UNIT, mocked persistence)", () => {
  beforeEach(() => vi.clearAllMocks());
  function service() {
    const instance = new ImportService();
    vi.spyOn(instance as any, "findOrCreateMerchantId").mockResolvedValue(null);
    // The account-scoped range work starts with the import lock; refused rows never reach it.
    return { instance, ranges: acquire };
  }
  const options = { userId: "user", householdId: "house", targetAccountId: "account",
    strategy: "prioritize_coppercoin" as const, mapping: { date: "d", amount: "a" }, categoryMapping: {} };

  it.each([["DD/MM/YYYY", "2026-02-01"], ["MM/DD/YYYY", "2026-01-02"]] as const)(
    "forwards %s to parsing, date range and writer", async (dateFormat, expected) => {
      const { instance, ranges } = service();
      const preview = previewImportDates([{ d: "01/02/2026", a: "1.00" }], "d", dateFormat);
      expect(preview.dates[0].dateString).toBe(expected);
      const result = await instance.executeImport(preview.rows, { ...options, dateFormat });
      expect(result).toMatchObject({ imported: 1, errors: [] });
      expect(ranges).toHaveBeenCalledWith("csv-import:account");
      expect(transactionRepository.createWithinTransaction).toHaveBeenCalledWith(expect.anything(),
        expect.objectContaining({ date: expected }), expect.anything());
    },
  );
  it.each(["2026-02-30", "01/02/2026"])("keeps %s away from the writer", async (date) => {
    const { instance, ranges } = service();
    const result = await instance.executeImport([{ d: date, a: "1.00" }], options);
    expect(result).toMatchObject({ imported: 0, errors: [{ rowIndex: 1, field: "date", value: date }] });
    expect(transactionRepository.createWithinTransaction).not.toHaveBeenCalled();
    expect(ranges).not.toHaveBeenCalled();
  });

  it("preserves shared date/notes/merchant/category mappings from preview to writer", async () => {
    const { instance } = service();
    const raw = [{ When: "25/12/2026", a: "1.00" }];
    const preview = previewImportDates(raw, "When", "auto");
    expect(preview.dates[0].dateString).toBe("2026-12-25");
    await instance.executeImport(preview.rows, { ...options, dateFormat: "auto",
      mapping: { date: "When", amount: "a", notes: "When", merchant: "When", category: "When" },
      categoryMapping: { "25/12/2026": "chosen-category" },
    });
    expect(transactionRepository.createWithinTransaction).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ date: "2026-12-25", name: "25/12/2026", notes: "25/12/2026", categoryId: "chosen-category" }),
      expect.anything());
    expect(raw).toEqual([{ When: "25/12/2026", a: "1.00" }]);
  });

  it("submits a raw-row snapshot even if the original source is later changed", async () => {
    const { instance } = service();
    const raw = [{ d: "01/02/2026", a: "1.00" }];
    const preview = previewImportDates(raw, "d", "DD/MM/YYYY");
    raw[0].d = "2026-12-25";
    await instance.executeImport(preview.rows, { ...options, dateFormat: "DD/MM/YYYY" });
    expect(transactionRepository.createWithinTransaction).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ date: "2026-02-01" }), expect.anything());
  });
});
