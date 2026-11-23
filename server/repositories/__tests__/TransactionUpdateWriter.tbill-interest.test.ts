import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { grzTBills, transactions } from "@shared/schema";
import { beforeEach, expect, it, vi } from "vitest";
import { assertPrincipalCashDelete } from "../../services/grz/principalCashGuard";
import type { TransactionType } from "../../utils/withTransaction";
import { writeTransactionUpdate } from "../TransactionUpdateWriter";

vi.mock("../../db", () => ({ db: {} }));
vi.mock("../../services/goal/GoalLinkSourceSync", () => ({ reapplyEditedSourceLinks: async () => {} }));
vi.mock("../TransactionSplitUpdate", () => ({ applyTransactionSplitUpdate: async () => ({ beforeSplits: [], afterSplits: [], changed: false }) }));

const householdId = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const accountId = "33333333-3333-4333-8333-333333333333";
const before = { id, householdId, accountId, type: "income" as const, currency: "ZMW", amount: "1700.00", date: "2026-01-05", updatedAt: new Date(0) };
const findConfirmation = vi.fn();
const write = vi.fn((data: object) => ({ where: () => ({ returning: async () => [{ ...before, ...data }] }) }));
const tx = {
  select: () => ({ from: (table: unknown) => ({ where: (condition: SQL) => {
    if (table === grzTBills) return { limit: () => findConfirmation(new PgDialect().sqlToQuery(condition)) };
    if (table !== transactions) throw new Error("Unexpected table");
    return { limit: async () => [{ type: "income", group: null }], orderBy: () => ({ for: async () => [before] }) };
  } }) }),
  update: () => ({ set: write }),
} as unknown as TransactionType;
const dependencies = { callerOwnsTransaction: false, lockAccounts: vi.fn(), assertDelta: vi.fn(), accountsToSyncAfterCommit: new Set<string>() };

beforeEach(() => { vi.clearAllMocks(); findConfirmation.mockResolvedValue([{ id: "confirmed-bill" }]); });

it("refuses an economic edit of the confirmed interest before updating the transaction", async () => {
  await expect(writeTransactionUpdate(tx, id, householdId, { date: "2026-01-06" }, undefined, dependencies))
    .rejects.toMatchObject({ statusCode: 409, message: "Confirmed T-bill interest is locked" });
  expect(write).not.toHaveBeenCalled();
  expect(findConfirmation).toHaveBeenCalledWith(expect.objectContaining({ params: [householdId, id] }));
  expect(findConfirmation.mock.calls[0][0].sql).toContain('"grz_tbills"."settlement_operation_id" is not null');
});

it("keeps ordinary income editable when no confirmed T-bill owns it", async () => {
  findConfirmation.mockResolvedValue([]);
  await expect(writeTransactionUpdate(tx, id, householdId, { date: "2026-01-06" }, undefined, dependencies))
    .resolves.toMatchObject({ transaction: { date: "2026-01-06" } });
  expect(write).toHaveBeenCalledOnce();
});

it("keeps review notes editable without probing the confirmed financial terms", async () => {
  await expect(writeTransactionUpdate(tx, id, householdId, { notes: "Reviewed" }, undefined, dependencies))
    .resolves.toMatchObject({ transaction: { notes: "Reviewed" } });
  expect(findConfirmation).not.toHaveBeenCalled();
});

it("refuses a confirmed income deletion even when an overwrite also contains ordinary rows", async () => {
  const ordinaryId = "44444444-4444-4444-8444-444444444444";
  const expenseId = "55555555-5555-4555-8555-555555555555";
  await expect(assertPrincipalCashDelete(tx, householdId, [before, { id: ordinaryId, type: "income" }, { id: expenseId, type: "expense" }]))
    .rejects.toMatchObject({ statusCode: 409, message: "Confirmed T-bill interest is locked" });
  expect(findConfirmation).toHaveBeenCalledOnce();
  expect(findConfirmation).toHaveBeenCalledWith(expect.objectContaining({ params: [householdId, id, ordinaryId] }));
});

it("still accepts deletion of unrelated income and refuses deletion of principal cash", async () => {
  findConfirmation.mockResolvedValue([]);
  await expect(assertPrincipalCashDelete(tx, householdId, [before])).resolves.toBeUndefined();
  await expect(assertPrincipalCashDelete(tx, householdId, [{ id, type: "asset_settlement" }]))
    .rejects.toMatchObject({ statusCode: 409, message: "Principal settlement cash requires a settlement adjustment" });
  expect(findConfirmation).toHaveBeenCalledOnce();
});
