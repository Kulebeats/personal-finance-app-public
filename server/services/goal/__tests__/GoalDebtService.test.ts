/**
 * GoalDebtService Unit Tests
 *
 * Tests debt payoff calculations, scenarios generation, and Money class handling.
 * Per CLAUDE.md Rule 17: 80%+ coverage for financial operations.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// MOCKS (Hoisted)
// ============================================================================
const {
  mockDebtPayoffCalculator,
  mockGoalContributionService,
} = vi.hoisted(() => ({
  mockDebtPayoffCalculator: {
    calculatePayoff: vi.fn(),
    calculateScenarios: vi.fn(),
    calculateSnowball: vi.fn(),
    calculateAvalanche: vi.fn(),
  },
  mockGoalContributionService: {
    getGoalById: vi.fn(),
    addContribution: vi.fn(),
    getContributions: vi.fn(),
  },
}));

vi.mock("../GoalViewerProgress", () => ({
  readGoalSourceVisibility: vi.fn(async (_actor: unknown, ids: string[]) =>
    new Map(ids.map((id) => [id, { progressVisible: true, linkedAccountVisible: true, debtAccountVisible: true }]))),
}));

const ACTOR = { householdId: "house-123", userId: "user-123", role: "owner" as const };

/** Payoff readers return null when progress is hidden; these cases expect a result. */
function present<T>(value: T | null): T {
  if (value === null) throw new Error("Expected a payoff result for a visible goal");
  return value;
}

vi.mock("../../DebtPayoffCalculator", () => ({
  debtPayoffCalculator: mockDebtPayoffCalculator,
}));

// Mock the parent class
vi.mock("./GoalContributionService", () => ({
  GoalContributionService: vi.fn().mockImplementation(() => mockGoalContributionService),
}));

import { GoalDebtService } from "../GoalDebtService";
import { readGoalSourceVisibility } from "../GoalViewerProgress";
import { Money } from "../../../core/money";

