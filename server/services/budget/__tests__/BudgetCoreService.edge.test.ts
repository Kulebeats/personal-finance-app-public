import { describe, it, expect, vi, beforeEach } from "vitest";
import { Money } from "../../../core/money";
import type { Budget } from "@shared/schema";

// Mock all external dependencies before importing service
// The rollover month reads the household zone; these mocked households are legacy (UTC).
vi.mock("../../householdCalendarToday", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../householdCalendarToday")>()),
  householdCalendarZone: vi.fn(async () => "UTC"),
}));
// createBudget writes the budget and its audit row in one transaction (A-23).
vi.mock("../../../utils/withTransaction", () => ({ withTransaction: (fn: (tx: object) => unknown) => fn({}) }));
vi.mock("../../../services/BusinessAuditService", () => ({ businessAuditService: { logCreate: vi.fn(async () => {}) } }));
vi.mock("../../../repositories/BudgetRepository", () => ({
  budgetRepository: {
    create: vi.fn(),
    upsertPeriodWithLock: vi.fn(),
    persistBudgetPeriodRollovers: vi.fn(),
  },
}));

vi.mock("../../../repositories/BudgetQueryRepository", () => ({
  budgetQueryRepository: {
    getBudgetsWithProgress: vi.fn(),
    getProgressProjection: vi.fn(),
  },
}));

vi.mock("../../../repositories/HouseholdRepository", () => ({
  householdRepository: {
    findPreferences: vi.fn(),
    findById: vi.fn(),
  },
}));

vi.mock("../../../repositories/CategoryRepository", () => ({
  categoryRepository: {
    findByIdAndHousehold: vi.fn(),
  },
}));

vi.mock("../../../repositories/CategoryGroupRepository", () => ({
  categoryGroupRepository: {
    findByIdAndHousehold: vi.fn(),
  },
}));

vi.mock("../../../core/events", () => ({
  EventTypes: {
    BUDGET_CREATED: "budget.created",
    BUDGET_UPDATED: "budget.updated",
  },
  outboxEventService: {
    add: vi.fn(),
    // publish returns a Promise so .catch() can be called
    publish: vi.fn().mockReturnValue(Promise.resolve()),
  },
}));

import { BudgetCoreService } from "../BudgetCoreService";
import { budgetRepository } from "../../../repositories/BudgetRepository";
import { budgetQueryRepository } from "../../../repositories/BudgetQueryRepository";
import { householdRepository } from "../../../repositories/HouseholdRepository";

