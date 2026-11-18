import { describe, it, expect, vi, beforeEach } from "vitest";
import { Money } from "../../../core/money";

// Mock all external dependencies before importing service
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
    it("should handle 0% rollover correctly", async () => {
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

      await service.getBudgetProgress("house-1", 2024, 2);

      expect(budgetQueryRepository.getBudgetsWithProgress).toHaveBeenCalledWith(
        "house-1",
        2024,
        2,
        expect.objectContaining({
          rolloverPercentage: 0,
        }),
      );
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

      vi.mocked(budgetQueryRepository.getBudgetsWithProgress).mockResolvedValue([
        {
          id: "b1",
          rolloverIn: Money.from(-100, "ZMW"), // Negative = overspent
          amount: "1000",
        },
      ] as any);

      vi.mocked(
        budgetRepository.persistBudgetPeriodRollovers,
      ).mockResolvedValue({
        created: 1,
        updated: 0,
      } as any);

      // processBudgetRollover takes Date, not year/month
      await service.processBudgetRollover("house-1", new Date(2024, 1, 15));

      expect(budgetQueryRepository.getBudgetsWithProgress).toHaveBeenCalled();
    });
  });

  describe("Overflow Handling", () => {
    it("should handle extremely large budget amounts safely", async () => {
      const budgetData = {
        name: "Big Budget",
        amount: "999999999999999",
        period: "monthly",
      };

      vi.mocked(budgetRepository.create).mockResolvedValue({
        ...budgetData,
        id: "new-budget",
        householdId: "house-1",
      } as any);

      await service.createBudget(budgetData as any, "house-1");

      expect(budgetRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: "999999999999999",
        }),
      );
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

      vi.mocked(budgetQueryRepository.getBudgetsWithProgress).mockResolvedValue([
        {
          id: "b1",
          rolloverIn: Money.from(100, "ZMW"),
          amount: "1000",
        },
      ] as any);

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
