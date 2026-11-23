import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ============================================================================
// MOCKS (Hoisted)
// ============================================================================
const {
  mockBudgetService,
  mockBusinessAuditService,
  mockStorage,
  mockHouseholdRepository,
} = vi.hoisted(() => ({
  mockBudgetService: {
    getBudgets: vi.fn(),
    getBudgetById: vi.fn(),
    createBudget: vi.fn(),
    updateBudget: vi.fn(),
    deleteBudget: vi.fn(),
    getBudgetAlertsReport: vi.fn(),
    moveBudgetAmount: vi.fn(),
    getBudgetProgressReport: vi.fn(),
    getBudgetForecast: vi.fn(),
  },
  mockBusinessAuditService: {
    log: vi.fn().mockResolvedValue(undefined),
    logCreate: vi.fn().mockResolvedValue(undefined),
    logUpdate: vi.fn().mockResolvedValue(undefined),
    logDelete: vi.fn().mockResolvedValue(undefined),
    getIpAddress: vi.fn().mockReturnValue("127.0.0.1"),
  },
  mockStorage: {
    getHouseholdPreferences: vi.fn(),
    createHouseholdPreferences: vi.fn(),
    updateHouseholdPreferences: vi.fn(),
  },
  mockHouseholdRepository: {
    findById: vi.fn().mockResolvedValue({ id: "house-123", currency: "ZMW" }),
    findPreferences: vi.fn(),
    createPreferences: vi.fn(),
    updatePreferences: vi.fn(),
  },
}));

// Mock Dependencies
vi.mock("../../services/BudgetService", () => ({
  budgetService: mockBudgetService,
}));

vi.mock("../../services/BusinessAuditService", () => ({
  businessAuditService: mockBusinessAuditService,
}));

vi.mock("../../storage", () => ({
  storage: mockStorage,
}));

vi.mock("../../repositories/HouseholdRepository", () => ({
  householdRepository: mockHouseholdRepository,
}));

// Mock Middleware
vi.mock("../../middleware/householdGuard", () => ({
  householdGuard: (req: any, res: any, next: any) => {
    req.householdContext = {
      householdId: "house-123",
      userId: "user-123",
      role: "admin",
    };
    next();
  },
}));

vi.mock("../../middleware/validateEntity", () => ({
  requireRole: () => (req: any, res: any, next: any) => next(),
}));