describe("BudgetCoreService Edge Cases", () => {
  let service: BudgetCoreService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new BudgetCoreService();
  });

  describe("Rollover Calculations", () => {
    it("forwards a system read context without mixing separately fetched preferences", async () => {
      // Setup mocks
      vi.mocked(householdRepository.findPreferences).mockResolvedValue({
        rolloverPercentage: 0,
        autoRolloverBudget: true,
      } as any);

      vi.mocked(householdRepository.findById).mockResolvedValue({
        id: "house-1",
        currency: "ZMW",
      } as any);

      vi.mocked(budgetQueryRepository.getBudgetsWithProgress).mockResolvedValue([
        {
          id: "budget-1",
          name: "Groceries",
          amount: "1000",
          spent: Money.from(800, "ZMW"),
          remaining: Money.from(200, "ZMW"),
          percentUsed: 80,
          rolloverIn: Money.zero("ZMW"),
          rolloverEnabled: true,
        },
      ] as any);

      await service.getBudgetProgress("house-1", 2024, 2, { kind: "system", purpose: "rollover-service-regression" });

      expect(budgetQueryRepository.getBudgetsWithProgress).toHaveBeenCalledWith(
        "house-1",
        2024,
        2,
        expect.objectContaining({
          context: { kind: "system", purpose: "rollover-service-regression" },
        }),
      );
      expect(householdRepository.findPreferences).not.toHaveBeenCalled();
    });

    it("should handle negative previous balance (overspending)", async () => {
      vi.mocked(householdRepository.findPreferences).mockResolvedValue({
        rolloverPercentage: 100,
        autoRolloverBudget: true,
      } as any);

      vi.mocked(householdRepository.findById).mockResolvedValue({
        id: "house-1",
        currency: "ZMW",
      } as any);

      vi.mocked(budgetQueryRepository.getProgressProjection).mockResolvedValue({ progress: [
        {
          id: "b1",
          rolloverIn: Money.from(-100, "ZMW"), // Negative = overspent
          amount: "1000",
        },
      ], preferences: { autoRolloverBudget: true, rolloverPercentage: 100, warningThreshold: 75, alertThreshold: 90 } } as unknown as Awaited<ReturnType<typeof budgetQueryRepository.getProgressProjection>>);

      vi.mocked(
        budgetRepository.persistBudgetPeriodRollovers,
      ).mockResolvedValue({
        created: 1,
        updated: 0,
      } as any);

      // processBudgetRollover takes Date, not year/month
      await service.processBudgetRollover("house-1", new Date(2024, 1, 15));

      expect(budgetQueryRepository.getProgressProjection).toHaveBeenCalled();
    });
  });

  describe("Overflow Handling", () => {
    const actor = { userId: "user-1" };
    it("accepts a captured positive amount at the persisted decimal upper bound", async () => {
      const budgetData = { name: "Big Budget", amount: "9999999999999.99", currency: "USD", period: "monthly" };
      const stored: Budget = { ...budgetData, id: "new-budget", householdId: "house-1", categoryId: null, categoryGroupId: null,
        rolloverEnabled: false, rolloverAmount: "0.00", warningThreshold: 80, alertThreshold: 100, isActive: true, isFlexBucket: false,
        createdAt: new Date("2026-11-02T00:00:00Z"), updatedAt: new Date("2026-11-02T00:00:00Z") };
      vi.mocked(budgetRepository.create).mockResolvedValue(stored);
      expect(await service.createBudget(budgetData, "house-1", actor)).toBe(stored);
      expect(budgetRepository.create).toHaveBeenCalledWith(expect.objectContaining({ amount: "9999999999999.99", currency: "USD" }), {});
    });
    it("refuses a monetary assertion without captured denomination instead of inheriting a database default", async () => {
      await expect(service.createBudget({ name: "Unproven budget", amount: "500.00", period: "monthly" }, "house-1", actor))
        .rejects.toMatchObject({ message: "A captured budget currency is required" });
      expect(budgetRepository.create).not.toHaveBeenCalled();
    });
    it("refuses a captured amount outside the persisted decimal range before writing", async () => {
      await expect(service.createBudget({ name: "Overflow budget", amount: "999999999999999", currency: "USD", period: "monthly" }, "house-1", actor))
        .rejects.toMatchObject({ message: "Budget amount exceeds supported range" });
      expect(budgetRepository.create).not.toHaveBeenCalled();
    });
  });

  describe("Concurrency & Optimistic Locking", () => {
    it("should attempt period update when processing rollover", async () => {
      vi.mocked(householdRepository.findPreferences).mockResolvedValue({
        autoRolloverBudget: true,
      } as any);

      vi.mocked(householdRepository.findById).mockResolvedValue({
        id: "house-1",
        currency: "ZMW",
      } as any);

      vi.mocked(budgetQueryRepository.getProgressProjection).mockResolvedValue({ progress: [
        {
          id: "b1",
          rolloverIn: Money.from(100, "ZMW"),
          amount: "1000",
        },
      ], preferences: { autoRolloverBudget: true, rolloverPercentage: 100, warningThreshold: 75, alertThreshold: 90 } } as unknown as Awaited<ReturnType<typeof budgetQueryRepository.getProgressProjection>>);

      vi.mocked(
        budgetRepository.persistBudgetPeriodRollovers,
      ).mockResolvedValue({
        created: 1,
        updated: 0,
      } as any);

      // processBudgetRollover takes Date, not year/month
      await service.processBudgetRollover("house-1", new Date(2024, 1, 15));

      expect(budgetRepository.persistBudgetPeriodRollovers).toHaveBeenCalled();
    });
  });
});
