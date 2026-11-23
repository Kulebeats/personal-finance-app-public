import { describe, expect, it, vi } from "vitest";
import type { Transaction } from "@shared/schema";
import type { TransactionUpdateData } from "../TransactionSplitUpdate";
vi.mock("../../db", () => ({ db: {} }));
import { assertOrdinaryUpdateInput } from "../TransactionUpdateWriter";

const accountId = "11111111-1111-4111-8111-111111111111";
const before = { id: "22222222-2222-4222-8222-222222222222", householdId: "33333333-3333-4333-8333-333333333333",
  accountId, type: "expense", amount: "100.00", currency: "ZMW", source: "manual",
  isPending: true, status: "pending", isTransferIn: false, transferAccountId: null,
  transferTransactionId: null, isBalanceAdjustmentIncrease: true,
  createdAt: new Date("2026-11-02T00:00:00.000Z"), deletedAt: null } as Transaction;
const pair = { ...before, type: "transfer", transferAccountId: "44444444-4444-4444-8444-444444444444",
  transferTransactionId: "55555555-5555-4555-8555-555555555555" } as Transaction;

describe("R08 ordinary writer rejects identity and pair bypasses before no-op coercion", () => {
  it.each([
    ["id", { id: accountId }], ["household", { householdId: accountId }],
    ["created timestamp", { createdAt: new Date("2026-01-01") }], ["soft-delete", { deletedAt: new Date() }],
    ["pair identity", { transferTransactionId: accountId }], ["pair account", { transferAccountId: accountId }],
    ["null direction", { isTransferIn: null }], ["incoming direction", { isTransferIn: true }],
    ["posting delta", { postedBalanceDelta: "0.00" }], ["posting mode", { postingMode: "history_only" }],
    ["posted class", { postedAccountIsAsset: false }], ["null amount", { amount: null }],
    ["exponent no-op", { amount: "1e2" }], ["extra precision no-op", { amount: "100.000" }],
    ["null pending", { isPending: null }], ["fake status", { status: "false" }],
    ["null adjustment direction", { isBalanceAdjustmentIncrease: null }], ["null account", { accountId: null }],
    ["invalid owner", { ownerUserId: "other-household" }], ["type transfer", { type: "transfer" }],
  ])("rejects %s", (_label, update) => {
    expect(() => assertOrdinaryUpdateInput(before, update as unknown as TransactionUpdateData)).toThrow();
  });
  it.each([{ notes: "kept" }, { isPending: false, status: "cleared" as const }, { ownerUserId: null },
    { id: before.id, householdId: before.householdId, createdAt: before.createdAt, deletedAt: null },
  ])("preserves compatible ordinary metadata %j", update => {
    expect(() => assertOrdinaryUpdateInput(before, update)).not.toThrow();
  });
  it.each([{ amount: "101.00" }, { accountId: before.householdId }, { date: "2026-11-03" },
    { currency: "USD" }, { transferAccountId: null }, { transferTransactionId: null }, { type: "expense" as const },
  ])("rejects one-leg transfer mutation %j", update => {
    expect(() => assertOrdinaryUpdateInput(pair, update)).toThrow();
  });
  it("retains transfer metadata and exact monetary no-op", () => {
    expect(() => assertOrdinaryUpdateInput(pair, { notes: "kept", amount: "100.00", type: "transfer" })).not.toThrow();
  });
});