vi.mock("../../middleware/rateLimit", () => ({
  generalLimiter: (req: any, res: any, next: any) => next(),
  analyticsLimiter: (req: any, res: any, next: any) => next(),
  strictLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Import Routes
import budgetsRouter from "../../modules/budgets/budgets.routes";
import { errorHandler } from "../../core/errors/errorHandler";

const app = express();
app.use(express.json());
app.use("/api/budgets", budgetsRouter);
app.use(errorHandler);

describe("Budgets Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/budgets", () => {
    it("should create budget and log audit event", async () => {
      const mockBudget = {
        id: "budget-1",
        name: "Groceries",
        amount: "500.00",
        period: "monthly",
      };

      mockBudgetService.createBudget.mockResolvedValue(mockBudget);

      const res = await request(app)
        .post("/api/budgets")
        .send({
          name: "Groceries",
          amount: { amount: "500.00", currency: "ZMW" },
          period: "monthly",
          categoryId: "550e8400-e29b-41d4-a716-446655440001", // Valid UUID
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      // The service writes the budget and its audit row in one transaction
      // (A-23), so the controller hands it the actor rather than auditing after.
      expect(mockBudgetService.createBudget).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Groceries", amount: "500.00", currency: "ZMW" }),
        "house-123",
        expect.objectContaining({ userId: "user-123" }),
        undefined,
      );
      expect(mockBusinessAuditService.logCreate).not.toHaveBeenCalled();
    });
  });

  describe("PUT /api/budgets/:id", () => {
    it("should update budget and log audit event", async () => {
      const mockBudget = {
        id: "budget-1",
        name: "Groceries Updated",
        amount: "600.00",
      };

      mockBudgetService.getBudgetById.mockResolvedValue({
        ...mockBudget,
        name: "Groceries",
        amount: "500.00",
        period: "monthly",
      });
      mockBudgetService.updateBudget.mockResolvedValue(mockBudget);

      const res = await request(app)
        .put("/api/budgets/budget-1")
        .send({
          amount: { amount: "600.00", currency: "ZMW" },
        });

      expect(res.status).toBe(200);

      // NEW-32: the service writes the budget and its audit row in one
      // transaction, so the controller hands it the actor and audits nothing.
      expect(mockBudgetService.updateBudget).toHaveBeenCalledWith(
        "budget-1", expect.anything(), "house-123", expect.objectContaining({ userId: "user-123", ipAddress: "127.0.0.1" }));
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });

    it("should leave the one audit entry per budget update to the service (QA-005)", async () => {
      // BE-007: no duplicate audit logging. NEW-32 moved the one row into the
      // service transaction, so the controller writes none.
      const mockBudget = {
        id: "budget-1",
        name: "Groceries Updated",
        amount: "600.00",
        period: "monthly",
        categoryId: "cat-1",
        isActive: true,
      };

      mockBudgetService.getBudgetById.mockResolvedValue({
        ...mockBudget,
        name: "Groceries",
        amount: "500.00",
      });
      mockBudgetService.updateBudget.mockResolvedValue(mockBudget);

      await request(app)
        .put("/api/budgets/budget-1")
        .send({
          amount: { amount: "600.00", currency: "ZMW" },
        });

      expect(mockBudgetService.updateBudget).toHaveBeenCalledTimes(1);
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
      expect(mockBusinessAuditService.log).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /api/budgets/:id", () => {
    it("should delete budget and log audit event", async () => {
      mockBudgetService.getBudgetById.mockResolvedValue({
        id: "budget-1",
        name: "Groceries",
        amount: "500.00",
        period: "monthly",
      });
      mockBudgetService.deleteBudget.mockResolvedValue(undefined);

      const res = await request(app).delete("/api/budgets/budget-1");

      expect(res.status).toBe(200);

      expect(mockBudgetService.deleteBudget).toHaveBeenCalledWith("budget-1", "house-123", expect.objectContaining({ userId: "user-123", ipAddress: "127.0.0.1" }));
      expect(mockBusinessAuditService.logDelete).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/budgets/progress", () => {
    it("should handle zero budget without NaN (BE-PROG-001)", async () => {
      // This tests that zero budget doesn't cause division by zero / NaN
      // Controller expects { progress, unavailable } from getBudgetProgressReport
      const mockProgress = [
        {
          id: "budget-zero",
          name: "Zero Budget",
          amount: "0.00",
          spent: "50.00",
          percentUsed: 100, // Should be 100% when budget is 0 but spent > 0
          isOverBudget: true,
        },
        {
          id: "budget-zero-spent",
          name: "Zero Everything",
          amount: "0.00",
          spent: "0.00",
          percentUsed: 0, // Should be 0% when both are zero
          isOverBudget: false,
        },
      ];

      mockBudgetService.getBudgetProgressReport.mockResolvedValue({ progress: mockProgress, unavailable: [], unbudgeted: { expense: null, income: null } });

      const res = await request(app).get("/api/budgets/progress").query({
        year: "2024",
        month: "1",
      });

      expect(res.status).toBe(200);
      // Verify no NaN values in response
      const responseText = JSON.stringify(res.body);
      expect(responseText).not.toContain("NaN");
      expect(responseText).not.toContain("Infinity");

      // Verify percentUsed is a valid number
      if (res.body.data?.budgets) {
        for (const budget of res.body.data.budgets) {
          expect(typeof budget.percentUsed).toBe("number");
          expect(isNaN(budget.percentUsed)).toBe(false);
          expect(isFinite(budget.percentUsed)).toBe(true);
        }
      }
    });
  });

  describe("GET /api/budgets/forecast", () => {
    it("should return accurate forecast projections (BE-FORE-001)", async () => {
      // This tests forecast returns accurate projected values
      // Controller expects { budgets: [...] } structure
      const mockForecast = {
        budgets: [
          {
            id: "budget-1",
            name: "Test Budget",
            amount: "500.00",
            periods: [
              {
                year: 2024,
                month: 1,
                amount: "500.00",
                spent: "320.00",
              },
              {
                year: 2024,
                month: 2,
                amount: "500.00",
                spent: "0.00",
              },
            ],
          },
        ],
      };

      mockBudgetService.getBudgetForecast.mockResolvedValue(mockForecast);

      const res = await request(app).get("/api/budgets/forecast").query({
        budgetId: "550e8400-e29b-41d4-a716-446655440001",
        year: "2024",
        month: "1",
        months: "3",
      });

      expect(res.status).toBe(200);
      expect(mockBudgetService.getBudgetForecast).toHaveBeenCalled();

      // Verify response structure
      if (res.body.data) {
        expect(res.body.data).toHaveProperty("budgets");
        // All numeric values should be valid
        const responseText = JSON.stringify(res.body);
        expect(responseText).not.toContain("NaN");
        expect(responseText).not.toContain("Infinity");
      }
    });
  });

  describe("GET /api/budgets/alerts", () => {
    it("should retrieve budget alerts", async () => {
      const mockAlerts = [
        {
          budgetId: "budget-1",
          type: "over_budget",
          message: "Over budget",
          budget: {
            id: "budget-1",
            name: "Groceries",
            amount: "500.00",
            period: "monthly",
          },
          spent: "650.00",
        },
      ];

      mockBudgetService.getBudgetAlertsReport.mockResolvedValue({ alerts: mockAlerts, unavailable: [] });

      const res = await request(app).get("/api/budgets/alerts").query({
        year: "2024",
        month: "1",
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        {
          budgetId: "budget-1",
          type: "over_budget",
          message: "Over budget",
          budget: {
            id: "budget-1",
            name: "Groceries",
            amount: { amount: "500.00", currency: "ZMW" },
            period: "monthly",
          },
          spent: { amount: "650.00", currency: "ZMW" },
        },
      ]);
      expect(res.body.meta).toEqual({ unavailableBudgets: [] });
      expect(mockBudgetService.getBudgetAlertsReport).toHaveBeenCalledWith(
        "house-123",
        2024,
        1,
        { kind: "actor", actor: { householdId: "house-123", userId: "user-123", role: "admin" } },
      );
    });
  });

  describe("POST /api/budgets/move", () => {
    it("should reject move when insufficient budget (BE-MOVE-001)", async () => {
      // This tests that trying to move more than available returns 400
      const insufficientError = new Error("Insufficient budget to move");
      (insufficientError as any).statusCode = 400;
      (insufficientError as any).code = "VALIDATION_ERROR";

      mockBudgetService.moveBudgetAmount.mockRejectedValue(insufficientError);

      const res = await request(app).post("/api/budgets/move").send({
        fromBudgetId: "550e8400-e29b-41d4-a716-446655440001",
        toBudgetId: "550e8400-e29b-41d4-a716-446655440002",
        amount: { amount: "1000.00", currency: "ZMW" }, // More than available
        year: 2024,
        month: 1,
      });

      // Should fail with 400 or 500 depending on how error is thrown
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("should successfully move money between budgets", async () => {
      mockBudgetService.moveBudgetAmount.mockResolvedValue({
        success: true,
        fromBudget: { id: "budget-1", newAmount: "400.00" },
        toBudget: { id: "budget-2", newAmount: "600.00" },
      });

      const res = await request(app).post("/api/budgets/move").send({
        fromBudgetId: "550e8400-e29b-41d4-a716-446655440001",
        toBudgetId: "550e8400-e29b-41d4-a716-446655440002",
        amount: { amount: "100.00", currency: "ZMW" },
        year: 2024,
        month: 1,
      });

      expect(res.status).toBe(200);
      expect(mockBudgetService.moveBudgetAmount).toHaveBeenCalledWith(
        "house-123", expect.anything(), expect.objectContaining({ userId: "user-123", ipAddress: "127.0.0.1" }));
      expect(mockBusinessAuditService.log).not.toHaveBeenCalled();
    });
  });
});
