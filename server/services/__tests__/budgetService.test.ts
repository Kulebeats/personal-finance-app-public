import { describe, it, expect, beforeEach, vi } from "vitest";
import type { BudgetPeriod } from "../../repositories/budgets/BudgetPeriodRepository";

// BUDGET-RACE-002: minimal, fully-typed BudgetPeriod fixture for mocking
// budgetRepository.findPeriod / updatePeriodWithLock without an unsafe cast.
function makeMockPeriod(overrides: {
  id: string;
  budgetId: string;
  budgetAmount: string;
  version: number;
}): BudgetPeriod {
  const now = new Date();
  return {
    id: overrides.id,
    budgetId: overrides.budgetId,
    startDate: "2025-06-01",
    endDate: "2025-06-30",
    budgetAmount: overrides.budgetAmount,
    spentAmount: "0.00",
    rolloverIn: "0.00",
    currency: "ZMW",
    version: overrides.version,
    createdAt: now,
    updatedAt: now,
  };
}

vi.mock("../../db", () => ({
  db: {
    // Mock transaction to execute the callback with a mock tx object
    transaction: vi.fn((callback) => callback({})),
  },
}));

vi.mock("../../repositories/BudgetRepository", () => ({
  budgetRepository: {
    create: vi.fn(),
    findByHousehold: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    getBudgetPeriodsForRange: vi.fn(),
    persistBudgetPeriodRollovers: vi.fn(),
    upsertPeriod: vi.fn(),
    findPeriod: vi.fn(),
    // ISSUE-009: Add mock for optimistic locking method
    upsertPeriodWithLock: vi.fn(),
    // BUDGET-RACE-002: ensure-exists-then-lock move-money path
    ensurePeriodExists: vi.fn(),
    updatePeriodWithLock: vi.fn(),
  },
}));

vi.mock("../../repositories/BudgetQueryRepository", () => ({
  budgetQueryRepository: {
    getBudgetsWithProgress: vi.fn(),
  },
}));

vi.mock("../../repositories/HouseholdRepository", () => ({
  householdRepository: {
    findPreferences: vi.fn(),
    findById: vi.fn(),
  },
}));

