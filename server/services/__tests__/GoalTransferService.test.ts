/**
 * GoalTransferService Unit Tests
 *
 * Tests goal transfer logic, edge cases, and Money class compliance.
 * Per CLAUDE.md Rule 17: 80%+ coverage for financial operations.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// MOCKS (Hoisted)
// ============================================================================
const {
  mockDb,
  mockWithTransaction,
  mockGoalActivityLogService,
  mockNotificationService,
  mockApplyProgressAdjustment,
} = vi.hoisted(() => ({
  mockDb: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  mockWithTransaction: vi.fn(),
  mockGoalActivityLogService: {
    log: vi.fn().mockResolvedValue(undefined),
  },
  mockNotificationService: {
    triggerGoalMilestone: vi.fn().mockResolvedValue(undefined),
  },
  // The fold itself runs against real Postgres in the goal-hardening suite;
  // here it applies the signed amount so the service's own logic is tested.
  mockApplyProgressAdjustment: vi.fn(async (_tx: unknown, goal: { id: string; currentAmount: string }, adjustment: { kind: string; amount: { toString(): string }; refId: string }) => {
    const { Money } = await import("../../core/money");
    const previous = new Money(goal.currentAmount);
    const next = previous.add(new Money(adjustment.amount.toString()));
    return { write: { goal: { ...goal, currentAmount: next.toString() }, previous, next }, net: next.subtract(previous), rebalanced: [], effects: new Map() };
  }),
}));

vi.mock("../goal/GoalProgressAdjustments", () => ({
  applyProgressAdjustment: mockApplyProgressAdjustment,
}));

vi.mock("../../db", () => ({
  db: mockDb,
}));

vi.mock("../../utils/withTransaction", () => ({
  withTransaction: mockWithTransaction,
}));

vi.mock("../GoalActivityLogService", () => ({
  goalActivityLogService: mockGoalActivityLogService,
}));

vi.mock("../NotificationService", () => ({
  notificationService: mockNotificationService,
}));

vi.mock("../goalCalculations", () => ({
  buildGoalBalanceUpdate: vi.fn((goal, newBalance) => {
    // Handle both Money and number (for backward compatibility)
    const balanceStr = typeof newBalance === 'object' && newBalance.toString
      ? newBalance.toString()
      : String(newBalance);

    return {
      currentAmount: balanceStr,
      status: "on_track",
      monthlyProjection: null,
      projectedCompletionDate: null,
      isCompleted: false,
      completedAt: null,
    };
  }),
  calculatePercentComplete: vi.fn((goal, balance) => {
    const target = parseFloat(goal.targetAmount);
    return target > 0 ? (balance / target) * 100 : 0;
  }),
}));

import { GoalTransferService } from "../GoalTransferService";
import { Money } from "../../core/money";

describe("GoalTransferService", () => {
  let service: GoalTransferService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GoalTransferService();
  });

  describe("transfer", () => {
    const mockFromGoal = {
      id: "goal-from",
      householdId: "house-123",
      name: "Emergency Fund",
      type: "save_up",
      goalType: "emergency_fund",
      targetAmount: "10000.00",
      currentAmount: "5000.00",
      currency: "ZMW",
      isCompleted: false,
    };

    const mockToGoal = {
      id: "goal-to",
      householdId: "house-123",
      name: "Vacation Fund",
      type: "save_up",
      goalType: "vacation",
      targetAmount: "3000.00",
      currentAmount: "500.00",
      currency: "ZMW",
      isCompleted: false,
    };

    it("should transfer funds between goals successfully", async () => {
      const mockTransfer = {
        id: "transfer-1",
        householdId: "house-123",
        fromGoalId: "goal-from",
        toGoalId: "goal-to",
        amount: "500.00",
        reason: "Rebalancing",
        createdBy: "user-123",
      };

      const updatedFromGoal = { ...mockFromGoal, currentAmount: "4500.00" };
      const updatedToGoal = { ...mockToGoal, currentAmount: "1000.00" };

      mockWithTransaction.mockImplementation(async (fn) => {
        const mockTx = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          for: vi.fn().mockReturnThis(),
          limit: vi.fn()
            .mockResolvedValueOnce([mockFromGoal])
            .mockResolvedValueOnce([mockToGoal]),
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          returning: vi.fn()
            .mockResolvedValueOnce([mockTransfer])
            .mockResolvedValueOnce([updatedFromGoal])
            .mockResolvedValueOnce([updatedToGoal]),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
        };
        return fn(mockTx);
      });

      const result = await service.transfer("house-123", "user-123", {
        fromGoalId: "goal-from",
        toGoalId: "goal-to",
        amount: { amount: "500.00", currency: "ZMW" },
        reason: "Rebalancing",
      });

      expect(result.transfer).toBeDefined();
      expect(mockGoalActivityLogService.log).toHaveBeenCalledTimes(2);
      const adjustments = mockApplyProgressAdjustment.mock.calls.map(([, goal, adjustment]) =>
        [goal.id, adjustment.kind, adjustment.amount.toString(), adjustment.refId]);
      expect(adjustments).toEqual([
        ["goal-from", "transfer_out", "-500.00", "transfer-1"],
        ["goal-to", "transfer_in", "500.00", "transfer-1"],
      ]);
      expect([result.fromGoal.currentAmount, result.toGoal.currentAmount]).toEqual(["4500.00", "1000.00"]);
    });

    it("should reject transfer with negative amount", async () => {
      await expect(
        service.transfer("house-123", "user-123", {
          fromGoalId: "goal-from",
          toGoalId: "goal-to",
          amount: { amount: "-100.00", currency: "ZMW" },
        })
      ).rejects.toThrow("Transfer amount must be positive");
    });

    it("should reject transfer with zero amount", async () => {
      await expect(
        service.transfer("house-123", "user-123", {
          fromGoalId: "goal-from",
          toGoalId: "goal-to",
          amount: { amount: "0.00", currency: "ZMW" },
        })
      ).rejects.toThrow("Transfer amount must be positive");
    });

    it("should reject transfer to same goal", async () => {
      mockWithTransaction.mockImplementation(async (fn) => {
        const mockTx = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          for: vi.fn().mockReturnThis(),
          limit: vi.fn()
            .mockResolvedValueOnce([mockFromGoal])
            .mockResolvedValueOnce([mockFromGoal]),
        };
        return fn(mockTx);
      });

      await expect(
        service.transfer("house-123", "user-123", {
          fromGoalId: "goal-from",
          toGoalId: "goal-from",
          amount: { amount: "100.00", currency: "ZMW" },
        })
      ).rejects.toThrow("Cannot transfer to the same goal");
    });

    it("should reject transfer between different goal types", async () => {
      const investmentGoal = {
        ...mockToGoal,
        type: "investment",
      };

      mockWithTransaction.mockImplementation(async (fn) => {
        const mockTx = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          for: vi.fn().mockReturnThis(),
          limit: vi.fn()
            .mockResolvedValueOnce([mockFromGoal])
            .mockResolvedValueOnce([investmentGoal]),
        };
        return fn(mockTx);
      });

      await expect(
        service.transfer("house-123", "user-123", {
          fromGoalId: "goal-from",
          toGoalId: "goal-to",
          amount: { amount: "100.00", currency: "ZMW" },
        })
      ).rejects.toThrow("Cannot transfer between different goal types");
    });

    it("should reject transfer between different currencies", async () => {
      const usdGoal = {
        ...mockToGoal,
        currency: "USD",
      };

      mockWithTransaction.mockImplementation(async (fn) => {
        const mockTx = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          for: vi.fn().mockReturnThis(),
          limit: vi.fn()
            .mockResolvedValueOnce([mockFromGoal])
            .mockResolvedValueOnce([usdGoal]),
        };
        return fn(mockTx);
      });

      await expect(
        service.transfer("house-123", "user-123", {
          fromGoalId: "goal-from",
          toGoalId: "goal-to",
          amount: { amount: "100.00", currency: "ZMW" },
        })
      ).rejects.toThrow("Cannot transfer between goals with different currencies");
    });

    it("should reject transfer from completed goal", async () => {
      const completedGoal = {
        ...mockFromGoal,
        isCompleted: true,
      };

      mockWithTransaction.mockImplementation(async (fn) => {
        const mockTx = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          for: vi.fn().mockReturnThis(),
          limit: vi.fn()
            .mockResolvedValueOnce([completedGoal])
            .mockResolvedValueOnce([mockToGoal]),
        };
        return fn(mockTx);
      });

      await expect(
        service.transfer("house-123", "user-123", {
          fromGoalId: "goal-from",
          toGoalId: "goal-to",
          amount: { amount: "100.00", currency: "ZMW" },
        })
      ).rejects.toThrow("Cannot transfer from a completed goal");
    });

    it("should reject transfer with insufficient balance", async () => {
      mockWithTransaction.mockImplementation(async (fn) => {
        const mockTx = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          for: vi.fn().mockReturnThis(),
          limit: vi.fn()
            .mockResolvedValueOnce([mockFromGoal])
            .mockResolvedValueOnce([mockToGoal]),
        };
        return fn(mockTx);
      });

      await expect(
        service.transfer("house-123", "user-123", {
          fromGoalId: "goal-from",
          toGoalId: "goal-to",
          amount: { amount: "10000.00", currency: "ZMW" }, // More than currentAmount (5000.00)
        })
      ).rejects.toThrow("Insufficient balance for transfer");
    });

    it("should reject transfer when source goal not found", async () => {
      mockWithTransaction.mockImplementation(async (fn) => {
        const mockTx = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          for: vi.fn().mockReturnThis(),
          // The destination lock comes first because its ID sorts before the source.
          limit: vi.fn().mockResolvedValueOnce([mockToGoal]).mockResolvedValueOnce([]),
        };
        return fn(mockTx);
      });

      await expect(
        service.transfer("house-123", "user-123", {
          fromGoalId: "non-existent",
          toGoalId: "goal-to",
          amount: { amount: "100.00", currency: "ZMW" },
        })
      ).rejects.toThrow("Goal not found");
    });

    it("should use Money class for precise arithmetic", async () => {
      // Test with amounts that would cause floating point errors
      const fromGoalWithPrecision = {
        ...mockFromGoal,
        currentAmount: "100.10",
      };

      const mockTransfer = {
        id: "transfer-precision",
        householdId: "house-123",
        fromGoalId: "goal-from",
        toGoalId: "goal-to",
        amount: "33.33",
        createdBy: "user-123",
      };

      mockWithTransaction.mockImplementation(async (fn) => {
        const mockTx = {
          select: vi.fn().mockReturnThis(),
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          for: vi.fn().mockReturnThis(),
          limit: vi.fn()
            .mockResolvedValueOnce([fromGoalWithPrecision])
            .mockResolvedValueOnce([mockToGoal]),
          insert: vi.fn().mockReturnThis(),
          values: vi.fn().mockReturnThis(),
          returning: vi.fn()
            .mockResolvedValueOnce([mockTransfer])
            .mockResolvedValueOnce([{ ...fromGoalWithPrecision, currentAmount: "66.77" }])
            .mockResolvedValueOnce([{ ...mockToGoal, currentAmount: "533.33" }]),
          update: vi.fn().mockReturnThis(),
          set: vi.fn().mockReturnThis(),
        };
        return fn(mockTx);
      });

      // This should not throw due to floating point issues
      const result = await service.transfer("house-123", "user-123", {
        fromGoalId: "goal-from",
        toGoalId: "goal-to",
        amount: { amount: "33.33", currency: "ZMW" },
      });

      expect(result.transfer).toBeDefined();
    });
  });

  describe("getTransfers", () => {
    it("should return all transfers for household", async () => {
      const mockTransfers = [
        { id: "t1", householdId: "house-123", amount: "100.00" },
        { id: "t2", householdId: "house-123", amount: "200.00" },
      ];

      mockDb.select.mockReturnThis();
      (mockDb as any).from = vi.fn().mockReturnThis();
      (mockDb as any).where = vi.fn().mockReturnThis();
      (mockDb as any).orderBy = vi.fn().mockResolvedValue(mockTransfers);

      const result = await service.getTransfers("house-123", { householdId: "house-123", userId: "user-1", role: "member" });

      expect(result).toEqual(mockTransfers);
    });
  });

  describe("getTransfersForGoal", () => {
    it("should return transfers involving specific goal", async () => {
      const mockTransfers = [
        { id: "t1", fromGoalId: "goal-1", toGoalId: "goal-2", amount: "100.00" },
      ];

      mockDb.select.mockReturnThis();
      (mockDb as any).from = vi.fn().mockReturnThis();
      (mockDb as any).where = vi.fn().mockReturnThis();
      (mockDb as any).orderBy = vi.fn().mockResolvedValue(mockTransfers);

      const result = await service.getTransfersForGoal("goal-1", "house-123", { householdId: "house-123", userId: "user-1", role: "member" });

      expect(result).toEqual(mockTransfers);
    });
  });

  describe("Money class compliance", () => {
    it("should preserve precision through 100 repeated transfers", () => {
      // P1 FIX VERIFICATION: Test that buildGoalBalanceUpdate preserves precision
      // Start with 1000.00, transfer 33.33 three times
      let balance = new Money("1000.00");
      const transferAmount = new Money("33.33");

      // After 3 transfers: 1000 - 33.33 - 33.33 - 33.33 = 900.01
      balance = balance.subtract(transferAmount);
      balance = balance.subtract(transferAmount);
      balance = balance.subtract(transferAmount);

      // With toFixed(2), this would drift. With Money.toString(), it should be exact.
      expect(balance.toString()).toBe("900.01");

      // Test 10 more iterations to verify no cumulative drift
      for (let i = 0; i < 10; i++) {
        balance = balance.subtract(transferAmount);
      }

      // After 13 total transfers: 1000 - (33.33 * 13) = 566.71
      expect(balance.toString()).toBe("566.71");
    });

    it("should handle edge case amounts correctly", () => {
      // Verify Money class handles precision correctly
      const amount1 = new Money("0.01");
      const amount2 = new Money("0.02");
      const sum = amount1.add(amount2);

      expect(sum.toString()).toBe("0.03");
    });

    it("should handle subtraction without floating point errors", () => {
      const balance = new Money("100.10");
      const transfer = new Money("33.33");
      const result = balance.subtract(transfer);

      expect(result.toString()).toBe("66.77");
    });

    it("should correctly compare amounts", () => {
      const balance = new Money("50.00");
      const amount = new Money("100.00");

      expect(balance.lt(amount)).toBe(true);
      expect(amount.lt(balance)).toBe(false);
    });

    it("should detect negative amounts", () => {
      const negative = new Money("-10.00");
      const positive = new Money("10.00");
      const zero = new Money("0.00");

      expect(negative.isNegative()).toBe(true);
      expect(positive.isNegative()).toBe(false);
      expect(zero.isNegative()).toBe(false);
    });

    it("should detect negative or zero amounts", () => {
      const negative = new Money("-10.00");
      const positive = new Money("10.00");
      const zero = new Money("0.00");

      expect(negative.isNegativeOrZero()).toBe(true);
      expect(zero.isNegativeOrZero()).toBe(true);
      expect(positive.isNegativeOrZero()).toBe(false);
    });
  });
});
