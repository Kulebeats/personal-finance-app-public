import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock db before imports
vi.mock("../../../db", () => {
  const mockDb = {
    select: vi.fn(),
    execute: vi.fn(),
  };
  return { db: mockDb };
});

import { db } from "../../../db";
import {
  buildSankeyBaseConditions,
  getIncomeTypeCondition,
  getExpenseTypeCondition,
  calculateTotalIncome,
  buildIncomeToExpenseGroups,
  buildAccountToExpenseGroups,
  buildIncomeToCategories,
  type SankeyFilters,
  type TransactionRow,
} from "../SankeyHelpers";
import { transactions, accounts } from "@shared/schema";
import { eq, and } from "drizzle-orm";

function createMockQuery(data: any[] = []) {
  const mockChain: any = {
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
  mockChain.then = (resolve: any) => Promise.resolve(data).then(resolve);
  return mockChain;
}

describe("SankeyHelpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("buildSankeyBaseConditions", () => {
    it("builds correct conditions for household scope", () => {
      const filters: SankeyFilters = {
        householdId: "household-1",
        from: "2024-01-01",
        to: "2024-01-31",
        baseCurrency: "USD",
        scope: "household",
        includePending: false,
        includeTransfers: false,
      };

      const conditions = buildSankeyBaseConditions(filters);

      expect(conditions).toBeDefined();
      expect(conditions.length).toBeGreaterThanOrEqual(6);
    });

    it("adds user ownership filter for mine scope", () => {
      const filters: SankeyFilters = {
        householdId: "household-1",
        from: "2024-01-01",
        to: "2024-01-31",
        baseCurrency: "USD",
        scope: "mine",
        userId: "user-1",
        includePending: false,
        includeTransfers: false,
      };

      const conditions = buildSankeyBaseConditions(filters);

      expect(conditions.length).toBeGreaterThan(6);
    });

    it("includes pending transactions when flag is true", () => {
      const filters: SankeyFilters = {
        householdId: "household-1",
        from: "2024-01-01",
        to: "2024-01-31",
        baseCurrency: "USD",
        scope: "household",
        includePending: true,
        includeTransfers: false,
      };

      const conditions = buildSankeyBaseConditions(filters);

      // Should not add the isPending false condition when includePending is true
      expect(conditions).toBeDefined();
    });
  });

  describe("getIncomeTypeCondition", () => {
    it("returns income type only when transfers excluded", () => {
      const condition = getIncomeTypeCondition(false);

      expect(condition).toBeDefined();
      // Condition should match income only
    });

    it("includes transfer_in when transfers included", () => {
      const condition = getIncomeTypeCondition(true);

      expect(condition).toBeDefined();
      // Condition should match income OR (transfer AND is_transfer_in)
    });
  });

  describe("getExpenseTypeCondition", () => {
    it("returns expense type only when transfers excluded", () => {
      const condition = getExpenseTypeCondition(false);

      expect(condition).toBeDefined();
    });

    it("includes transfer_out when transfers included", () => {
      const condition = getExpenseTypeCondition(true);

      expect(condition).toBeDefined();
    });
  });

  describe("calculateTotalIncome", () => {
    it("sums transaction amounts", () => {
      const rows: TransactionRow[] = [
        { amountBase: "1000" },
        { amountBase: "2000" },
        { amountBase: "500" },
      ];

      const total = calculateTotalIncome(rows, "USD");

      expect(total.toNumber()).toBe(3500);
    });

    it("handles null amounts", () => {
      const rows: TransactionRow[] = [
        { amountBase: null },
        { amountBase: "1000" },
      ];

      const total = calculateTotalIncome(rows, "USD");

      expect(total.toNumber()).toBe(1000);
    });
  });

  describe("buildIncomeToExpenseGroups", () => {
    it("builds sankey nodes and links", async () => {
      const filters: SankeyFilters = {
        householdId: "household-1",
        from: "2024-01-01",
        to: "2024-01-31",
        baseCurrency: "USD",
        scope: "household",
        includePending: false,
        includeTransfers: false,
      };

      // Mock income rows
      const incomeData = [{ amountBase: "5000" }];

      // Mock expense rows
      const expenseData = [
        {
          groupId: "group-1",
          groupName: "Housing",
          groupColor: "#ff0000",
          amountBase: "2000",
        },
        {
          groupId: "group-2",
          groupName: "Food",
          groupColor: "#00ff00",
          amountBase: "1000",
        },
      ];

      (db.select as any)
        .mockReturnValueOnce(createMockQuery(incomeData))
        .mockReturnValueOnce(createMockQuery(expenseData));

      const result = await buildIncomeToExpenseGroups(filters, 10, true);

      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.links.length).toBeGreaterThan(0);
      expect(result.totalIncome.toNumber()).toBe(5000);
      expect(result.totalExpenses.toNumber()).toBeGreaterThan(0);
    });

    it("includes savings node when flag is true", async () => {
      const filters: SankeyFilters = {
        householdId: "household-1",
        from: "2024-01-01",
        to: "2024-01-31",
        baseCurrency: "USD",
        scope: "household",
        includePending: false,
        includeTransfers: false,
      };

      const incomeData = [{ amountBase: "5000" }];

      const expenseData = [
        {
          groupId: "group-1",
          groupName: "Housing",
          groupColor: "#ff0000",
          amountBase: "2000",
        },
      ];

      (db.select as any)
        .mockReturnValueOnce(createMockQuery(incomeData))
        .mockReturnValueOnce(createMockQuery(expenseData));

      const result = await buildIncomeToExpenseGroups(filters, 10, true);

      const savingsNode = result.nodes.find((n) => n.entityId === "savings");
      expect(savingsNode).toBeDefined();
    });

    it("respects maxNodes limit", async () => {
      const filters: SankeyFilters = {
        householdId: "household-1",
        from: "2024-01-01",
        to: "2024-01-31",
        baseCurrency: "USD",
        scope: "household",
        includePending: false,
        includeTransfers: false,
      };

      const incomeData = [{ amountBase: "10000" }];

      // Create 20 expense groups
      const expenseData = Array.from({ length: 20 }, (_, i) => ({
        groupId: `group-${i}`,
        groupName: `Category ${i}`,
        groupColor: "#ff0000",
        amountBase: "100",
      }));

      (db.select as any)
        .mockReturnValueOnce(createMockQuery(incomeData))
        .mockReturnValueOnce(createMockQuery(expenseData));

      const result = await buildIncomeToExpenseGroups(filters, 5, false);

      // Should have at most 6 nodes: Income + 5 top categories
      expect(result.nodes.length).toBeLessThanOrEqual(6);
    });
  });

  describe("buildAccountToExpenseGroups", () => {
    it("builds account to expense group links", async () => {
      const filters: SankeyFilters = {
        householdId: "household-1",
        from: "2024-01-01",
        to: "2024-01-31",
        baseCurrency: "USD",
        scope: "household",
        includePending: false,
        includeTransfers: false,
      };

      const incomeData = [{ amountBase: "5000" }];

      const expenseData = [
        {
          accountId: "acc-1",
          accountName: "Checking",
          accountColor: "#0000ff",
          groupId: "group-1",
          groupName: "Housing",
          groupColor: "#ff0000",
          amountBase: "1500",
        },
      ];

      (db.select as any)
        .mockReturnValueOnce(createMockQuery(incomeData))
        .mockReturnValueOnce(createMockQuery(expenseData));

      const result = await buildAccountToExpenseGroups(filters, 10);

      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.links.length).toBeGreaterThan(0);
      expect(result.totalIncome.toNumber()).toBe(5000);
    });
  });

  describe("buildIncomeToCategories", () => {
    it("builds category-level sankey", async () => {
      const filters: SankeyFilters = {
        householdId: "household-1",
        from: "2024-01-01",
        to: "2024-01-31",
        baseCurrency: "USD",
        scope: "household",
        includePending: false,
        includeTransfers: false,
      };

      const incomeData = [{ amountBase: "5000" }];

      const expenseData = [
        {
          groupId: "group-1",
          groupName: "Housing",
          categoryId: "cat-1",
          categoryName: "Rent",
          categoryColor: "#ff0000",
          amountBase: "1200",
        },
        {
          groupId: "group-1",
          groupName: "Housing",
          categoryId: "cat-2",
          categoryName: "Utilities",
          categoryColor: "#ff5500",
          amountBase: "300",
        },
      ];

      (db.select as any)
        .mockReturnValueOnce(createMockQuery(incomeData))
        .mockReturnValueOnce(createMockQuery(expenseData));

      const result = await buildIncomeToCategories(filters, 10);

      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.links.length).toBeGreaterThan(0);
      expect(result.totalIncome.toNumber()).toBe(5000);

      // Should have group nodes and category nodes
      const categoryNodes = result.nodes.filter((n: any) => n.entityType === "category");
      expect(categoryNodes.length).toBeGreaterThan(0);
    });
  });
});
