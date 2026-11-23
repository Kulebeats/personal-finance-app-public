import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findAccount: vi.fn(), select: vi.fn(), findKeys: vi.fn(), findHistory: vi.fn(), ledger: vi.fn(), replay: vi.fn(), create: vi.fn(), audit: vi.fn(), findTag: vi.fn(), createTag: vi.fn(), tagWrite: vi.fn(), legacyLink: vi.fn(), legacyCount: vi.fn(),
}));
vi.mock("../account/AccountReportingService", () => ({ AccountReportingService: class {} }));
vi.mock("../../repositories/AccountTransactionExport", () => ({ readAccountTransactionExport: vi.fn() }));
vi.mock("../../repositories/AccountRepository", () => ({ accountRepository: { findByIdWithVisibility: mocks.findAccount } }));
vi.mock("../../db", () => ({ db: { transaction: (callback: (tx: object) => unknown) => callback({}), select: mocks.select } }));
// NEW-17: the data_imports write is covered against real Postgres in completion-r09.import-identity.
vi.mock("../import/batch", () => ({ recordImportBatch: vi.fn() }));
vi.mock("../import/admission", () => ({
  accountImportKey: (id: string) => id,
  withImportAdmission: (work: (admission: { acquire: () => Promise<void>; transaction: (callback: (tx: object) => unknown) => unknown }) => unknown) =>
    work({ acquire: async () => undefined, transaction: callback => callback({}) }),
}));
// The review flags read the ledger; their behaviour is covered in completion-new17.account-import-statement.
vi.mock("../import/candidates", () => ({ readLedgerCandidates: mocks.ledger }));
vi.mock("../../repositories/CategoryRepository", () => ({ categoryRepository: {} }));
vi.mock("../../repositories/TagRepository", () => ({ tagRepository: { findByName: mocks.findTag, create: mocks.createTag, addTagToTransaction: mocks.legacyLink, incrementUsageCount: mocks.legacyCount } }));
vi.mock("../transaction/idempotentReplay", () => ({ readVisibleIdempotentReplay: mocks.replay }));
vi.mock("../TransactionService", () => ({ transactionService: { createTransaction: mocks.create, addTagsToTransaction: mocks.tagWrite } }));
vi.mock("../BusinessAuditService", () => ({ businessAuditService: { logCreate: mocks.audit } }));
vi.mock("../../utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));
// The summary locks the current grant and target account (#367 review P2-1); persistence is mocked here.
vi.mock("../../repositories/TransactionCreateBoundary", async importOriginal => ({
  ...(await importOriginal<typeof import("../../repositories/TransactionCreateBoundary")>()),
  lockTransactionCreateGrant: vi.fn(async () => ({ householdId: "house", userId: "user", role: "owner" })),
}));
vi.mock("../import/ledger", async importOriginal => ({
  ...(await importOriginal<typeof import("../import/ledger")>()),
  lockImportAccount: vi.fn(async () => ({ id: "account", name: "Test", currency: "USD", isPrivate: false })),
}));

import { PgDialect } from "drizzle-orm/pg-core";
import { AccountImportService } from "../account/AccountImportService";
import { ConflictError, NotFoundError, ValidationError } from "../../core/errors";
import { apiErrorMiddleware } from "../../utils/errorHandler";
import { dataImports } from "@shared/schema";
import { Money } from "../../core/money";
import {
  accountImportRowKey, accountStatementFingerprint, accountStatementRowKey, importOccurrenceKey,
} from "../import/identity";
/** FIN-04: the import's total is a MoneyDto in the account currency, never a plain number. */
const usd = (whole: string) => ({ amount: `${whole}.00`, currency: "USD" });

const rows = [
  { date: "2026-11-01", merchant: "First", amount: "10.00" },
  { date: "2026-11-01", merchant: "Second", amount: "-4.00" },
  { date: "2026-11-01", merchant: "Third", amount: "2.00" },
];
/** NEW-17: the statement keys (statement fingerprint plus ordinal) the service writes. */
const keysOf = (data: typeof rows) => {
  const statement = accountStatementFingerprint(data.map(row => ({ ...row, amount: new Money(row.amount, "USD") })));
  return data.map((_, index) => accountStatementRowKey("house", "account", statement, index + 1));
};
const service = () => new AccountImportService();
const run = (data: Parameters<AccountImportService['importTransactions']>[1] = rows, adjustBalance = true) => service().importTransactions("account", data, adjustBalance, "house", "user");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findAccount.mockResolvedValue({ id: "account", name: "Test", currency: "USD" });
  // The import history lookup ends in .limit(); the key preflight is the plain where().
  mocks.select.mockReturnValue({ from: vi.fn(table => table === dataImports
    ? { where: () => ({ limit: mocks.findHistory }) } : { where: mocks.findKeys }) });
  mocks.findKeys.mockResolvedValue([]);
  mocks.findHistory.mockResolvedValue([]);
  mocks.ledger.mockResolvedValue([]);
  mocks.replay.mockImplementation(async row => row);
  mocks.create.mockResolvedValue({ transaction: { id: "created", postingMode: "posted" }, isDuplicate: false });
  mocks.audit.mockResolvedValue(undefined);
  mocks.findTag.mockResolvedValue(undefined);
  mocks.createTag.mockImplementation(async data => ({ id: data.name + "-id", ...data }));
  mocks.tagWrite.mockResolvedValue(undefined);
});

