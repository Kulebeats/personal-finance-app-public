import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyticsService } from "../AnalyticsService";
import {
  analyticsReportRepository,
  netWorthReportRepository,
  cashflowReportRepository,
  spendingReportRepository,
} from "../../repositories/reports";

// Mock modular repositories
vi.mock("../../repositories/reports", () => ({
  analyticsReportRepository: {
    getFinancialRatios: vi.fn(),
    getDebtAnalysis: vi.fn(),
    getGoalsProgress: vi.fn(),
    getForecast: vi.fn(),
    executeCustomChart: vi.fn(),
  },
  netWorthReportRepository: {
    getNetWorthChanges: vi.fn(),
  },
  cashflowReportRepository: {
    getExpenseClassification: vi.fn(),
  },
  spendingReportRepository: {
    getSubcategoryBreakdown: vi.fn(),
  },
}));

describe("AnalyticsService", () => {
  const mockHouseholdId = "household-123";
  const mockUserId = "user-123";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getFinancialRatios", () => {
    it("should delegate to analyticsReportRepository.getFinancialRatios with correct parameters", async () => {
      const query = { from: "2023-01-01", to: "2023-12-31" };
      const mockResult = { ratios: {} };
      (analyticsReportRepository.getFinancialRatios as any).mockResolvedValue(
        mockResult
      );

      const result = await analyticsService.getFinancialRatios(
        mockHouseholdId,
        mockUserId,
        query
      );

      expect(analyticsReportRepository.getFinancialRatios).toHaveBeenCalledWith(
        mockHouseholdId,
        { ...query, userId: mockUserId }
      );
      expect(result).toMatchObject(mockResult);
    });

    it("should throw error for invalid date range", async () => {
      const query = { from: "invalid-date", to: "2023-12-31" };

      await expect(
        analyticsService.getFinancialRatios(mockHouseholdId, mockUserId, query)
      ).rejects.toThrow();
    });
  });

  describe("getDebtAnalysis", () => {
    it("should delegate to analyticsReportRepository.getDebtAnalysis", async () => {
      const query = { from: "2023-01-01", to: "2023-12-31" };
      const mockResult = { debts: [] };
      (analyticsReportRepository.getDebtAnalysis as any).mockResolvedValue(
        mockResult
      );

      const result = await analyticsService.getDebtAnalysis(
        mockHouseholdId,
        mockUserId,
        query
      );

      expect(analyticsReportRepository.getDebtAnalysis).toHaveBeenCalledWith(
        mockHouseholdId,
        { ...query, userId: mockUserId }
      );
      expect(result).toMatchObject(mockResult);
    });
  });

  describe("getNetWorthChanges", () => {
    it("should delegate to netWorthReportRepository.getNetWorthChanges", async () => {
      const query = { from: "2023-01-01", to: "2023-12-31" };
      const mockResult = { series: [] };
      (netWorthReportRepository.getNetWorthChanges as any).mockResolvedValue(
        mockResult
      );

      const result = await analyticsService.getNetWorthChanges(
        mockHouseholdId,
        mockUserId,
        query
      );

      expect(netWorthReportRepository.getNetWorthChanges).toHaveBeenCalledWith(
        mockHouseholdId,
        { ...query, userId: mockUserId }
      );
      expect(result).toMatchObject(mockResult);
    });
  });

  describe("getExpenseClassification", () => {
    it("should delegate to cashflowReportRepository.getExpenseClassification", async () => {
      const query = { from: "2023-01-01", to: "2023-12-31" };
      const mockResult = { classification: {} };
      (
        cashflowReportRepository.getExpenseClassification as any
      ).mockResolvedValue(mockResult);

      const result = await analyticsService.getExpenseClassification(
        mockHouseholdId,
        mockUserId,
        query
      );

      expect(
        cashflowReportRepository.getExpenseClassification
      ).toHaveBeenCalledWith(mockHouseholdId, { ...query, userId: mockUserId });
      expect(result).toMatchObject(mockResult);
    });
  });

  describe("executeCustomChart", () => {
    it("should delegate to analyticsReportRepository.executeCustomChart", async () => {
      const body = {
        config: {
          name: "Test Chart",
          chartType: "bar",
          primaryMetric: "income",
        },
        from: "2023-01-01",
        to: "2023-12-31",
      };
      const mockResult = { data: [] };
      (analyticsReportRepository.executeCustomChart as any).mockResolvedValue(
        mockResult
      );

      const result = await analyticsService.executeCustomChart(
        mockHouseholdId,
        mockUserId,
        body
      );

      expect(analyticsReportRepository.executeCustomChart).toHaveBeenCalledWith(
        mockHouseholdId,
        { ...body, userId: mockUserId }
      );
      expect(result).toMatchObject(mockResult);
    });

    it("should validate date range in body", async () => {
      const body = {
        config: {
          name: "Test Chart",
          chartType: "bar",
          primaryMetric: "income",
        },
        from: "invalid",
        to: "2023-12-31",
      };

      await expect(
        analyticsService.executeCustomChart(mockHouseholdId, mockUserId, body)
      ).rejects.toThrow();
    });
  });
});