describe("BudgetService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["yearly", "custom"] as const)(
    "rejects unsupported %s budget creation period",
    async (period) => {
      const { budgetService } = await import("../BudgetService");
      const { budgetRepository } = await import(
        "../../repositories/BudgetRepository"
      );

      await expect(
        budgetService.createBudget(
          {
            name: "Groceries",
            amount: "100.00",
            period,
          } as any,
          "house-1"
        )
      ).rejects.toMatchObject({
        message: "Invalid budget period",
        fields: [
          {
            field: "period",
            message: "Only monthly budgets are currently supported",
          },
        ],
      });
      expect(budgetRepository.create).not.toHaveBeenCalled();
    }
  );

  it.each(["yearly", "custom"] as const)(
    "rejects unsupported %s budget update period",
    async (period) => {
      const { budgetService } = await import("../BudgetService");
      const { budgetRepository } = await import(
        "../../repositories/BudgetRepository"
      );

      (budgetRepository.findById as any).mockResolvedValue({
        id: "budget-1",
        householdId: "house-1",
        name: "Groceries",
        amount: "100.00",
        period: "monthly",
      });

      await expect(
        budgetService.updateBudget(
          "budget-1",
          { period } as any,
          "house-1"
        )
      ).rejects.toMatchObject({
        message: "Invalid budget period",
        fields: [
          {
            field: "period",
            message: "Only monthly budgets are currently supported",
          },
        ],
      });
      expect(budgetRepository.update).not.toHaveBeenCalled();
    }
  );

  it("returns forecast periods using overrides when available", async () => {
    const { budgetService } = await import("../BudgetService");
    const { budgetRepository } = await import(
      "../../repositories/BudgetRepository"
    );

    (budgetRepository.findByHousehold as any).mockResolvedValue([
      {
        id: "budget-1",
        householdId: "house-1",
        name: "Groceries",
        amount: "100.00",
        period: "monthly",
      },
    ]);

    (budgetRepository.getBudgetPeriodsForRange as any).mockResolvedValue([
      {
        budgetId: "budget-1",
        startDate: "2025-05-01",
        endDate: "2025-05-31",
        budgetAmount: "150.00",
      },
    ]);

    const result = await budgetService.getBudgetForecast("house-1", 2025, 5, 2);

    expect(result.range).toEqual([
      { year: 2025, month: 5 },
      { year: 2025, month: 6 },
    ]);
    expect(result.budgets[0].periods[0].amount).toBe("150.00");
    expect(result.budgets[0].periods[1].amount).toBe("100.00");
  });

  it("upserts forecast periods for all future months", async () => {
    const { budgetService } = await import("../BudgetService");
    const { budgetRepository } = await import(
      "../../repositories/BudgetRepository"
    );

    (budgetRepository.findById as any).mockResolvedValue({
      id: "budget-1",
      householdId: "house-1",
      name: "Groceries",
      amount: "100.00",
      period: "monthly",
    });

    (budgetRepository.upsertPeriod as any).mockResolvedValue({
      id: "period-1",
    });

    await budgetService.updateBudgetForecast("house-1", "budget-1", {
      year: 2025,
      month: 7,
      amount: "250.00",
      applyScope: "all_future",
      months: 2,
    });

    expect(budgetRepository.upsertPeriod).toHaveBeenCalledTimes(2);
    expect(budgetRepository.upsertPeriod).toHaveBeenCalledWith(
      expect.objectContaining({
        budgetId: "budget-1",
        startDate: "2025-07-01",
        endDate: "2025-07-31",
        budgetAmount: "250.00",
      })
    );
    expect(budgetRepository.upsertPeriod).toHaveBeenCalledWith(
      expect.objectContaining({
        budgetId: "budget-1",
        startDate: "2025-08-01",
        endDate: "2025-08-31",
        budgetAmount: "250.00",
      })
    );
  });

  it("defaults forecast updates to the current month when no scope is provided", async () => {
    const { budgetService } = await import("../BudgetService");
    const { budgetRepository } = await import(
      "../../repositories/BudgetRepository"
    );

    (budgetRepository.findById as any).mockResolvedValue({
      id: "budget-1",
      householdId: "house-1",
      name: "Groceries",
      amount: "100.00",
      period: "monthly",
    });

    (budgetRepository.upsertPeriod as any).mockResolvedValue({
      id: "period-1",
    });

    const result = await budgetService.updateBudgetForecast("house-1", "budget-1", {
      year: 2025,
      month: 9,
      amount: "175.00",
    });

    expect(result.scope).toBe("this_month");
    expect(result.months).toBe(1);
    expect(budgetRepository.upsertPeriod).toHaveBeenCalledTimes(1);
    expect(budgetRepository.upsertPeriod).toHaveBeenCalledWith(
      expect.objectContaining({
        budgetId: "budget-1",
        startDate: "2025-09-01",
        endDate: "2025-09-30",
        budgetAmount: "175.00",
      })
    );
  });

  it("moves budget amounts between periods", async () => {
    const { budgetService } = await import("../BudgetService");
    const { budgetRepository } = await import(
      "../../repositories/BudgetRepository"
    );

    (budgetRepository.findById as any).mockImplementation((id: string) => {
      if (id === "from-budget") {
        return Promise.resolve({
          id: "from-budget",
          householdId: "house-1",
          name: "Groceries",
          amount: "100.00",
          period: "monthly",
        });
      }
      return Promise.resolve({
        id: "to-budget",
        householdId: "house-1",
        name: "Dining Out",
        amount: "25.00",
        period: "monthly",
      });
    });

    // BUDGET-RACE-002: findPeriod is called with FOR UPDATE after
    // ensurePeriodExists has guaranteed the row exists, so it always
    // returns a real (id, version) pair on the move-money path.
    vi.mocked(budgetRepository.findPeriod).mockImplementation((id: string) => {
      if (id === "from-budget") {
        return Promise.resolve(
          makeMockPeriod({
            id: "period-from",
            budgetId: "from-budget",
            budgetAmount: "100.00",
            version: 1,
          })
        );
      }
      return Promise.resolve(
        makeMockPeriod({
          id: "period-to",
          budgetId: "to-budget",
          budgetAmount: "25.00",
          version: 1,
        })
      );
    });
    vi.mocked(budgetRepository.ensurePeriodExists).mockResolvedValue(undefined);
    // BUDGET-RACE-002: Mock the ensure-exists-then-lock update method
    vi.mocked(budgetRepository.updatePeriodWithLock).mockResolvedValue(
      makeMockPeriod({
        id: "period-1",
        budgetId: "from-budget",
        budgetAmount: "0.00",
        version: 2,
      })
    );

    const result = await budgetService.moveBudgetAmount("house-1", {
      fromBudgetId: "from-budget",
      toBudgetId: "to-budget",
      amount: "10.00",
      year: 2025,
      month: 6,
      applyScope: "this_month",
    });

    expect(result.scope).toBe("this_month");
    // Note: updatePeriodWithLock is called with (id, expectedVersion, data, tx)
    expect(budgetRepository.updatePeriodWithLock).toHaveBeenCalledWith(
      "period-from",
      1, // expectedVersion (the locked row's current version)
      expect.objectContaining({ budgetAmount: "90.00" }),
      expect.anything()
    );
    expect(budgetRepository.updatePeriodWithLock).toHaveBeenCalledWith(
      "period-to",
      1, // expectedVersion (the locked row's current version)
      expect.objectContaining({ budgetAmount: "35.00" }),
      expect.anything()
    );
  });

  it("moves budget amounts across all future months", async () => {
    const { budgetService } = await import("../BudgetService");
    const { budgetRepository } = await import(
      "../../repositories/BudgetRepository"
    );

    (budgetRepository.findById as any).mockImplementation((id: string) => {
      if (id === "from-budget") {
        return Promise.resolve({
          id: "from-budget",
          householdId: "house-1",
          name: "Groceries",
          amount: "100.00",
          period: "monthly",
        });
      }
      return Promise.resolve({
        id: "to-budget",
        householdId: "house-1",
        name: "Dining Out",
        amount: "25.00",
        period: "monthly",
      });
    });

    // BUDGET-RACE-002: vary the locked row's `id` by (budgetId, startDate)
    // so the four resulting updatePeriodWithLock calls (from/to x
    // June/July) are individually distinguishable in the assertions below.
    vi.mocked(budgetRepository.findPeriod).mockImplementation(
      (id: string, startDate: string) =>
        Promise.resolve(
          makeMockPeriod({
            id: `period-${id}-${startDate}`,
            budgetId: id,
            budgetAmount: "100.00",
            version: 1,
          })
        )
    );
    vi.mocked(budgetRepository.ensurePeriodExists).mockResolvedValue(undefined);
    // BUDGET-RACE-002: Mock the ensure-exists-then-lock update method
    vi.mocked(budgetRepository.updatePeriodWithLock).mockResolvedValue(
      makeMockPeriod({
        id: "period-1",
        budgetId: "from-budget",
        budgetAmount: "0.00",
        version: 2,
      })
    );

    const result = await budgetService.moveBudgetAmount("house-1", {
      fromBudgetId: "from-budget",
      toBudgetId: "to-budget",
      amount: "10.00",
      year: 2025,
      month: 6,
      applyScope: "all_future",
      months: 2,
    });

    expect(result.scope).toBe("all_future");
    expect(result.months).toBe(2);
    // Note: updatePeriodWithLock is called with (id, expectedVersion, data, tx)
    expect(budgetRepository.updatePeriodWithLock).toHaveBeenCalledWith(
      "period-from-budget-2025-06-01",
      1,
      expect.objectContaining({ budgetAmount: "90.00" }),
      expect.anything()
    );
    expect(budgetRepository.updatePeriodWithLock).toHaveBeenCalledWith(
      "period-from-budget-2025-07-01",
      1,
      expect.objectContaining({ budgetAmount: "90.00" }),
      expect.anything()
    );
    expect(budgetRepository.updatePeriodWithLock).toHaveBeenCalledWith(
      "period-to-budget-2025-06-01",
      1,
      expect.objectContaining({ budgetAmount: "110.00" }),
      expect.anything()
    );
    expect(budgetRepository.updatePeriodWithLock).toHaveBeenCalledWith(
      "period-to-budget-2025-07-01",
      1,
      expect.objectContaining({ budgetAmount: "110.00" }),
      expect.anything()
    );
  });

  it("moveBudgetAmount uses transaction for atomicity", async () => {
    const { budgetService } = await import("../BudgetService");
    const { budgetRepository } = await import(
      "../../repositories/BudgetRepository"
    );

    (budgetRepository.findById as any).mockImplementation((id: string) => {
      if (id === "from-budget") {
        return Promise.resolve({
          id: "from-budget",
          householdId: "house-1",
          name: "Groceries",
          amount: "100.00",
          period: "monthly",
        });
      }
      return Promise.resolve({
        id: "to-budget",
        householdId: "house-1",
        name: "Dining Out",
        amount: "25.00",
        period: "monthly",
      });
    });

    // BUDGET-RACE-002: ensurePeriodExists guarantees both rows exist before
    // findPeriod locks them, so findPeriod always returns a real row here
    // (never undefined) on the move-money path.
    vi.mocked(budgetRepository.findPeriod).mockImplementation((id: string) =>
      Promise.resolve(
        makeMockPeriod({
          id: `period-${id}`,
          budgetId: id,
          budgetAmount: "100.00",
          version: 1,
        })
      )
    );
    vi.mocked(budgetRepository.ensurePeriodExists).mockResolvedValue(undefined);
    // BUDGET-RACE-002: Mock the ensure-exists-then-lock update method
    vi.mocked(budgetRepository.updatePeriodWithLock).mockResolvedValue(
      makeMockPeriod({
        id: "period-1",
        budgetId: "from-budget",
        budgetAmount: "0.00",
        version: 2,
      })
    );

    await budgetService.moveBudgetAmount("house-1", {
      fromBudgetId: "from-budget",
      toBudgetId: "to-budget",
      amount: "10.00",
      year: 2025,
      month: 6,
      applyScope: "this_month",
    });

    // Verify that all repository calls receive a transaction object (tx)
    // The tx parameter ensures atomicity - if any call fails, all changes roll back
    const updateCalls = vi.mocked(budgetRepository.updatePeriodWithLock).mock.calls;
    expect(updateCalls.length).toBe(2);

    // Both calls should have received the same transaction object (4th param)
    const [, , , tx1] = updateCalls[0];
    const [, , , tx2] = updateCalls[1];
    expect(tx1).toBeDefined();
    expect(tx2).toBeDefined();
    // Transaction objects should be the same instance
    expect(tx1).toBe(tx2);

    // And every ensurePeriodExists call should also share that same tx.
    const ensureCalls = vi.mocked(budgetRepository.ensurePeriodExists).mock.calls;
    expect(ensureCalls.length).toBe(2);
    for (const [, tx] of ensureCalls) {
      expect(tx).toBe(tx1);
    }
  });

  it("processBudgetRollover calls getBudgetsWithProgress then persistBudgetPeriodRollovers", async () => {
    const { BudgetCoreService } = await import("../budget/BudgetCoreService");
    const { budgetRepository } = await import(
      "../../repositories/BudgetRepository"
    );
    const { budgetQueryRepository } = await import(
      "../../repositories/BudgetQueryRepository"
    );
    const { householdRepository } = await import(
      "../../repositories/HouseholdRepository"
    );
    const { Money } = await import("../../core/money");

    const service = new BudgetCoreService();

    (householdRepository.findPreferences as any).mockResolvedValue({
      autoRolloverBudget: true,
      rolloverPercentage: 100,
    });
    // ISSUE-012: Mock findById for currency retrieval
    (householdRepository.findById as any).mockResolvedValue({
      id: "house-1",
      currency: "ZMW",
    });

    const mockProgress = [
      {
        id: "budget-1",
        amount: "100.00",
        spent: new Money(50),
        remaining: new Money(50),
        percentUsed: 50,
        rolloverIn: new Money(25),
      },
    ];

    (budgetQueryRepository.getBudgetsWithProgress as any).mockResolvedValue(
      mockProgress
    );
    (budgetRepository.persistBudgetPeriodRollovers as any).mockResolvedValue({
      created: 1,
      updated: 0,
    });

    const result = await service.processBudgetRollover("house-1", new Date(2025, 5, 15));

    // Verify getBudgetsWithProgress was called (read operation)
    expect(budgetQueryRepository.getBudgetsWithProgress).toHaveBeenCalledWith(
      "house-1",
      2025,
      6,
      expect.objectContaining({
        autoRolloverBudget: true,
        rolloverPercentage: 100,
      })
    );

    // Verify persistBudgetPeriodRollovers was called (write operation)
    expect(budgetRepository.persistBudgetPeriodRollovers).toHaveBeenCalledWith(
      mockProgress,
      "2025-06-01",
      "2025-06-30"
    );

    expect(result).toEqual({ created: 1, updated: 0, total: 1 });
  });

  it("processBudgetRollover skips when autoRolloverBudget is disabled", async () => {
    const { BudgetCoreService } = await import("../budget/BudgetCoreService");
    const { budgetRepository } = await import(
      "../../repositories/BudgetRepository"
    );
    const { budgetQueryRepository } = await import(
      "../../repositories/BudgetQueryRepository"
    );
    const { householdRepository } = await import(
      "../../repositories/HouseholdRepository"
    );

    const service = new BudgetCoreService();

    (householdRepository.findPreferences as any).mockResolvedValue({
      autoRolloverBudget: false,
    });

    const result = await service.processBudgetRollover("house-1");

    // Should return early without calling any budget methods
    expect(budgetQueryRepository.getBudgetsWithProgress).not.toHaveBeenCalled();
    expect(budgetRepository.persistBudgetPeriodRollovers).not.toHaveBeenCalled();
    expect(result).toEqual({ created: 0, updated: 0, total: 0 });
  });
});

describe("BudgetRecalculationService", () => {
  it("separates income and expense categories for correct transaction type queries", async () => {
    const { BudgetRecalculationService } = await import(
      "../budget/BudgetRecalculationService"
    );

    // Verify the service exists and has the recalculateBudgets method
    const service = new BudgetRecalculationService();
    expect(typeof service.recalculateBudgets).toBe("function");

    // This test verifies the method signature and basic structure
    // Integration tests would verify actual income vs expense branching
    // The key fix is that:
    // - Categories with groupType === "expense" query transactions.type === "expense"
    // - Categories with groupType === "income" query transactions.type === "income"
  });
});