describe("account CSV partial outcomes (UNIT, mocked persistence)", () => {
  it.each(["history_only", null])("preflights a later %s mode before committing an earlier new row", async postingMode => {
    mocks.findKeys.mockResolvedValueOnce([{ id: "prior", postingMode, idempotencyKey: keysOf(rows)[1] }]);
    await expect(run()).rejects.toMatchObject({ statusCode: 409, code: "CONFLICT", message: expect.stringContaining("Row 2") });
    expect(mocks.replay).toHaveBeenCalledWith(
      expect.objectContaining({ id: "prior", postingMode }),
      "house",
      "user",
      undefined,
      { operation: "account_import", accountId: "account" },
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("authorizes a stored replay before inspecting its mode", async () => {
    mocks.findKeys.mockResolvedValueOnce([{ id: "hidden", postingMode: "history_only", idempotencyKey: keysOf(rows)[1] }]);
    mocks.replay.mockRejectedValueOnce(new NotFoundError("Transaction"));
    await expect(run()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("uses identical statement keys during preflight and posting", async () => {
    await expect(run([rows[0], rows[0]])).resolves.toMatchObject({ imported: 2, skipped: 0, totalAmount: usd("20") });
    const keys = keysOf([rows[0], rows[0]]);
    // One import-history lookup, then one key preflight.
    expect(mocks.select).toHaveBeenCalledTimes(2);
    const preflight = new PgDialect().sqlToQuery(mocks.findKeys.mock.calls[0][0]);
    expect(preflight.params).toEqual(["house", ...keys]);
    expect(mocks.create.mock.calls.map(call => call[3])).toEqual(keys);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("keeps the earlier content keys only for a file this account's history recorded under them", async () => {
    mocks.findHistory.mockResolvedValueOnce([{ id: "earlier-import" }]);
    await expect(run([rows[0], rows[0]])).resolves.toMatchObject({ imported: 2 });
    const base = accountImportRowKey("house", "account", rows[0]);
    expect(mocks.create.mock.calls.map(call => call[3])).toEqual([base, importOccurrenceKey(base, 1)]);
  });

  it("reports committed counts, failed row and safe validation cause without attempting subsequent rows", async () => {
    mocks.create.mockResolvedValueOnce({ transaction: { id: "first", postingMode: "posted" }, isDuplicate: false });
    mocks.create.mockRejectedValueOnce(new ValidationError("Insufficient funds"));
    const error = await run().catch(error => error);
    expect(error).toMatchObject({ statusCode: 400, code: "ACCOUNT_IMPORT_INCOMPLETE", details: {
      imported: 1, skipped: 0, totalAmount: usd("10"), failedRow: 2, remaining: 1, stage: "row",
      cause: { code: "VALIDATION_ERROR", message: "Insufficient funds" },
    } });
    expect(error.message).toContain("1 imported");
    expect(error.message).toContain("row 2");
    expect(mocks.create).toHaveBeenCalledTimes(2);
    // The real API middleware retains the typed recovery details.
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    apiErrorMiddleware(error, {} as never, response as never, vi.fn());
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: expect.objectContaining({
      code: "ACCOUNT_IMPORT_INCOMPLETE", details: expect.objectContaining({ imported: 1, failedRow: 2 }),
    }) }));
  });

  it("retains completed duplicate and signed totals in a late mode-conflict outcome", async () => {
    mocks.create.mockResolvedValueOnce({ transaction: { id: "prior", postingMode: "posted" }, isDuplicate: true });
    mocks.create.mockResolvedValueOnce({ transaction: { id: "expense", postingMode: "posted" }, isDuplicate: false });
    mocks.create.mockRejectedValueOnce(new ConflictError("Import posting mode differs"));
    await expect(run()).rejects.toMatchObject({ statusCode: 409, details: {
      imported: 1, skipped: 1, totalAmount: usd("-4"), failedRow: 3, remaining: 0,
      cause: { code: "CONFLICT" },
    } });
  });

  it("never returns a raw database failure to the API", async () => {
    mocks.create.mockResolvedValueOnce({ transaction: { id: "first", postingMode: "posted" }, isDuplicate: false });
    mocks.create.mockRejectedValueOnce(new Error("Failed query: secret schema and credentials"));
    const error = await run().catch(error => error);
    expect(error).toMatchObject({ statusCode: 500, details: { imported: 1, failedRow: 2, cause: { code: "INTERNAL_ERROR" } } });
    expect(JSON.stringify(error.toJSON())).not.toContain("secret");
    expect(JSON.stringify(error.toJSON())).not.toContain("credentials");
  });

  it("same-file retry skips the committed row and posts each remaining row once", async () => {
    const saved = new Map<string, { id: string; postingMode: string }>();
    let failSecond = true;
    let actualPosts = 0;
    mocks.findKeys.mockImplementation(async () => Array.from(saved, ([key, row]) => ({ ...row, idempotencyKey: key })));
    mocks.create.mockImplementation(async (_data, _house, _user, key) => {
      const existing = saved.get(key);
      if (existing) return { transaction: existing, isDuplicate: true };
      if (actualPosts === 1 && failSecond) { failSecond = false; throw new ValidationError("Insufficient funds"); }
      const transaction = { id: `saved-${++actualPosts}`, postingMode: "posted" };
      saved.set(key, transaction);
      return { transaction, isDuplicate: false };
    });
    await expect(run()).rejects.toMatchObject({ details: { imported: 1, skipped: 0, failedRow: 2 } });
    await expect(run()).resolves.toMatchObject({ imported: 2, skipped: 1, totalAmount: usd("-2") });
    expect(actualPosts).toBe(3);
    expect(saved.size).toBe(3);
  });

  it("reports that all rows committed if only the final import summary fails", async () => {
    mocks.audit.mockRejectedValueOnce(new Error("secret audit insert"));
    await expect(run()).rejects.toMatchObject({ code: "ACCOUNT_IMPORT_INCOMPLETE", details: {
      imported: 3, skipped: 0, totalAmount: usd("8"), failedRow: null, remaining: 0, stage: "summary",
      cause: { code: "INTERNAL_ERROR" },
    } });
    expect(mocks.create).toHaveBeenCalledTimes(3);
  });

  it("counts a row committed before a required cache failure with its requested tags", async () => {
    mocks.create.mockImplementationOnce(async (_data, _house, _user, _key, _audit, options) => {
      options.onCommitted({ id: "committed-before-cache", postingMode: "posted" });
      throw new Error("required cache profile refusal");
    });
    await expect(run([{ ...rows[0], tags: "Food" }, rows[1]])).rejects.toMatchObject({ code: "ACCOUNT_IMPORT_INCOMPLETE", details: {
      imported: 1, skipped: 0, totalAmount: usd("10"), failedRow: 1, remaining: 1, stage: "postcommit",
      committedTransactionId: "committed-before-cache",
    } });
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.tagWrite).not.toHaveBeenCalled();
  });

  it("counts a commit signal once when the ordinary create also returns successfully", async () => {
    mocks.create.mockImplementationOnce(async (_data, _house, _user, _key, _audit, options) => {
      const transaction = { id: "signaled", postingMode: "posted" };
      options.onCommitted(transaction);
      return { transaction, isDuplicate: false };
    });
    await expect(run([rows[0]])).resolves.toEqual({ imported: 1, skipped: 0, totalAmount: usd("10"), possibleDuplicates: [], reviewSkipped: 0 });
  });

  it("passes initial requested tags into the posting boundary and counts no row when it rolls back", async () => {
    mocks.create.mockRejectedValueOnce(new Error("tag update refused"));
    await expect(run([{ ...rows[0], tags: "Food, Travel" }])).rejects.toMatchObject({ details: {
      imported: 0, skipped: 0, failedRow: 1, stage: "row",
    } });
    expect(mocks.create).toHaveBeenCalledWith(expect.anything(), "house", "user", expect.any(String), undefined,
      expect.objectContaining({ initialImportTagNames: ["Food", "Travel"] }));
    expect(mocks.tagWrite).not.toHaveBeenCalled();
  });
});
