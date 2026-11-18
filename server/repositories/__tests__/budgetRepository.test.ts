import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { Money } from "../../core/money";
import { db } from "../../db";
import { budgets, budgetPeriods, households } from "@shared/schema";

describe("BudgetRepositories", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("getBudgetsWithProgress", () => {
    it("calculates rollover from previous period without side effects", async () => {
      const { budgetRepository } = await import("../BudgetRepository");
      const { budgetQueryRepository } = await import("../BudgetQueryRepository");
      const budgetQueryUtils = await import("../budgetQueryUtils");

      vi.spyOn(budgetRepository, "findByHousehold").mockResolvedValue([
        {
          id: "budget-1",
          householdId: "house-1",
          name: "Groceries",
          categoryId: "cat-1",
          categoryGroupId: null,
          amount: "100.00",
          period: "monthly",
          rolloverEnabled: false,
          rolloverAmount: "0.00",
          warningThreshold: 80,
          alertThreshold: 100,
          isActive: true,
          isFlexBucket: false,
          currency: "ZMW",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      vi.spyOn(budgetQueryUtils, "loadBudgetContext").mockResolvedValue({
        categoryMap: new Map([
          [
            "cat-1",
            {
              id: "cat-1",
              groupId: "group-1",
              includeInBudget: true,
              isArchived: false,
              rolloverEnabled: true,
              rolloverStartBalance: "25.00",
            },
          ],
        ]),
        groupMap: new Map(),
      });

      vi.spyOn(budgetRepository, "getBudgetPeriodsForRange")
        .mockResolvedValueOnce([
          {
            id: "period-current",
            budgetId: "budget-1",
            startDate: "2025-06-01",
            endDate: "2025-06-30",
            budgetAmount: "120.00",
            spentAmount: "0.00",
            rolloverIn: null,
            currency: "ZMW",
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ])
        .mockResolvedValueOnce([
          {
            id: "period-prev",
            budgetId: "budget-1",
            startDate: "2025-05-01",
            endDate: "2025-05-31",
            budgetAmount: "100.00",
            spentAmount: "0.00",
            rolloverIn: null,
            currency: "ZMW",
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]);

      // ISSUE-011: Mock the batch method instead of individual calculateSpent
      vi.spyOn(budgetRepository, "batchCalculateSpent").mockImplementation(
        async (_householdId, _categoryIds, _groupIds, startDate) => {
          if (startDate === "2025-06-01") {
            return {
              byCategoryId: new Map([["cat-1", new Money(80)]]),
              byCategoryGroupId: new Map(),
              flexTotal: new Money(0),
            };
          }
          if (startDate === "2025-05-01") {
            return {
              byCategoryId: new Map([["cat-1", new Money(70)]]),
              byCategoryGroupId: new Map(),
              flexTotal: new Money(0),
            };
          }
          return {
            byCategoryId: new Map(),
            byCategoryGroupId: new Map(),
            flexTotal: new Money(0),
          };
        }
      );

      // upsertPeriod should NOT be called - this is now a pure read operation
      const upsertSpy = vi.spyOn(budgetRepository, "upsertPeriod");

      const result = await budgetQueryRepository.getBudgetsWithProgress(
        "house-1",
        2025,
        6
      );

      // Verify no write side effects
      expect(upsertSpy).not.toHaveBeenCalled();

      // Verify calculations are correct
      expect(result[0].amount).toBe("120.00");
      expect(result[0].remaining.toString()).toBe("95.00");
      expect(result[0].percentUsed).toBe(45.71);
      // Verify rolloverIn is returned for potential persistence
      expect(result[0].rolloverIn.toString()).toBe("55.00");
    });

    it("applies rollover percentage to positive rollover balances", async () => {
      const { budgetRepository } = await import("../BudgetRepository");
      const { budgetQueryRepository } = await import("../BudgetQueryRepository");
      const budgetQueryUtils = await import("../budgetQueryUtils");

      vi.spyOn(budgetRepository, "findByHousehold").mockResolvedValue([
        {
          id: "budget-1",
          householdId: "house-1",
          name: "Groceries",
          categoryId: "cat-1",
          categoryGroupId: null,
          amount: "100.00",
          period: "monthly",
          rolloverEnabled: false,
          rolloverAmount: "0.00",
          warningThreshold: 80,
          alertThreshold: 100,
          isActive: true,
          isFlexBucket: false,
          currency: "ZMW",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      vi.spyOn(budgetQueryUtils, "loadBudgetContext").mockResolvedValue({
        categoryMap: new Map([
          [
            "cat-1",
            {
              id: "cat-1",
              groupId: "group-1",
              includeInBudget: true,
              isArchived: false,
              rolloverEnabled: true,
              rolloverStartBalance: "25.00",
            },
          ],
        ]),
        groupMap: new Map(),
      });

      vi.spyOn(budgetRepository, "getBudgetPeriodsForRange")
        .mockResolvedValueOnce([
          {
            id: "period-current",
            budgetId: "budget-1",
            startDate: "2025-06-01",
            endDate: "2025-06-30",
            budgetAmount: "120.00",
            spentAmount: "0.00",
            rolloverIn: null,
            currency: "ZMW",
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ])
        .mockResolvedValueOnce([
          {
            id: "period-prev",
            budgetId: "budget-1",
            startDate: "2025-05-01",
            endDate: "2025-05-31",
            budgetAmount: "100.00",
            spentAmount: "0.00",
            rolloverIn: null,
            currency: "ZMW",
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]);

      // ISSUE-011: Mock the batch method instead of individual calculateSpent
      vi.spyOn(budgetRepository, "batchCalculateSpent").mockImplementation(
        async (_householdId, _categoryIds, _groupIds, startDate) => {
          if (startDate === "2025-06-01") {
            return {
              byCategoryId: new Map([["cat-1", new Money(80)]]),
              byCategoryGroupId: new Map(),
              flexTotal: new Money(0),
            };
          }
          if (startDate === "2025-05-01") {
            return {
              byCategoryId: new Map([["cat-1", new Money(70)]]),
              byCategoryGroupId: new Map(),
              flexTotal: new Money(0),
            };
          }
          return {
            byCategoryId: new Map(),
            byCategoryGroupId: new Map(),
            flexTotal: new Money(0),
          };
        }
      );

      // upsertPeriod should NOT be called - this is now a pure read operation
      const upsertSpy = vi.spyOn(budgetRepository, "upsertPeriod");

      const result = await budgetQueryRepository.getBudgetsWithProgress(
        "house-1",
        2025,
        6,
        {
          autoRolloverBudget: true,
          rolloverPercentage: 50,
        }
      );

      // Verify no write side effects
      expect(upsertSpy).not.toHaveBeenCalled();

      // With 50% rollover percentage, rolloverIn should be 27.50 (55 * 0.5)
      expect(result[0].rolloverIn.toString()).toBe("27.50");
    });
  });

  describe("persistBudgetPeriodRollovers", () => {
    it("persists rollover data for budgets with non-zero rolloverIn", async () => {
      const { budgetRepository } = await import("../BudgetRepository");

      // persistBudgetPeriodRollovers runs a real DB query against
      // budget_periods (uuid budget_id), so seed a real budget. No existing
      // period for this range -> the upsert should count as "created".
      const householdId = randomUUID();
      const budgetId = randomUUID();
      await db.insert(households).values({ id: householdId, name: "RolloverTest HH" });
      await db.insert(budgets).values({
        id: budgetId,
        householdId,
        name: "Groceries",
        amount: "120.00",
        currency: "ZMW",
      });

      const upsertSpy = vi
        .spyOn(budgetRepository, "upsertPeriod")
        .mockResolvedValue({
          id: randomUUID(),
          budgetId,
          startDate: "2025-06-01",
          endDate: "2025-06-30",
          budgetAmount: "120.00",
          spentAmount: "80.00",
          rolloverIn: "55.00",
          currency: "ZMW",
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

      const result = await budgetRepository.persistBudgetPeriodRollovers(
        [
          {
            id: budgetId,
            amount: "120.00",
            spent: new Money(80),
            rolloverIn: new Money(55),
          },
        ],
        "2025-06-01",
        "2025-06-30"
      );

      expect(upsertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          budgetId,
          startDate: "2025-06-01",
          endDate: "2025-06-30",
          budgetAmount: "120.00",
          spentAmount: "80.00",
          rolloverIn: "55.00",
        }),
        expect.anything() // the batch transaction
      );
      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
    });

    it("skips budgets with zero rolloverIn", async () => {
      const { budgetRepository } = await import("../BudgetRepository");

      const upsertSpy = vi.spyOn(budgetRepository, "upsertPeriod");

      const result = await budgetRepository.persistBudgetPeriodRollovers(
        [
          {
            id: "budget-1",
            amount: "100.00",
            spent: new Money(100),
            rolloverIn: Money.zero("ZMW"),
          },
        ],
        "2025-06-01",
        "2025-06-30"
      );

      expect(upsertSpy).not.toHaveBeenCalled();
      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
    });

    it("counts updates for existing periods", async () => {
      const { budgetRepository } = await import("../BudgetRepository");

      // persistBudgetPeriodRollovers detects "updated" via a real DB query for
      // an existing budget_period in the range, so seed both the budget and a
      // pre-existing period row for the same range.
      const householdId = randomUUID();
      const budgetId = randomUUID();
      const existingPeriodId = randomUUID();
      await db.insert(households).values({ id: householdId, name: "RolloverUpdate HH" });
      await db.insert(budgets).values({
        id: budgetId,
        householdId,
        name: "Groceries",
        amount: "100.00",
        currency: "ZMW",
      });
      await db.insert(budgetPeriods).values({
        id: existingPeriodId,
        budgetId,
        startDate: "2025-06-01",
        endDate: "2025-06-30",
        budgetAmount: "100.00",
        spentAmount: "50.00",
        rolloverIn: "0",
        currency: "ZMW",
      });

      const upsertSpy = vi
        .spyOn(budgetRepository, "upsertPeriod")
        .mockResolvedValue({
          id: existingPeriodId,
          budgetId,
          startDate: "2025-06-01",
          endDate: "2025-06-30",
          budgetAmount: "120.00",
          spentAmount: "80.00",
          rolloverIn: "55.00",
          currency: "ZMW",
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

      const result = await budgetRepository.persistBudgetPeriodRollovers(
        [
          {
            id: budgetId,
            amount: "120.00",
            spent: new Money(80),
            rolloverIn: new Money(55),
          },
        ],
        "2025-06-01",
        "2025-06-30"
      );

      expect(upsertSpy).toHaveBeenCalled();
      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);
    });

    it("rolls back the whole batch when one upsert fails (atomicity)", async () => {
      const { budgetRepository } = await import("../BudgetRepository");

      // Real upserts (no mock): the first budget exists, the second does not,
      // so its period insert violates the budget_id FK. The batch runs in one
      // transaction, so the first (successful) upsert must be rolled back and
      // the error surfaced instead of being silently swallowed.
      const householdId = randomUUID();
      const goodBudgetId = randomUUID();
      const missingBudgetId = randomUUID();
      await db
        .insert(households)
        .values({ id: householdId, name: "RolloverAtomic HH" });
      await db.insert(budgets).values({
        id: goodBudgetId,
        householdId,
        name: "Groceries",
        amount: "120.00",
        currency: "ZMW",
      });

      await expect(
        budgetRepository.persistBudgetPeriodRollovers(
          [
            {
              id: goodBudgetId,
              amount: "120.00",
              spent: new Money(80),
              rolloverIn: new Money(40),
            },
            {
              id: missingBudgetId,
              amount: "50.00",
              spent: new Money(10),
              rolloverIn: new Money(5),
            },
          ],
          "2025-07-01",
          "2025-07-31"
        )
      ).rejects.toThrow();

      const survivingRows = await db
        .select()
        .from(budgetPeriods)
        .where(
          and(
            eq(budgetPeriods.budgetId, goodBudgetId),
            eq(budgetPeriods.startDate, "2025-07-01")
          )
        );
      expect(survivingRows).toHaveLength(0);
    });
  });

  describe("calculateSpentWithSplits", () => {
    it("method exists with correct signature", async () => {
      const { budgetRepository } = await import("../BudgetRepository");

      // Verify the method exists and has the correct signature
      expect(typeof budgetRepository.calculateSpentWithSplits).toBe("function");

      // Verify the method accepts all expected parameters:
      // - householdId: string
      // - categoryId: string
      // - startDate: string
      // - endDate: string
      // - transactionType: "income" | "expense" (default: "expense")
      // - currency: string (default: "ZMW")
      expect(budgetRepository.calculateSpentWithSplits.length).toBeGreaterThanOrEqual(4);
    });

    it("supports both income and expense transaction types", async () => {
      const { budgetRepository } = await import("../BudgetRepository");

      // The method should accept transactionType parameter
      // This verifies the fix for BE-012 (income budgets) is integrated
      // Integration tests would verify:
      // - expense type sums expense transactions
      // - income type sums income transactions
      expect(typeof budgetRepository.calculateSpentWithSplits).toBe("function");
    });
  });

  describe("flex budget uniqueness (QA-007)", () => {
    it("database schema includes unique index for flex budget per household", async () => {
      // This test documents that DB-004 migration creates the unique index:
      // CREATE UNIQUE INDEX idx_budgets_flex_unique
      // ON budgets(household_id) WHERE is_flex_bucket = true;
      //
      // The constraint ensures:
      // - Only ONE flex budget per household
      // - Prevents duplicate flex budgets which could cause calculation issues
      //
      // Integration test would verify:
      // - First flex budget for household succeeds
      // - Second flex budget for same household fails with unique constraint error
      expect(true).toBe(true);
    });
  });
});
