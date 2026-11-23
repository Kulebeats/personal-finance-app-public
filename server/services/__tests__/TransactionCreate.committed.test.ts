import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "@shared/schema";

const mocks = vi.hoisted(() => ({
  findKey: vi.fn(), create: vi.fn(), account: vi.fn(), replay: vi.fn(), rules: vi.fn(), cache: vi.fn(),
  recurring: vi.fn(), notification: vi.fn(), merchant: vi.fn(),
}));
vi.mock("../../repositories/TransactionRepository", () => ({ transactionRepository: { findByIdempotencyKey: mocks.findKey, create: mocks.create } }));
vi.mock("../../repositories/AccountRepository", () => ({ accountRepository: { findByIdWithVisibility: mocks.account } }));
vi.mock("../../repositories/CategoryRepository", () => ({ categoryRepository: {} }));
vi.mock("../../repositories/MerchantRepository", () => ({ merchantRepository: {} }));
vi.mock("../transaction/idempotentReplay", () => ({ readVisibleIdempotentReplay: mocks.replay }));
vi.mock("../RuleService", () => ({ ruleService: { applyRules: mocks.rules } }));
vi.mock("../CacheInvalidation", () => ({ invalidateOnChangeAfterCommit: mocks.cache }));
vi.mock("../RecurringService", () => ({ recurringService: { autoLinkNewTransaction: mocks.recurring } }));
vi.mock("../NotificationService", () => ({ notificationService: { triggerLargeTransaction: mocks.notification } }));
vi.mock("../merchantRecognition", () => ({ resolveMerchantMatch: mocks.merchant }));
vi.mock("../../utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { createTransaction } from "../transaction/create";

const transaction = { id: "created", accountId: "account", householdId: "house", ownerUserId: "user", name: "Purchase",
  type: "expense", amount: "10.00", currency: "USD", date: "2026-11-02", postingMode: "posted" } as Transaction;
const run = (onCommitted = vi.fn()) => createTransaction({ accountId: "account", name: "Purchase", type: "expense",
  amount: "10.00", currency: "USD", date: "2026-11-02" }, "house", "user", "key", undefined, { postingMode: "posted", onCommitted });
// Golden fingerprint for run's fixed ordinary-create request, before merchant matching.
const requestDigest = "v1:513626753dfeb4dc8d1c186c91e1062d21b9f8b953b7d5e30218b503f734dc08";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findKey.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({ transaction });
  mocks.account.mockResolvedValue({ id: "account", currency: "USD" });
  mocks.merchant.mockResolvedValue({ cleanedName: "Purchase" });
  mocks.replay.mockImplementation(async value => value);
  mocks.rules.mockImplementation(async value => value);
  mocks.cache.mockResolvedValue(undefined);
  mocks.recurring.mockResolvedValue(undefined);
  mocks.notification.mockResolvedValue(undefined);
});

describe("ordinary create internal commit notification (UNIT, mocked repository commit)", () => {
  it("signals the new committed row before a required cache failure escapes", async () => {
    const order: string[] = [];
    mocks.create.mockImplementationOnce(async () => { order.push("commit"); return { transaction }; });
    mocks.rules.mockImplementationOnce(async value => { order.push("rules"); return value; });
    mocks.cache.mockImplementationOnce(async () => { order.push("cache"); throw new Error("required cache profile refusal"); });
    const committed = vi.fn(() => { order.push("committed callback"); });
    await expect(run(committed)).rejects.toThrow("required cache profile refusal");
    expect(committed).toHaveBeenCalledOnce();
    expect(committed).toHaveBeenCalledWith(transaction);
    expect(order).toEqual(["commit", "committed callback", "rules", "cache"]);
    expect(mocks.recurring).not.toHaveBeenCalled();
  });

  it("does not signal when the financial repository operation rolls back", async () => {
    const committed = vi.fn();
    mocks.create.mockRejectedValueOnce(new Error("atomic outbox failure"));
    await expect(run(committed)).rejects.toThrow("atomic outbox failure");
    expect(committed).not.toHaveBeenCalled();
    expect(mocks.cache).not.toHaveBeenCalled();
  });

  it("preserves authorized pre-read replay without announcing a new commit", async () => {
    const committed = vi.fn();
    mocks.findKey.mockResolvedValueOnce(transaction);
    await expect(run(committed)).resolves.toEqual({ transaction, isDuplicate: true });
    expect(mocks.replay).toHaveBeenCalledWith(
      transaction, "house", "user", undefined, undefined, requestDigest, undefined,
    );
    expect(committed).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("preserves unique-race replay without announcing the winner as this caller's new commit", async () => {
    const committed = vi.fn();
    mocks.findKey.mockResolvedValueOnce(undefined).mockResolvedValueOnce(transaction);
    mocks.create.mockRejectedValueOnce({ code: "23505", constraint: "transactions_idempotency_key_unique" });
    await expect(run(committed)).resolves.toEqual({ transaction, isDuplicate: true });
    expect(mocks.replay).toHaveBeenCalledWith(
      transaction, "house", "user", undefined, undefined, requestDigest, undefined,
    );
    expect(committed).not.toHaveBeenCalled();
    expect(mocks.cache).not.toHaveBeenCalled();
  });
});