describe("GoalDebtService", () => {
  let service: GoalDebtService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GoalDebtService();
    // Manually assign the mock methods since we're mocking the parent class
    (service as any).getGoalById = mockGoalContributionService.getGoalById;
  });

  describe("calculatePayoff", () => {
    const mockPayDownGoal = {
      id: "goal-debt",
      householdId: "house-123",
      name: "Credit Card Debt",
      type: "pay_down",
      goalType: "credit_card",
      targetAmount: "5000.00",
      currentAmount: "-5000.00",
      currency: "ZMW",
      interestRate: "18.99",
      minimumPayment: "150.00",
      monthlyPayment: "300.00",
    };

    it("should calculate payoff scenario correctly", async () => {
      mockGoalContributionService.getGoalById.mockResolvedValue(mockPayDownGoal);
      mockDebtPayoffCalculator.calculatePayoff.mockReturnValue({
        monthlyPayment: 400,
        payoffDate: "2027-06-15",
        totalInterest: 450.23,
        totalPayment: 5450.23,
        monthsToPayoff: 18,
        interestSavedVsMinimum: 200.50,
        schedule: [],
      });

      const result = present(await service.calculatePayoff("goal-debt", ACTOR, {
        monthlyPayment: 400,
        oneTimePayment: 500,
      }));

      expect(result.monthlyPayment).toBe(400);
      expect(result.payoffDate).toBe("2027-06-15");
      expect(result.monthsToPayoff).toBe(18);
      expect(mockDebtPayoffCalculator.calculatePayoff).toHaveBeenCalledWith(
        5000, // balance (absolute value)
        18.99, // APR
        400, // monthly payment
        500 // one-time payment
      );
    });

    it("should throw error for non-pay_down goals", async () => {
      const saveUpGoal = {
        ...mockPayDownGoal,
        type: "save_up",
      };
      mockGoalContributionService.getGoalById.mockResolvedValue(saveUpGoal);

      await expect(
        service.calculatePayoff("goal-debt", ACTOR, {
          monthlyPayment: 400,
        })
      ).rejects.toThrow("Payoff calculations only apply to pay down goals");
    });

    it("should handle zero interest rate", async () => {
      const zeroInterestGoal = {
        ...mockPayDownGoal,
        interestRate: "0.00",
      };
      mockGoalContributionService.getGoalById.mockResolvedValue(zeroInterestGoal);
      mockDebtPayoffCalculator.calculatePayoff.mockReturnValue({
        monthlyPayment: 300,
        payoffDate: "2027-05-01",
        totalInterest: 0,
        totalPayment: 5000,
        monthsToPayoff: 17,
        interestSavedVsMinimum: 0,
        schedule: [],
      });

      const result = present(await service.calculatePayoff("goal-debt", ACTOR, {
        monthlyPayment: 300,
      }));

      expect(result.totalInterest).toBe(0);
      expect(mockDebtPayoffCalculator.calculatePayoff).toHaveBeenCalledWith(
        5000,
        0, // zero APR
        300,
        0
      );
    });

    it("should handle null interest rate", async () => {
      const nullInterestGoal = {
        ...mockPayDownGoal,
        interestRate: null,
      };
      mockGoalContributionService.getGoalById.mockResolvedValue(nullInterestGoal);
      mockDebtPayoffCalculator.calculatePayoff.mockReturnValue({
        monthlyPayment: 300,
        payoffDate: "2027-05-01",
        totalInterest: 0,
        totalPayment: 5000,
        monthsToPayoff: 17,
        interestSavedVsMinimum: 0,
        schedule: [],
      });

      await service.calculatePayoff("goal-debt", ACTOR, {
        monthlyPayment: 300,
      });

      expect(mockDebtPayoffCalculator.calculatePayoff).toHaveBeenCalledWith(
        5000,
        0, // null converted to 0
        300,
        0
      );
    });

    it("should convert negative balance to absolute value", async () => {
      mockGoalContributionService.getGoalById.mockResolvedValue(mockPayDownGoal);
      mockDebtPayoffCalculator.calculatePayoff.mockReturnValue({
        monthlyPayment: 400,
        payoffDate: "2027-06-15",
        totalInterest: 450.23,
        totalPayment: 5450.23,
        monthsToPayoff: 18,
        interestSavedVsMinimum: 0,
        schedule: [],
      });

      await service.calculatePayoff("goal-debt", ACTOR, {
        monthlyPayment: 400,
      });

      // Balance is -5000.00, should be converted to 5000
      expect(mockDebtPayoffCalculator.calculatePayoff).toHaveBeenCalledWith(
        5000,
        expect.any(Number),
        400,
        0
      );
    });
  });

  describe("hidden progress sources", () => {
    it("returns null without calculating when the viewer cannot see every source", async () => {
      mockGoalContributionService.getGoalById.mockResolvedValue({
        id: "goal-debt", householdId: "house-123", type: "pay_down", currentAmount: "-5000.00",
        interestRate: "18.99", minimumPayment: "150.00", monthlyPayment: "400.00",
      });
      const hidden = new Map([["goal-debt", { progressVisible: false, linkedAccountVisible: true, debtAccountVisible: false }]]);
      vi.mocked(readGoalSourceVisibility).mockResolvedValueOnce(hidden).mockResolvedValueOnce(hidden);

      expect(await service.calculatePayoff("goal-debt", ACTOR, { monthlyPayment: 400 })).toBeNull();
      expect(await service.getPayoffScenarios("goal-debt", ACTOR)).toBeNull();
      expect(mockDebtPayoffCalculator.calculatePayoff).not.toHaveBeenCalled();
      expect(mockDebtPayoffCalculator.calculateScenarios).not.toHaveBeenCalled();
    });
  });

  describe("getPayoffScenarios", () => {
    const mockPayDownGoal = {
      id: "goal-debt",
      householdId: "house-123",
      name: "Credit Card Debt",
      type: "pay_down",
      goalType: "credit_card",
      targetAmount: "5000.00",
      currentAmount: "-5000.00",
      currency: "ZMW",
      interestRate: "18.99",
      minimumPayment: "150.00",
      monthlyPayment: "300.00",
      oneTimePayment: null,
    };

    it("should return all four payoff scenarios", async () => {
      mockGoalContributionService.getGoalById.mockResolvedValue(mockPayDownGoal);
      mockDebtPayoffCalculator.calculateScenarios.mockReturnValue({
        minimum: {
          monthlyPayment: 150,
          payoffDate: "2029-01-01",
          totalInterest: 2500,
          monthsToPayoff: 48,
        },
        current: {
          monthlyPayment: 300,
          payoffDate: "2027-06-01",
          totalInterest: 1000,
          monthsToPayoff: 24,
        },
        accelerated: {
          monthlyPayment: 225,
          payoffDate: "2027-12-01",
          totalInterest: 1500,
          monthsToPayoff: 30,
        },
        aggressive: {
          monthlyPayment: 300,
          payoffDate: "2027-06-01",
          totalInterest: 1000,
          monthsToPayoff: 24,
        },
      });

      const result = present(await service.getPayoffScenarios("goal-debt", ACTOR));

      expect(result.minimum).toBeDefined();
      expect(result.current).toBeDefined();
      expect(result.accelerated).toBeDefined();
      expect(result.aggressive).toBeDefined();
    });

    it("should throw error for non-pay_down goals", async () => {
      const investmentGoal = {
        ...mockPayDownGoal,
        type: "investment",
      };
      mockGoalContributionService.getGoalById.mockResolvedValue(investmentGoal);

      await expect(
        service.getPayoffScenarios("goal-debt", ACTOR)
      ).rejects.toThrow("Payoff calculations only apply to pay down goals");
    });

    it("should use Money class for payment amounts", async () => {
      mockGoalContributionService.getGoalById.mockResolvedValue(mockPayDownGoal);
      mockDebtPayoffCalculator.calculateScenarios.mockReturnValue({
        minimum: { monthsToPayoff: 48 },
        current: { monthsToPayoff: 24 },
        accelerated: { monthsToPayoff: 30 },
        aggressive: { monthsToPayoff: 24 },
      });

      await service.getPayoffScenarios("goal-debt", ACTOR);

      // Verify that scenarios were calculated with correct parameters
      expect(mockDebtPayoffCalculator.calculateScenarios).toHaveBeenCalledWith({
        balance: 5000,
        apr: 18.99,
        minimumPayment: 150,
        currentPayment: 300,
        oneTimePayment: 0,
      });
    });

    it("should handle goal with one-time payment", async () => {
      const goalWithOneTime = {
        ...mockPayDownGoal,
        oneTimePayment: "500.00",
      };
      mockGoalContributionService.getGoalById.mockResolvedValue(goalWithOneTime);
      mockDebtPayoffCalculator.calculateScenarios.mockReturnValue({
        minimum: { monthsToPayoff: 36 },
        current: { monthsToPayoff: 18 },
        accelerated: { monthsToPayoff: 24 },
        aggressive: { monthsToPayoff: 18 },
      });

      await service.getPayoffScenarios("goal-debt", ACTOR);

      expect(mockDebtPayoffCalculator.calculateScenarios).toHaveBeenCalledWith({
        balance: 5000,
        apr: 18.99,
        minimumPayment: 150,
        currentPayment: 300,
        oneTimePayment: 500,
      });
    });
  });

  describe("calculateDebtStrategy", () => {
    const mockDebts = [
      { id: "debt-1", balance: 5000, rate: 18.99, minPayment: 150 },
      { id: "debt-2", balance: 2000, rate: 15.00, minPayment: 50 },
      { id: "debt-3", balance: 10000, rate: 22.00, minPayment: 200 },
    ];

    it("should calculate snowball strategy (lowest balance first)", async () => {
      mockDebtPayoffCalculator.calculateSnowball.mockReturnValue([
        { debtId: "debt-2", payoffOrder: 1, payoffDate: "2027-03-01" },
        { debtId: "debt-1", payoffOrder: 2, payoffDate: "2027-09-01" },
        { debtId: "debt-3", payoffOrder: 3, payoffDate: "2028-06-01" },
      ]);

      const result = await service.calculateDebtStrategy("snowball", mockDebts);

      expect(result[0].debtId).toBe("debt-2"); // Lowest balance
      expect(result[0].payoffOrder).toBe(1);
      expect(mockDebtPayoffCalculator.calculateSnowball).toHaveBeenCalledWith(mockDebts);
    });

    it("should calculate avalanche strategy (highest rate first)", async () => {
      mockDebtPayoffCalculator.calculateAvalanche.mockReturnValue([
        { debtId: "debt-3", payoffOrder: 1, payoffDate: "2027-06-01" },
        { debtId: "debt-1", payoffOrder: 2, payoffDate: "2028-01-01" },
        { debtId: "debt-2", payoffOrder: 3, payoffDate: "2028-06-01" },
      ]);

      const result = await service.calculateDebtStrategy("avalanche", mockDebts);

      expect(result[0].debtId).toBe("debt-3"); // Highest rate
      expect(result[0].payoffOrder).toBe(1);
      expect(mockDebtPayoffCalculator.calculateAvalanche).toHaveBeenCalledWith(mockDebts);
    });

    it("should handle single debt", async () => {
      const singleDebt = [mockDebts[0]];
      mockDebtPayoffCalculator.calculateSnowball.mockReturnValue([
        { debtId: "debt-1", payoffOrder: 1, payoffDate: "2027-06-01" },
      ]);

      const result = await service.calculateDebtStrategy("snowball", singleDebt);

      expect(result).toHaveLength(1);
      expect(result[0].payoffOrder).toBe(1);
    });

    it("should handle empty debt list", async () => {
      mockDebtPayoffCalculator.calculateSnowball.mockReturnValue([]);

      const result = await service.calculateDebtStrategy("snowball", []);

      expect(result).toHaveLength(0);
    });
  });

  describe("Money class precision", () => {
    it("should handle small decimal amounts correctly", () => {
      const amount1 = new Money("0.01");
      const amount2 = new Money("0.02");
      const sum = amount1.add(amount2);

      expect(sum.toString()).toBe("0.03");
      expect(sum.toNumber()).toBe(0.03);
    });

    it("should handle amounts that cause floating point errors", () => {
      // Classic floating point issue: 0.1 + 0.2 !== 0.3 in JS
      const amount1 = new Money("0.10");
      const amount2 = new Money("0.20");
      const sum = amount1.add(amount2);

      expect(sum.toString()).toBe("0.30");
    });

    it("should handle large amounts correctly", () => {
      const large1 = new Money("999999999.99");
      const large2 = new Money("0.01");
      const sum = large1.add(large2);

      expect(sum.toString()).toBe("1000000000.00");
    });

    it("should handle absolute value correctly for debt amounts", () => {
      const debt = new Money("-5000.00");
      const absolute = debt.abs();

      expect(absolute.toString()).toBe("5000.00");
      expect(absolute.toNumber()).toBe(5000);
    });

    it("should handle zero values correctly", () => {
      const zero = Money.zero();
      const amount = new Money("100.00");

      expect(zero.toString()).toBe("0.00");
      expect(zero.add(amount).toString()).toBe("100.00");
      expect(amount.subtract(amount).toString()).toBe("0.00");
    });
  });

  describe("Edge cases", () => {
    it("should handle goal with null minimum payment", async () => {
      const goalNullMin = {
        id: "goal-debt",
        householdId: "house-123",
        type: "pay_down",
        currentAmount: "-1000.00",
        interestRate: "10.00",
        minimumPayment: null,
        monthlyPayment: "100.00",
        oneTimePayment: null,
      };
      mockGoalContributionService.getGoalById.mockResolvedValue(goalNullMin);
      mockDebtPayoffCalculator.calculateScenarios.mockReturnValue({
        minimum: { monthsToPayoff: 12 },
        current: { monthsToPayoff: 12 },
        accelerated: { monthsToPayoff: 10 },
        aggressive: { monthsToPayoff: 8 },
      });

      await service.getPayoffScenarios("goal-debt", ACTOR);

      expect(mockDebtPayoffCalculator.calculateScenarios).toHaveBeenCalledWith({
        balance: 1000,
        apr: 10,
        minimumPayment: 0, // null converted to 0
        currentPayment: 100,
        oneTimePayment: 0,
      });
    });

    it("should handle goal with null monthly payment", async () => {
      const goalNullMonthly = {
        id: "goal-debt",
        householdId: "house-123",
        type: "pay_down",
        currentAmount: "-1000.00",
        interestRate: "10.00",
        minimumPayment: "50.00",
        monthlyPayment: null,
        oneTimePayment: null,
      };
      mockGoalContributionService.getGoalById.mockResolvedValue(goalNullMonthly);
      mockDebtPayoffCalculator.calculateScenarios.mockReturnValue({
        minimum: { monthsToPayoff: 24 },
        current: { monthsToPayoff: 24 },
        accelerated: { monthsToPayoff: 18 },
        aggressive: { monthsToPayoff: 12 },
      });

      await service.getPayoffScenarios("goal-debt", ACTOR);

      expect(mockDebtPayoffCalculator.calculateScenarios).toHaveBeenCalledWith({
        balance: 1000,
        apr: 10,
        minimumPayment: 50,
        currentPayment: 0, // null converted to 0
        oneTimePayment: 0,
      });
    });

    it("should handle very high interest rate", async () => {
      const highInterestGoal = {
        id: "goal-debt",
        householdId: "house-123",
        type: "pay_down",
        currentAmount: "-1000.00",
        interestRate: "99.99",
        minimumPayment: "100.00",
        monthlyPayment: "200.00",
      };
      mockGoalContributionService.getGoalById.mockResolvedValue(highInterestGoal);
      mockDebtPayoffCalculator.calculatePayoff.mockReturnValue({
        monthlyPayment: 200,
        payoffDate: null,
        totalInterest: 5000,
        totalPayment: 6000,
        monthsToPayoff: null,
        interestSavedVsMinimum: 0,
        schedule: [],
      });

      const result = await service.calculatePayoff("goal-debt", ACTOR, {
        monthlyPayment: 200,
      });

      // High interest might result in null payoff date
      expect(result).toBeDefined();
    });
  });
});
