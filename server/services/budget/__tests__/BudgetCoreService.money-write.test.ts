import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Budget } from "@shared/schema";

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), findById: vi.fn() }));
// createBudget writes the budget and its audit row in one transaction (A-23).
vi.mock("../../../utils/withTransaction", () => ({ withTransaction: (fn: (tx: object) => unknown) => fn({}) }));
vi.mock("../../../repositories/AccountCreationGrant", () => ({ lockAccountHousehold: vi.fn(async () => {}) }));
vi.mock("../../../services/BusinessAuditService", () => ({ businessAuditService: { logCreate: vi.fn(async () => {}) } }));
vi.mock("../../../repositories/BudgetRepository", () => ({ budgetRepository: mocks }));
vi.mock("../../../core/events", () => ({ EventTypes: { BUDGET_CREATED: "budget.created", BUDGET_UPDATED: "budget.updated" }, outboxEventService: { publish: vi.fn(async () => {}) } }));
import { BudgetCoreService } from "../BudgetCoreService";

const row: Budget = { id: "budget", householdId: "household", name: "Captured USD", amount: "500.00", currency: "USD", period: "monthly",
  categoryId: null, categoryGroupId: null, rolloverAmount: "0.00", rolloverEnabled: false, isActive: true, isFlexBucket: false,
  warningThreshold: 80, alertThreshold: 100, createdAt: new Date("2026-11-02T00:00:00Z"), updatedAt: new Date("2026-11-02T00:00:00Z") };
const service = new BudgetCoreService();
beforeEach(() => { vi.clearAllMocks(); mocks.findById.mockResolvedValue(row); mocks.create.mockResolvedValue(row); mocks.update.mockResolvedValue(row); });
function write(operation: "create" | "update", field: "amount" | "rolloverAmount", amount: string) {
  return operation === "create" ? service.createBudget({ name: "Captured USD", amount: field === "amount" ? amount : "500.00",
    rolloverAmount: field === "rolloverAmount" ? amount : undefined, currency: "USD", period: "monthly" }, "household", { userId: "user" })
    : service.updateBudget("budget", field === "amount" ? { amount, currency: "USD" } : { rolloverAmount: amount, currency: "USD" }, "household");
}
describe("every supported direct budget money write preserves exact cents and denomination", () => {
  for (const operation of ["create", "update"] as const) for (const field of ["amount", "rolloverAmount"] as const) {
    it.each(["0.001", "-0.001", "NaN", "Infinity", "999999999999999"])(`${operation} rejects ${field}=%s before persistence`, async amount => {
      await expect(write(operation, field, amount)).rejects.toMatchObject({ name: "ValidationError" });
      expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
    });
  }
  for (const operation of ["create", "update"] as const) {
    it.each(["0.00", "-1.00"])(`${operation} requires a positive recurring default %s`, async amount => {
      await expect(write(operation, "amount", amount)).rejects.toMatchObject({ name: "ValidationError" });
      expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
    });
    it.each(["0.00", "-10.01", "9999999999999.99"])(`${operation} preserves legitimate signed rollover %s in USD`, async amount => {
      await write(operation, "rolloverAmount", amount);
      const persistence = operation === "create" ? mocks.create : mocks.update;
      expect(persistence).toHaveBeenCalled();
      expect(persistence.mock.calls[0][operation === "create" ? 0 : 2]).toMatchObject({ rolloverAmount: amount, currency: "USD" });
    });
  }
});
