import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ member: vi.fn(), write: vi.fn(), insert: vi.fn(), audit: vi.fn() }));
// Keep the legacy facade and its delegation real; isolate unrelated operations.
vi.mock("../CacheInvalidation", () => ({ invalidateOnChangeAfterCommit: vi.fn() }));
vi.mock("../merchantRecognition", () => ({ ensureMerchantAlias: vi.fn(), resolveMerchantMatch: vi.fn() }));
vi.mock("../../core/events", () => ({ outboxEventService: {}, EventTypes: {} }));
vi.mock("../TransferService", () => ({ transferService: {} }));
vi.mock("../transaction/queries", () => ({}));
vi.mock("../transaction/helpers", () => ({}));
vi.mock("../transaction/transferGuard", () => ({}));
vi.mock("../transaction/owner", () => ({}));
vi.mock("../transaction/review", () => ({}));
vi.mock("../transaction/create", () => ({}));
vi.mock("../transaction/delete", () => ({}));
vi.mock("../BusinessAuditService", () => ({ businessAuditService: { getIpAddress: () => "192.0.2.1", logUpdate: mocks.audit } }));
vi.mock("../../repositories/CategoryRepository", () => ({ categoryRepository: {} }));
vi.mock("../../modules/transactions/transactions.helpers", () => ({ mapTransactionMoney: vi.fn() }));
vi.mock("../../repositories/HouseholdRepository", () => ({ householdRepository: { findMember: mocks.member } }));
vi.mock("../../repositories/TagWriteRepository", () => ({ tagWriteRepository: { write: mocks.write } }));
vi.mock("../../repositories/TransactionRepository", () => ({ transactionRepository: { findByIdWithVisibility: vi.fn(async () => ({ id: "transaction" })) } }));
vi.mock("../../db", () => ({ db: {
  select: () => ({ from: () => ({ where: async () => [{ id: "tag" }] }) }),
  insert: mocks.insert,
} }));
import { addTagsToTransaction } from "../transaction/tags";
import { bulkAddTags } from "../../modules/transactions/transactions.bulk.controller";
import type { Request, Response } from "express";

describe("C2 existing bulk tag caller uses the atomic tag writer (UNIT)", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.write.mockResolvedValue({ added: 1, removed: 0 });
    mocks.insert.mockReturnValue({ values: () => ({ onConflictDoNothing: async () => undefined }) });
  });
  it.each(["owner", "admin", "member"])("%s delegates links/counters/audit to the locked writer", async role => {
    mocks.member.mockResolvedValue({ role });
    await addTagsToTransaction("transaction", ["tag"], "household", "user");
    expect(mocks.write).toHaveBeenCalledWith({ householdId: "household", userId: "user", role },
      { operation: "add", transactionId: "transaction", tagIds: ["tag"] }, undefined);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it.each(["professional", "view_only", "unknown", null])("denies %s before any tag mutation", async role => {
    mocks.member.mockResolvedValue(role ? { role } : undefined);
    await expect(addTagsToTransaction("transaction", ["tag"], "household", "user")).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.insert).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it("propagates reconciliation refusal without fallback writes", async () => {
    mocks.member.mockResolvedValue({ role: "member" });
    mocks.write.mockRejectedValue(new Error("Tag state requires reconciliation"));
    await expect(addTagsToTransaction("transaction", ["tag"], "household", "user")).rejects.toThrow("reconciliation");
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("passes IP to each atomic writer and never emits a second requested-delta audit", async () => {
    mocks.member.mockResolvedValue({ role: "member" });
    mocks.audit.mockResolvedValue(undefined);
    mocks.write.mockResolvedValueOnce({ added: 1, removed: 0 })
      .mockResolvedValueOnce({ added: 0, removed: 0 }).mockRejectedValueOnce(new Error("audit rollback"));
    const json = vi.fn();
    await bulkAddTags({ householdContext: { householdId: "household", userId: "user" },
      body: { transactionIds: ["first", "retry", "failed"], tagIds: ["tag", "tag"] } } as Request, { json } as unknown as Response);
    expect(mocks.audit).not.toHaveBeenCalled();
    for (const transactionId of ["first", "retry", "failed"]) expect(mocks.write).toHaveBeenCalledWith(
      { householdId: "household", userId: "user", role: "member" },
      { operation: "add", transactionId, tagIds: ["tag", "tag"] }, "192.0.2.1");
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ data: { successCount: 2, totalCount: 3,
      results: [{ id: "first", success: true }, { id: "retry", success: true }, { id: "failed", success: false }] } }));
  });
});
