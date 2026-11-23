/**
 * Reports Module - Integration Tests
 *
 * Comprehensive HTTP-level integration tests for all report endpoints.
 * Tests authentication, authorization, household isolation, date range filtering,
 * response format validation, error handling, and audit logging.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { ForbiddenError } from "../../../core/errors";

// ============================================================================
// MOCKS (Hoisted)
// ============================================================================
const {
  mockReportsService,
  mockBusinessAuditService,
} = vi.hoisted(() => ({
  mockReportsService: {
    getAnnual: vi.fn(),
    getCashflow: vi.fn(),
    getBudgetComparison: vi.fn(),
    getIncome: vi.fn(),
    getSavingsRate: vi.fn(),
    getSpendingBreakdown: vi.fn(),
    getSpendingTrend: vi.fn(),
    getNetWorth: vi.fn(),
    getNetWorthChanges: vi.fn(),
    getSankey: vi.fn(),
    getFinancialRatios: vi.fn(),
    getDebtAnalysis: vi.fn(),
    getForecast: vi.fn(),
    getTransactions: vi.fn(),
    getExpenseClassification: vi.fn(),
    getGoalsProgress: vi.fn(),
    getSubcategoryBreakdown: vi.fn(),
    executeCustomChart: vi.fn(),
  },
  mockBusinessAuditService: {
    log: vi.fn().mockResolvedValue(undefined),
    logCreate: vi.fn().mockResolvedValue(undefined),
    logUpdate: vi.fn().mockResolvedValue(undefined),
    logDelete: vi.fn().mockResolvedValue(undefined),
    getIpAddress: vi.fn().mockReturnValue("127.0.0.1"),
  },
}));

const {
  mockReportsExportService,
  mockExportMetadata,
  mockReportExportCreation,
} = vi.hoisted(() => ({
  mockExportMetadata: { list: vi.fn(), read: vi.fn() },
  mockReportExportCreation: vi.fn(),
  mockReportsExportService: {
    listExports: vi.fn(),
    getExportById: vi.fn(),
    generateExportFile: vi.fn(),
  },
}));

// Mutable household context the mocked householdGuard injects. Tests can set a
// non-admin role or null (to simulate missing context) and beforeEach resets it.
const DEFAULT_GUARD_CONTEXT = {
  householdId: "house-123",
  userId: "user-123",
  role: "admin",
};
type GuardContext = { householdId: string; userId: string; role: string } | null;
const { guardContext } = vi.hoisted(() => ({
  guardContext: {
    value: {
      householdId: "house-123",
      userId: "user-123",
      role: "admin",
    } as GuardContext,
  },
}));

// Mock Service
vi.mock("../reports.service", () => ({
  reportsService: mockReportsService,
}));

// Mock Export Service
vi.mock("../reports.export.service", () => ({
  reportsExportService: mockReportsExportService,
}));
// Current authority and real source cuts are covered by signed DB tests; this
// fixture verifies the controller invokes those boundaries (no real sessions).
vi.mock("../reportExportMetadata", () => ({
  listAuthorizedExportMetadata: mockExportMetadata.list,
  readAuthorizedExportMetadata: mockExportMetadata.read,
}));
vi.mock("../reportExportCreation", () => ({ createAuthorizedReportExport: mockReportExportCreation }));

// Mock BusinessAuditService
vi.mock("../../../services/BusinessAuditService", () => ({
  businessAuditService: mockBusinessAuditService,
}));

// Mock Middleware — injects the mutable guardContext (null = no context set).
vi.mock("../../../middleware/householdGuard", () => ({
  householdGuard: (
    req: {
      householdContext?: unknown;
      user?: unknown;
      session?: unknown;
    },
    _res: unknown,
    next: () => void,
  ) => {
    if (guardContext.value) {
      req.householdContext = guardContext.value;
      req.user = { id: guardContext.value.userId };
      req.session = { userId: guardContext.value.userId };
    }
    next();
  },
}));

vi.mock("../../../middleware/rateLimit", () => ({
  analyticsLimiter: (req: any, res: any, next: any) => next(),
  expensiveAnalyticsLimiter: (req: any, res: any, next: any) => next(),
}));

// This is a controller-wiring unit test: the service layer is mocked. The only
// real DB touch left is reports.utils.resolveReportQuery -> findPreferences,
// which would run a real query with the mocked (non-UUID) householdId and 500.
// Mock the repository boundary so the test stays self-contained (no real DB).
vi.mock("../../../repositories/HouseholdRepository", () => ({
  householdRepository: {
    findPreferences: vi
      .fn()
      .mockResolvedValue({ showPendingTransactions: true }),
  },
}));

// Import Routes (after mocks are defined)
import reportsRouter from "../reports.routes";
import { errorHandler } from "../../../core/errors/errorHandler";

const app = express();
app.use(express.json());
app.use("/api/reports", reportsRouter);
app.use(errorHandler);

// Valid UUIDs for id-typed query/params (the schema validates these with .uuid()).
const CATEGORY_ID = "11111111-1111-1111-1111-111111111111";
const CATEGORY_ID_2 = "22222222-2222-2222-2222-222222222222";
const MERCHANT_ID = "33333333-3333-3333-3333-333333333333";
const EXPORT_ID = "44444444-4444-4444-4444-444444444444";

describe("Reports Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guardContext.value = { ...DEFAULT_GUARD_CONTEXT };
  });

  // =========================================================================
  // ANNUAL REPORTS
  // =========================================================================

  describe("GET /api/reports/annual - Annual Report", () => {
    it("should return annual report for specified year", async () => {
      const mockAnnual = {
        year: 2026,
        totalIncome: 120000,
        totalExpenses: 80000,
        netSavings: 40000,
        savingsRate: 33.33,
        monthlyBreakdown: [
          { month: "2026-01", income: 10000, expenses: 6500, net: 3500 },
          { month: "2026-02", income: 10000, expenses: 7000, net: 3000 },
        ],
      };

      mockReportsService.getAnnual.mockResolvedValue(mockAnnual);

      const res = await request(app)
        .get("/api/reports/annual?year=2026")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.year).toBe(2026);
      expect(res.body.data.totalIncome).toBe(120000);
      expect(mockReportsService.getAnnual).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          year: 2026,
          scope: "household",
        })
      );
    });

    it("should validate year parameter is required", async () => {
      const res = await request(app)
        .get("/api/reports/annual")
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("should validate year range (2000-2100)", async () => {
      const res = await request(app)
        .get("/api/reports/annual?year=1999")
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("should accept compareYear parameter", async () => {
      const mockAnnual = {
        year: 2026,
        totalIncome: 120000,
        totalExpenses: 80000,
        netSavings: 40000,
        savingsRate: 33.33,
        monthlyBreakdown: [],
        comparison: {
          year: 2025,
          incomeChange: 5000,
          expensesChange: 3000,
        },
      };

      mockReportsService.getAnnual.mockResolvedValue(mockAnnual);

      const res = await request(app)
        .get("/api/reports/annual?year=2026&compareYear=2025")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockReportsService.getAnnual).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          year: 2026,
          compareYear: 2025,
        })
      );
    });
  });

  // =========================================================================
  // CASHFLOW REPORTS
  // =========================================================================

  describe("GET /api/reports/cashflow - Cashflow Report", () => {
    it("should return cashflow data for date range", async () => {
      const mockCashflow = {
        periods: [
          { period: "2026-01", income: 10000, expenses: 6500, net: 3500 },
          { period: "2026-02", income: 10000, expenses: 7000, net: 3000 },
        ],
        totals: {
          income: 20000,
          expenses: 13500,
          net: 6500,
        },
      };

      mockReportsService.getCashflow.mockResolvedValue(mockCashflow);

      const res = await request(app)
        .get("/api/reports/cashflow?from=2026-01-01&to=2026-02-28")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.periods).toHaveLength(2);
      expect(mockReportsService.getCashflow).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          from: "2026-01-01",
          to: "2026-02-28",
          scope: "household",
        })
      );
    });

    it("should validate from and to parameters are required", async () => {
      const res = await request(app)
        .get("/api/reports/cashflow")
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("should validate date format (YYYY-MM-DD)", async () => {
      const res = await request(app)
        .get("/api/reports/cashflow?from=01-01-2026&to=2026-02-28")
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should accept interval parameter", async () => {
      mockReportsService.getCashflow.mockResolvedValue({ periods: [], totals: {} });

      await request(app)
        .get("/api/reports/cashflow?from=2026-01-01&to=2026-12-31&interval=month")
        .expect(200);

      expect(mockReportsService.getCashflow).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          interval: "month",
        })
      );
    });

    it("should accept forecast parameters", async () => {
      mockReportsService.getCashflow.mockResolvedValue({ periods: [], totals: {} });

      await request(app)
        .get("/api/reports/cashflow?from=2026-01-01&to=2026-12-31&interval=month&includeForecast=true&forecastMonths=6")
        .expect(200);

      expect(mockReportsService.getCashflow).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          includeForecast: true,
          forecastMonths: 6,
        })
      );
    });

    it("should validate forecast only works with monthly interval", async () => {
      const res = await request(app)
        .get("/api/reports/cashflow?from=2026-01-01&to=2026-12-31&interval=day&includeForecast=true")
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  describe("GET /api/reports/cashflow/budget - Budget Comparison", () => {
    it("should return budget vs actual comparison", async () => {
      const mockBudget = {
        periods: [
          { period: "2026-01", budgeted: 8000, actual: 6500, variance: 1500 },
        ],
      };

      mockReportsService.getBudgetComparison.mockResolvedValue(mockBudget);

      const res = await request(app)
        .get("/api/reports/cashflow/budget?from=2026-01-01&to=2026-01-31")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockReportsService.getBudgetComparison).toHaveBeenCalled();
    });
  });

  describe("GET /api/reports/income - Income Report", () => {
    it("should return income breakdown", async () => {
      const mockIncome = {
        total: 10000,
        bySource: [
          { source: "Salary", amount: 8000 },
          { source: "Freelance", amount: 2000 },
        ],
      };

      mockReportsService.getIncome.mockResolvedValue(mockIncome);

      const res = await request(app)
        .get("/api/reports/income?from=2026-01-01&to=2026-01-31")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.total).toBe(10000);
    });
  });

  describe("GET /api/reports/savings-rate - Savings Rate", () => {
    it("should return savings rate data", async () => {
      const mockSavings = {
        periods: [
          { period: "2026-01", income: 10000, expenses: 6500, savings: 3500, rate: 35 },
        ],
        average: 35,
      };

      mockReportsService.getSavingsRate.mockResolvedValue(mockSavings);

      const res = await request(app)
        .get("/api/reports/savings-rate?from=2026-01-01&to=2026-01-31")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.average).toBe(35);
    });

    it("should accept interval parameter (week or month)", async () => {
      mockReportsService.getSavingsRate.mockResolvedValue({ periods: [], average: 0 });

      await request(app)
        .get("/api/reports/savings-rate?from=2026-01-01&to=2026-01-31&interval=week")
        .expect(200);

      expect(mockReportsService.getSavingsRate).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          interval: "week",
        })
      );
    });
  });

  // =========================================================================
  // SPENDING REPORTS
  // =========================================================================

  describe("GET /api/reports/spending/breakdown - Spending Breakdown", () => {
    it("should return spending breakdown by category", async () => {
      const mockBreakdown = {
        items: [
          { id: "cat-1", name: "Food", amount: 500, percentage: 50, transactionCount: 10 },
          { id: "cat-2", name: "Transport", amount: 300, percentage: 30, transactionCount: 5 },
        ],
        total: 1000,
      };

      mockReportsService.getSpendingBreakdown.mockResolvedValue(mockBreakdown);

      const res = await request(app)
        .get("/api/reports/spending/breakdown?from=2026-01-01&to=2026-01-31")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toHaveLength(2);
      expect(mockReportsService.getSpendingBreakdown).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          from: "2026-01-01",
          to: "2026-01-31",
          groupBy: "categoryGroup", // default
        })
      );
    });

    it("should accept groupBy parameter", async () => {
      mockReportsService.getSpendingBreakdown.mockResolvedValue({ items: [], total: 0 });

      await request(app)
        .get("/api/reports/spending/breakdown?from=2026-01-01&to=2026-01-31&groupBy=merchant")
        .expect(200);

      expect(mockReportsService.getSpendingBreakdown).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          groupBy: "merchant",
        })
      );
    });

    it("should accept limit parameter", async () => {
      mockReportsService.getSpendingBreakdown.mockResolvedValue({ items: [], total: 0 });

      await request(app)
        .get("/api/reports/spending/breakdown?from=2026-01-01&to=2026-01-31&limit=10")
        .expect(200);

      expect(mockReportsService.getSpendingBreakdown).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          limit: 10,
        })
      );
    });

    it("should validate limit range (1-200)", async () => {
      const res = await request(app)
        .get("/api/reports/spending/breakdown?from=2026-01-01&to=2026-01-31&limit=300")
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should accept type parameter (income or expense)", async () => {
      mockReportsService.getSpendingBreakdown.mockResolvedValue({ items: [], total: 0 });

      await request(app)
        .get("/api/reports/spending/breakdown?from=2026-01-01&to=2026-01-31&type=income")
        .expect(200);

      expect(mockReportsService.getSpendingBreakdown).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          type: "income",
        })
      );
    });
  });

  describe("GET /api/reports/spending/trend - Spending Trend", () => {
    it("should return spending trend over time", async () => {
      const mockTrend = {
        periods: [
          { period: "2026-01", amount: 6500 },
          { period: "2026-02", amount: 7000 },
        ],
      };

      mockReportsService.getSpendingTrend.mockResolvedValue(mockTrend);

      const res = await request(app)
        .get("/api/reports/spending/trend?from=2026-01-01&to=2026-02-28")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.periods).toHaveLength(2);
    });

    it("should accept compare parameter", async () => {
      mockReportsService.getSpendingTrend.mockResolvedValue({ periods: [] });

      await request(app)
        .get("/api/reports/spending/trend?from=2026-01-01&to=2026-02-28&compare=previous_year")
        .expect(200);

      expect(mockReportsService.getSpendingTrend).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          compare: "previous_year",
        })
      );
    });
  });

  describe("GET /api/reports/expenses/classification - Expense Classification", () => {
    it("should return expense classification (needs vs wants)", async () => {
      const mockClassification = {
        needs: 4000,
        wants: 2000,
        savings: 1000,
      };

      mockReportsService.getExpenseClassification.mockResolvedValue(mockClassification);

      const res = await request(app)
        .get("/api/reports/expenses/classification?from=2026-01-01&to=2026-01-31")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.needs).toBe(4000);
    });
  });

  describe("GET /api/reports/spending/subcategory - Subcategory Breakdown", () => {
    it("should return subcategory breakdown", async () => {
      const mockSubcategory = {
        items: [
          { subcategory: "Groceries", amount: 400 },
          { subcategory: "Restaurants", amount: 100 },
        ],
      };

      mockReportsService.getSubcategoryBreakdown.mockResolvedValue(mockSubcategory);

      const res = await request(app)
        .get("/api/reports/spending/subcategory?from=2026-01-01&to=2026-01-31")
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  // =========================================================================
  // NET WORTH REPORTS
  // =========================================================================

  describe("GET /api/reports/net-worth - Net Worth Report", () => {
    it("should return net worth history", async () => {
      const mockNetWorth = {
        snapshots: [
          { date: "2026-01-01", assets: 50000, liabilities: 10000, netWorth: 40000 },
          { date: "2026-01-31", assets: 51000, liabilities: 9500, netWorth: 41500 },
        ],
        current: { assets: 51000, liabilities: 9500, netWorth: 41500 },
      };

      mockReportsService.getNetWorth.mockResolvedValue(mockNetWorth);

      const res = await request(app)
        .get("/api/reports/net-worth?from=2026-01-01&to=2026-01-31")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.snapshots).toHaveLength(2);
      expect(mockReportsService.getNetWorth).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          from: "2026-01-01",
          to: "2026-01-31",
        })
      );
    });

    it("should accept includeArchived parameter", async () => {
      mockReportsService.getNetWorth.mockResolvedValue({ snapshots: [], current: {} });

      await request(app)
        .get("/api/reports/net-worth?from=2026-01-01&to=2026-01-31&includeArchived=true")
        .expect(200);

      expect(mockReportsService.getNetWorth).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          includeArchived: true,
        })
      );
    });

    it("should accept interval parameter (day or month)", async () => {
      mockReportsService.getNetWorth.mockResolvedValue({ snapshots: [], current: {} });

      await request(app)
        .get("/api/reports/net-worth?from=2026-01-01&to=2026-12-31&interval=month")
        .expect(200);

      expect(mockReportsService.getNetWorth).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          interval: "month",
        })
      );
    });
  });

  describe("GET /api/reports/net-worth/changes - Net Worth Changes", () => {
    it("should return net worth change breakdown", async () => {
      const mockChanges = {
        totalChange: 1500,
        breakdown: {
          marketGains: 800,
          contributions: 700,
        },
      };

      mockReportsService.getNetWorthChanges.mockResolvedValue(mockChanges);

      const res = await request(app)
        .get("/api/reports/net-worth/changes?from=2026-01-01&to=2026-01-31")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.totalChange).toBe(1500);
    });
  });

  // =========================================================================
  // ANALYTICS & VISUALIZATION
  // =========================================================================

  describe("GET /api/reports/sankey - Sankey Diagram", () => {
    it("should return sankey diagram data", async () => {
      const mockSankey = {
        nodes: [
          { id: "income", name: "Income", value: 10000 },
          { id: "food", name: "Food", value: 2000 },
        ],
        links: [
          { source: "income", target: "food", value: 2000 },
        ],
      };

      mockReportsService.getSankey.mockResolvedValue(mockSankey);

      const res = await request(app)
        .get("/api/reports/sankey?from=2026-01-01&to=2026-01-31")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.nodes).toBeDefined();
      expect(res.body.data.links).toBeDefined();
    });

    it("should accept mode parameter", async () => {
      mockReportsService.getSankey.mockResolvedValue({ nodes: [], links: [] });

      await request(app)
        .get("/api/reports/sankey?from=2026-01-01&to=2026-01-31&mode=expense_groups_to_categories")
        .expect(200);

      expect(mockReportsService.getSankey).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          mode: "expense_groups_to_categories",
        })
      );
    });

    it("should accept maxNodes parameter", async () => {
      mockReportsService.getSankey.mockResolvedValue({ nodes: [], links: [] });

      await request(app)
        .get("/api/reports/sankey?from=2026-01-01&to=2026-01-31&maxNodes=50")
        .expect(200);

      expect(mockReportsService.getSankey).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          maxNodes: 50,
        })
      );
    });

    it("should validate maxNodes range (5-200)", async () => {
      const res = await request(app)
        .get("/api/reports/sankey?from=2026-01-01&to=2026-01-31&maxNodes=300")
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  describe("GET /api/reports/ratios - Financial Ratios", () => {
    it("should return financial ratios", async () => {
      const mockRatios = {
        savingsRate: 35,
        debtToIncomeRatio: 0.25,
        expenseRatio: 0.65,
        liquidityRatio: 2.5,
      };

      mockReportsService.getFinancialRatios.mockResolvedValue(mockRatios);

      const res = await request(app)
        .get("/api/reports/ratios?from=2026-01-01&to=2026-01-31")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.savingsRate).toBe(35);
    });
  });

  describe("GET /api/reports/financial-ratios - Financial Ratios (Alias)", () => {
    it("should return financial ratios using alias endpoint", async () => {
      const mockRatios = {
        savingsRate: 35,
        debtToIncomeRatio: 0.25,
      };

      mockReportsService.getFinancialRatios.mockResolvedValue(mockRatios);

      const res = await request(app)
        .get("/api/reports/financial-ratios?from=2026-01-01&to=2026-01-31")
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  describe("GET /api/reports/debt - Debt Analysis", () => {
    it("should return debt analysis", async () => {
      const mockDebt = {
        totalDebt: 10000,
        byAccount: [
          { account: "Credit Card", balance: 5000, apr: 18.99 },
        ],
      };

      mockReportsService.getDebtAnalysis.mockResolvedValue(mockDebt);

      const res = await request(app)
        .get("/api/reports/debt?from=2026-01-01&to=2026-01-31")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.totalDebt).toBe(10000);
    });
  });

  describe("GET /api/reports/forecast - Forecast", () => {
    it("should return financial forecast", async () => {
      const mockForecast = {
        projections: [
          { month: "2026-02", predicted: 42000, confidence: 0.85 },
          { month: "2026-03", predicted: 43500, confidence: 0.80 },
        ],
      };

      mockReportsService.getForecast.mockResolvedValue(mockForecast);

      const res = await request(app)
        .get("/api/reports/forecast?metric=net-worth&projectionMonths=6")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.projections).toBeDefined();
    });

    it("should validate metric parameter is required", async () => {
      const res = await request(app)
        .get("/api/reports/forecast?projectionMonths=6")
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should validate projectionMonths range (1-60)", async () => {
      const res = await request(app)
        .get("/api/reports/forecast?metric=net-worth&projectionMonths=100")
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // DRILLDOWNS & CUSTOM CHARTS
  // =========================================================================

  describe("GET /api/reports/transactions - Transaction Drilldown", () => {
    it("should return filtered transactions", async () => {
      const mockTransactions = {
        transactions: [
          { id: "txn-1", date: "2026-01-15", merchant: "Store A", amount: 50 },
          { id: "txn-2", date: "2026-01-20", merchant: "Store B", amount: 75 },
        ],
        total: 2,
        hasMore: false,
      };

      mockReportsService.getTransactions.mockResolvedValue(mockTransactions);

      const res = await request(app)
        .get("/api/reports/transactions?from=2026-01-01&to=2026-01-31")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.transactions).toHaveLength(2);
    });

    it("should accept filter parameters (categoryId, merchantId, accountId)", async () => {
      mockReportsService.getTransactions.mockResolvedValue({ transactions: [], total: 0 });

      await request(app)
        .get(`/api/reports/transactions?from=2026-01-01&to=2026-01-31&categoryId=${CATEGORY_ID}&merchantId=${MERCHANT_ID}`)
        .expect(200);

      expect(mockReportsService.getTransactions).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          categoryId: CATEGORY_ID,
          merchantId: MERCHANT_ID,
        })
      );
    });

    it("should accept pagination parameters (limit, cursor)", async () => {
      mockReportsService.getTransactions.mockResolvedValue({ transactions: [], total: 0 });

      await request(app)
        .get("/api/reports/transactions?from=2026-01-01&to=2026-01-31&limit=50&cursor=abc123")
        .expect(200);

      expect(mockReportsService.getTransactions).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          limit: 50,
          cursor: "abc123",
        })
      );
    });

    it("should accept search parameter", async () => {
      mockReportsService.getTransactions.mockResolvedValue({ transactions: [], total: 0 });

      await request(app)
        .get("/api/reports/transactions?from=2026-01-01&to=2026-01-31&search=coffee")
        .expect(200);

      expect(mockReportsService.getTransactions).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          search: "coffee",
        })
      );
    });

    it("should validate search max length (200)", async () => {
      const longSearch = "a".repeat(201);
      const res = await request(app)
        .get(`/api/reports/transactions?from=2026-01-01&to=2026-01-31&search=${longSearch}`)
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  describe("GET /api/reports/goals/progress - Goals Progress", () => {
    it("should return goals progress", async () => {
      const mockProgress = {
        goals: [
          { id: "goal-1", name: "Emergency Fund", progress: 75, target: 10000, current: 7500 },
        ],
      };

      mockReportsService.getGoalsProgress.mockResolvedValue(mockProgress);

      const res = await request(app)
        .get("/api/reports/goals/progress")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.goals).toBeDefined();
    });

    it("should accept year parameter", async () => {
      mockReportsService.getGoalsProgress.mockResolvedValue({ goals: [] });

      await request(app)
        .get("/api/reports/goals/progress?year=2026")
        .expect(200);

      expect(mockReportsService.getGoalsProgress).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          year: 2026,
        })
      );
    });
  });

  describe("GET /api/reports/custom - Custom Chart (Query)", () => {
    it.each(["monthly", "quarterly", "biannual", "annual"])(
      "accepts %s from the original builder request",
      async period => {
        mockReportsService.executeCustomChart.mockResolvedValue({ data: [] });

        await request(app).get("/api/reports/custom").query({
          chartType: "bar", primaryMetric: "expenses", groupBy: "category",
          from: "2026-01-01", to: "2026-12-31", aggregation: period,
        }).expect(200);

        expect(mockReportsService.executeCustomChart).toHaveBeenCalledWith(
          "house-123", "user-123",
          expect.objectContaining({ config: expect.objectContaining({ period, aggregation: undefined }) }),
        );
      },
    );

    it.each(["monthly", "quarterly", "biannual", "annual"])(
      "passes the %s period independently of the aggregation operation on both verbs",
      async period => {
        mockReportsService.executeCustomChart.mockResolvedValue({ data: [] });
        const chart = {
          chartType: "bar", primaryMetric: "expenses", aggregation: "sum",
          from: "2026-01-01", to: "2026-12-31", period,
        };

        await request(app).get("/api/reports/custom").query(chart).expect(200);
        await request(app).post("/api/reports/custom").send(chart).expect(200);

        const execution = expect.objectContaining({
          config: expect.objectContaining({ period, aggregation: "sum" }),
        });
        expect(mockReportsService.executeCustomChart).toHaveBeenNthCalledWith(
          1, "house-123", "user-123", execution,
        );
        expect(mockReportsService.executeCustomChart).toHaveBeenNthCalledWith(
          2, "house-123", "user-123", execution,
        );
      },
    );

    it("rejects an operation supplied as a time period", async () => {
      await request(app).get("/api/reports/custom").query({
        chartType: "bar", primaryMetric: "expenses", period: "sum",
        from: "2026-01-01", to: "2026-12-31",
      }).expect(400);
      expect(mockReportsService.executeCustomChart).not.toHaveBeenCalled();
    });

    it.each([
      { primaryMetric: "netWorth", groupBy: "category" },
      { primaryMetric: "savingsContributions" },
    ])("rejects custom-chart inputs that cannot produce the named values (%j)", async invalid => {
      const chart = { chartType: "line", from: "2026-01-01", to: "2026-12-31", period: "quarterly", ...invalid };
      await request(app).get("/api/reports/custom").query(chart).expect(400);
      await request(app).post("/api/reports/custom").send(chart).expect(400);
      expect(mockReportsService.executeCustomChart).not.toHaveBeenCalled();
    });

    it("should execute custom chart from query params", async () => {
      const mockChart = {
        data: [
          { label: "Jan", value: 1000 },
          { label: "Feb", value: 1200 },
        ],
      };

      mockReportsService.executeCustomChart.mockResolvedValue(mockChart);

      const res = await request(app)
        .get("/api/reports/custom?chartType=bar&primaryMetric=expenses&from=2026-01-01&to=2026-02-28")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.data).toBeDefined();
    });

    it("should validate required chartType parameter", async () => {
      const res = await request(app)
        .get("/api/reports/custom?primaryMetric=amount&from=2026-01-01&to=2026-02-28")
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should validate chartType enum values", async () => {
      const res = await request(app)
        .get("/api/reports/custom?chartType=invalid&primaryMetric=amount&from=2026-01-01&to=2026-02-28")
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  describe("POST /api/reports/custom - Custom Chart (Body)", () => {
    it("should execute custom chart from request body", async () => {
      const mockChart = {
        data: [
          { label: "Category A", value: 500 },
          { label: "Category B", value: 300 },
        ],
      };

      mockReportsService.executeCustomChart.mockResolvedValue(mockChart);

      const res = await request(app)
        .post("/api/reports/custom")
        .send({
          name: "My Custom Chart",
          chartType: "pie",
          primaryMetric: "expenses",
          groupBy: "category",
          from: "2026-01-01",
          to: "2026-01-31",
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockReportsService.executeCustomChart).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          config: expect.objectContaining({
            chartType: "pie",
            primaryMetric: "expenses",
          }),
        })
      );
    });

    it("should validate required fields in body", async () => {
      const res = await request(app)
        .post("/api/reports/custom")
        .send({
          chartType: "bar",
          // Missing primaryMetric, from, to
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should accept optional secondaryMetric", async () => {
      mockReportsService.executeCustomChart.mockResolvedValue({ data: [] });

      await request(app)
        .post("/api/reports/custom")
        .send({
          chartType: "line",
          primaryMetric: "income",
          secondaryMetric: "expenses",
          from: "2026-01-01",
          to: "2026-01-31",
        })
        .expect(200);

      expect(mockReportsService.executeCustomChart).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          config: expect.objectContaining({
            secondaryMetric: "expenses",
          }),
        })
      );
    });
  });

  // =========================================================================
  // EXPORTS
  // =========================================================================

  describe("GET /api/reports/exports - List Exports", () => {
    it("should return list of exports", async () => {
      const mockExports = [
        { id: "export-1", reportType: "spending", status: "completed", createdAt: "2026-01-15" },
        { id: "export-2", reportType: "cashflow", status: "pending", createdAt: "2026-01-20" },
      ];

      mockExportMetadata.list.mockResolvedValue(mockExports);

      const res = await request(app)
        .get("/api/reports/exports")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(mockExportMetadata.list).toHaveBeenCalledWith(DEFAULT_GUARD_CONTEXT,
        expect.objectContaining({ snapshot: { id: "user-123" } }), {});
    });

    it("should accept status filter", async () => {
      mockExportMetadata.list.mockResolvedValue([]);

      await request(app)
        .get("/api/reports/exports?status=completed")
        .expect(200);

      expect(mockExportMetadata.list).toHaveBeenCalledWith(
        DEFAULT_GUARD_CONTEXT, expect.any(Object), expect.objectContaining({ status: "completed" })
      );
    });

    it("should accept limit parameter", async () => {
      mockExportMetadata.list.mockResolvedValue([]);

      await request(app)
        .get("/api/reports/exports?limit=50")
        .expect(200);

      expect(mockExportMetadata.list).toHaveBeenCalledWith(
        DEFAULT_GUARD_CONTEXT, expect.any(Object), expect.objectContaining({ limit: 50 })
      );
    });
  });

  describe("POST /api/reports/exports - Create Export", () => {
    it("uses the current authorized source cut for transaction export production", async () => {
      mockReportExportCreation.mockResolvedValue({ id: "export-transactions", status: "completed" });
      await request(app).post("/api/reports/exports").send({ reportType: "transactions", format: "csv",
        startDate: "2026-01-01", endDate: "2026-01-31", scope: "mine" }).expect(200);
      expect(mockReportExportCreation).toHaveBeenCalledWith(DEFAULT_GUARD_CONTEXT,
        expect.objectContaining({ snapshot: { id: "user-123" } }), "mine",
        expect.objectContaining({ reportType: "transactions", includePending: true }), "127.0.0.1");
    });
    it("should create a new export job", async () => {
      const mockExport = {
        id: "export-123",
        reportType: "spending",
        status: "pending",
        createdAt: "2026-01-29",
      };

      mockReportExportCreation.mockResolvedValue(mockExport);

      const res = await request(app)
        .post("/api/reports/exports")
        .send({
          reportType: "spending",
          format: "csv",
          startDate: "2026-01-01",
          endDate: "2026-01-31",
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe("export-123");
      // Non-transaction exports use the same current-grant authority boundary.
      expect(mockReportExportCreation).toHaveBeenCalledWith(DEFAULT_GUARD_CONTEXT,
        expect.objectContaining({ snapshot: { id: "user-123" } }), "household",
        expect.objectContaining({ reportType: "spending" }), "127.0.0.1");
    });

    it("should reject unsupported format (not CSV)", async () => {
      const res = await request(app)
        .post("/api/reports/exports")
        .send({
          reportType: "spending",
          format: "pdf",
          startDate: "2026-01-01",
          endDate: "2026-01-31",
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("UNSUPPORTED_FORMAT");
    });

    it("should validate required fields", async () => {
      const res = await request(app)
        .post("/api/reports/exports")
        .send({
          format: "csv",
          // Missing reportType, startDate, endDate
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  describe("GET /api/reports/exports/:id - Get Export", () => {
    it("should return export by id", async () => {
      const mockExport = {
        id: EXPORT_ID,
        userId: "user-123",
        reportType: "spending",
        status: "completed",
        fileUrl: "https://example.com/export.csv",
      };

      mockReportsExportService.getExportById.mockResolvedValue(mockExport);
      mockExportMetadata.read.mockResolvedValue(mockExport);

      const res = await request(app)
        .get(`/api/reports/exports/${EXPORT_ID}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(EXPORT_ID);
      expect(mockExportMetadata.read).toHaveBeenCalledWith(DEFAULT_GUARD_CONTEXT, expect.any(Object), EXPORT_ID);
    });

    it("should return 404 for non-existent export", async () => {
      mockReportsExportService.getExportById.mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/reports/exports/${EXPORT_ID}`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("should reject access to other user's export (non-admin)", async () => {
      // A non-admin may only see their own export; force a viewer context.
      guardContext.value = {
        householdId: "house-123",
        userId: "user-viewer",
        role: "viewer",
      };
      const mockExport = {
        id: EXPORT_ID,
        userId: "other-user",
        reportType: "spending",
        status: "completed",
      };

      mockReportsExportService.getExportById.mockResolvedValue(mockExport);
      mockExportMetadata.read.mockRejectedValueOnce(new ForbiddenError("Report access unavailable"));

      const res = await request(app)
        .get(`/api/reports/exports/${EXPORT_ID}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });
  });

  // =========================================================================
  // AUTHORIZATION & SCOPE TESTS
  // =========================================================================

  describe("Authorization - Report Scope", () => {
    it("should default to household scope for admin users", async () => {
      mockReportsService.getCashflow.mockResolvedValue({ periods: [], totals: {} });

      await request(app)
        .get("/api/reports/cashflow?from=2026-01-01&to=2026-01-31")
        .expect(200);

      expect(mockReportsService.getCashflow).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          scope: "household",
        })
      );
    });

    it("should allow explicit mine scope for any user", async () => {
      mockReportsService.getCashflow.mockResolvedValue({ periods: [], totals: {} });

      await request(app)
        .get("/api/reports/cashflow?from=2026-01-01&to=2026-01-31&scope=mine")
        .expect(200);

      expect(mockReportsService.getCashflow).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          scope: "mine",
        })
      );
    });
  });

  describe("Authorization - Non-Admin User", () => {
    it("should reject household scope for non-admin users", async () => {
      // A viewer cannot request household-wide scope.
      guardContext.value = {
        householdId: "house-123",
        userId: "user-viewer",
        role: "viewer",
      };

      const res = await request(app)
        .get("/api/reports/cashflow?from=2026-01-01&to=2026-01-31&scope=household")
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });
  });

  // =========================================================================
  // HOUSEHOLD ISOLATION TESTS
  // =========================================================================

  describe("Household Isolation", () => {
    it("should only return data for user's household", async () => {
      mockReportsService.getCashflow.mockResolvedValue({ periods: [], totals: {} });

      await request(app)
        .get("/api/reports/cashflow?from=2026-01-01&to=2026-01-31")
        .expect(200);

      // Verify service was called with correct householdId
      expect(mockReportsService.getCashflow).toHaveBeenCalledWith(
        "house-123", // User's household
        expect.any(String),
        expect.any(Object)
      );
    });

    it("should not allow cross-household data access", async () => {
      // Service should only receive the authenticated household ID
      mockReportsService.getNetWorth.mockResolvedValue({ snapshots: [], current: {} });

      await request(app)
        .get("/api/reports/net-worth?from=2026-01-01&to=2026-01-31&householdId=other-house")
        .expect(200);

      // householdId in query should be ignored - service gets it from context
      expect(mockReportsService.getNetWorth).toHaveBeenCalledWith(
        "house-123", // From context, not query
        "user-123",
        expect.objectContaining({
          from: "2026-01-01",
          to: "2026-01-31",
        })
      );
    });
  });

  // =========================================================================
  // CACHE ISOLATION TESTS (REPORTS-TEST-001)
  // =========================================================================

  describe("Cache Isolation Between Users", () => {
    it("should pass userId in params for all cached endpoints", async () => {
      mockReportsService.getCashflow.mockResolvedValue({ periods: [], totals: {} });

      await request(app)
        .get("/api/reports/cashflow?from=2026-01-01&to=2026-01-31")
        .expect(200);

      // Verify userId is passed to service (which passes it to cache)
      expect(mockReportsService.getCashflow).toHaveBeenCalledWith(
        "house-123",
        "user-123", // userId must be in cache key
        expect.objectContaining({
          from: "2026-01-01",
          to: "2026-01-31",
        })
      );
    });

    it("should include scope in cache key to prevent cross-scope pollution", async () => {
      mockReportsService.getSpendingBreakdown.mockResolvedValue({ items: [], total: 0 });

      // First request with household scope
      await request(app)
        .get("/api/reports/spending/breakdown?from=2026-01-01&to=2026-01-31&scope=household")
        .expect(200);

      expect(mockReportsService.getSpendingBreakdown).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          scope: "household",
        })
      );

      // Second request with mine scope - should get different cache entry
      await request(app)
        .get("/api/reports/spending/breakdown?from=2026-01-01&to=2026-01-31&scope=mine")
        .expect(200);

      expect(mockReportsService.getSpendingBreakdown).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          scope: "mine",
        })
      );
    });

    it("should include filter params in cache key", async () => {
      mockReportsService.getTransactions.mockResolvedValue({ transactions: [], total: 0 });

      // Request with categoryId filter
      await request(app)
        .get(`/api/reports/transactions?from=2026-01-01&to=2026-01-31&categoryId=${CATEGORY_ID}`)
        .expect(200);

      expect(mockReportsService.getTransactions).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          categoryId: CATEGORY_ID,
        })
      );

      // Request with different categoryId - should be different cache entry
      mockReportsService.getTransactions.mockClear();
      await request(app)
        .get(`/api/reports/transactions?from=2026-01-01&to=2026-01-31&categoryId=${CATEGORY_ID_2}`)
        .expect(200);

      expect(mockReportsService.getTransactions).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          categoryId: CATEGORY_ID_2,
        })
      );
    });

    it("should ensure different users in same household get separate cache for mine scope", async () => {
      mockReportsService.getNetWorth.mockResolvedValue({ snapshots: [], current: {} });

      // User 1 requests their own data
      await request(app)
        .get("/api/reports/net-worth?from=2026-01-01&to=2026-01-31&scope=mine")
        .expect(200);

      expect(mockReportsService.getNetWorth).toHaveBeenCalledWith(
        "house-123",
        "user-123", // User 1's ID in cache key
        expect.objectContaining({
          scope: "mine",
        })
      );
    });
  });

  // =========================================================================
  // AUTHORIZATION BOUNDARY TESTS (REPORTS-TEST-001)
  // =========================================================================

  describe("Authorization - User Can Only See Own Reports", () => {
    it("should enforce scope=mine returns only user's transactions", async () => {
      const mockTransactions = {
        transactions: [
          {
            id: "txn-1",
            ownerUserId: "user-123",
            amount: "100.00",
            date: "2026-01-15",
          },
          // No transactions from other users should be in result
        ],
        total: 1,
      };

      mockReportsService.getTransactions.mockResolvedValue(mockTransactions);

      const res = await request(app)
        .get("/api/reports/transactions?from=2026-01-01&to=2026-01-31&scope=mine")
        .expect(200);

      expect(res.body.success).toBe(true);
      // userId is the 2nd positional arg (above), not part of the options object.
      expect(mockReportsService.getTransactions).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          scope: "mine",
        })
      );
    });

    it("should verify userId is passed to all report endpoints", async () => {
      const endpoints = [
        { path: "/api/reports/cashflow?from=2026-01-01&to=2026-01-31", method: "getCashflow" },
        { path: "/api/reports/spending/breakdown?from=2026-01-01&to=2026-01-31", method: "getSpendingBreakdown" },
        { path: "/api/reports/net-worth?from=2026-01-01&to=2026-01-31", method: "getNetWorth" },
        { path: "/api/reports/annual?year=2026", method: "getAnnual" },
        { path: "/api/reports/sankey?from=2026-01-01&to=2026-01-31", method: "getSankey" },
      ];

      for (const endpoint of endpoints) {
        const mockFn = (mockReportsService as any)[endpoint.method];
        mockFn.mockResolvedValue({ /* mock data */ });

        await request(app)
          .get(endpoint.path)
          .expect(200);

        expect(mockFn).toHaveBeenCalledWith(
          "house-123",
          "user-123", // userId must be passed
          expect.any(Object)
        );

        mockFn.mockClear();
      }
    });

    it("should prevent access to private transactions of other users", async () => {
      const mockTransactions = {
        transactions: [
          {
            id: "txn-1",
            ownerUserId: "user-123",
            isPrivate: false,
            amount: "100.00",
          },
          // Private transactions from other users should be filtered in repository
        ],
        total: 1,
      };

      mockReportsService.getTransactions.mockResolvedValue(mockTransactions);

      const res = await request(app)
        .get("/api/reports/transactions?from=2026-01-01&to=2026-01-31&scope=household")
        .expect(200);

      expect(res.body.success).toBe(true);
      // Privacy filtering uses the userId passed as the 2nd positional arg below;
      // the options object carries the request scope.
      expect(mockReportsService.getTransactions).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          scope: "household",
        })
      );
    });
  });

  // =========================================================================
  // DATE RANGE VALIDATION
  // =========================================================================

  describe("Date Range Validation", () => {
    it("should accept valid date range", async () => {
      mockReportsService.getCashflow.mockResolvedValue({ periods: [], totals: {} });

      const res = await request(app)
        .get("/api/reports/cashflow?from=2026-01-01&to=2026-12-31")
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it("should accept startDate/endDate as aliases for from/to", async () => {
      mockReportsService.getCashflow.mockResolvedValue({ periods: [], totals: {} });

      const res = await request(app)
        .get("/api/reports/cashflow?startDate=2026-01-01&endDate=2026-01-31")
        .expect(200);

      expect(res.body.success).toBe(true);
      // Should be converted to from/to internally
      expect(mockReportsService.getCashflow).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          from: "2026-01-01",
          to: "2026-01-31",
        })
      );
    });

    it("should validate invalid date format", async () => {
      const res = await request(app)
        .get("/api/reports/cashflow?from=2026/01/01&to=2026-01-31")
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("should validate date is valid (not 2026-02-30)", async () => {
      const res = await request(app)
        .get("/api/reports/cashflow?from=2026-02-30&to=2026-03-01")
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // RESPONSE FORMAT VALIDATION
  // =========================================================================

  describe("Response Format Validation", () => {
    it("should return success response with data field", async () => {
      mockReportsService.getCashflow.mockResolvedValue({ periods: [], totals: {} });

      const res = await request(app)
        .get("/api/reports/cashflow?from=2026-01-01&to=2026-01-31")
        .expect(200);

      expect(res.body).toHaveProperty("success");
      expect(res.body).toHaveProperty("data");
      expect(res.body.success).toBe(true);
    });

    it("should return error response with code and message", async () => {
      const res = await request(app)
        .get("/api/reports/cashflow")
        .expect(400);

      expect(res.body).toHaveProperty("success");
      expect(res.body).toHaveProperty("error");
      expect(res.body.success).toBe(false);
      expect(res.body.error).toHaveProperty("code");
      expect(res.body.error).toHaveProperty("message");
    });
  });

  // =========================================================================
  // ERROR HANDLING
  // =========================================================================

  describe("Error Handling", () => {
    it("should handle service errors gracefully", async () => {
      mockReportsService.getCashflow.mockRejectedValue(new Error("Database error"));

      const res = await request(app)
        .get("/api/reports/cashflow?from=2026-01-01&to=2026-01-31")
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("INTERNAL_ERROR");
    });

    it("should handle validation errors from service", async () => {
      const validationError = new Error("Invalid date range");
      validationError.name = "ValidationError";
      mockReportsService.getCashflow.mockRejectedValue(validationError);

      const res = await request(app)
        .get("/api/reports/cashflow?from=2026-01-01&to=2026-01-31")
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("should return 400 for malformed JSON in POST request", async () => {
      const res = await request(app)
        .post("/api/reports/custom")
        .set("Content-Type", "application/json")
        .send("{ invalid json")
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should handle missing household context", async () => {
      // Simulate the guard not populating a household context at all.
      guardContext.value = null;

      const res = await request(app)
        .get("/api/reports/cashflow?from=2026-01-01&to=2026-01-31")
        .expect(500);

      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // EDGE CASES & SPECIAL SCENARIOS
  // =========================================================================

  describe("Edge Cases", () => {
    it("should handle empty result sets", async () => {
      mockReportsService.getTransactions.mockResolvedValue({
        transactions: [],
        total: 0,
        hasMore: false,
      });

      const res = await request(app)
        .get("/api/reports/transactions?from=2026-01-01&to=2026-01-31")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.transactions).toEqual([]);
    });

    it("should handle very long date ranges", async () => {
      mockReportsService.getCashflow.mockResolvedValue({ periods: [], totals: {} });

      const res = await request(app)
        .get("/api/reports/cashflow?from=2024-01-01&to=2026-12-31")
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it("should handle same from and to date", async () => {
      mockReportsService.getCashflow.mockResolvedValue({ periods: [], totals: {} });

      const res = await request(app)
        .get("/api/reports/cashflow?from=2026-01-15&to=2026-01-15")
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it("should handle special characters in search query", async () => {
      mockReportsService.getTransactions.mockResolvedValue({ transactions: [], total: 0 });

      const res = await request(app)
        .get("/api/reports/transactions?from=2026-01-01&to=2026-01-31&search=caf%C3%A9")
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it("should handle multiple filter parameters together", async () => {
      mockReportsService.getSpendingBreakdown.mockResolvedValue({ items: [], total: 0 });

      const res = await request(app)
        .get("/api/reports/spending/breakdown?from=2026-01-01&to=2026-01-31&groupBy=category&limit=20&type=expense&includePending=true")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockReportsService.getSpendingBreakdown).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          groupBy: "category",
          limit: 20,
          type: "expense",
          includePending: true,
        })
      );
    });
  });

  // =========================================================================
  // QUERY PARAMETER COERCION
  // =========================================================================

  describe("Query Parameter Type Coercion", () => {
    it("should coerce boolean strings to booleans", async () => {
      mockReportsService.getCashflow.mockResolvedValue({ periods: [], totals: {} });

      await request(app)
        .get("/api/reports/cashflow?from=2026-01-01&to=2026-01-31&includePending=true&includeTransfers=false")
        .expect(200);

      expect(mockReportsService.getCashflow).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          includePending: true,
          includeTransfers: false,
        })
      );
    });

    it("should coerce numeric strings to numbers", async () => {
      mockReportsService.getAnnual.mockResolvedValue({ year: 2026, totalIncome: 0, totalExpenses: 0, netSavings: 0, savingsRate: 0, monthlyBreakdown: [] });

      await request(app)
        .get("/api/reports/annual?year=2026")
        .expect(200);

      expect(mockReportsService.getAnnual).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          year: 2026, // Number, not string
        })
      );
    });
  });
});
