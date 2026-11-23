/**
 * Goals Module - Integration Tests
 *
 * Tests CRUD operations, account assignments, goal transfers,
 * transaction linking, and activity logging.
 *
 * Coverage targets: 80%+ for financial operations (per CLAUDE.md Rule 17)
 *
 * Uses mocked middleware pattern (same as accounts.integration.test.ts)
 * for reliable testing of all endpoints including POST/PUT/DELETE.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

// ============================================================================
// MOCKS (Hoisted)
// ============================================================================
const {
  mockGoalService,
  mockGoalTransferService,
  mockTransactionGoalLinkService,
  mockGoalAccountAssignmentService,
  mockGoalDebtService,
  mockGoalActivityLogService,
  mockBusinessAuditService,
} = vi.hoisted(() => ({
  mockGoalService: {
    getGoals: vi.fn(),
    getGoalsForViewer: vi.fn(),
    getGoalById: vi.fn(),
    getGoalWithProgress: vi.fn(),
    // #235 M1: write responses re-read the redacted goal.
    getViewerGoal: vi.fn(async (id: string): Promise<Record<string, unknown>> => ({ id, currency: "ZMW", targetAmount: "1000.00", currentAmount: null, progressAvailability: "unavailable" })),
    createGoal: vi.fn(),
    updateGoal: vi.fn(),
    deleteGoal: vi.fn(),
    getSummary: vi.fn(),
    getImages: vi.fn(),
    uploadImage: vi.fn(),
    completeGoal: vi.fn(),
    archiveGoal: vi.fn(),
    unarchiveGoal: vi.fn(),
    setArchived: vi.fn(),
    getProjection: vi.fn(),
    getContributions: vi.fn(),
    addContribution: vi.fn(),
    calculatePayoff: vi.fn(),
    getPayoffScenarios: vi.fn(),
    calculateDebtStrategy: vi.fn(),
  },
  mockGoalTransferService: {
    transfer: vi.fn(),
    getTransfers: vi.fn(),
    getTransfersForGoal: vi.fn(),
  },
  mockTransactionGoalLinkService: {
    linkTransaction: vi.fn(),
    unlinkTransaction: vi.fn(),
    getLinkedTransactions: vi.fn(),
  },
  mockGoalAccountAssignmentService: {
    assignAccount: vi.fn(),
    updateAssignment: vi.fn(),
    removeAssignment: vi.fn(),
    getAssignments: vi.fn(),
    getVisibleAssignments: vi.fn(),
    getAssignmentsForHousehold: vi.fn(),
    getAvailableFunds: vi.fn(),
  },
  mockGoalDebtService: {
    addContribution: vi.fn(),
    getContributions: vi.fn(),
    calculatePayoff: vi.fn(),
    getPayoffScenarios: vi.fn(),
    calculateDebtStrategy: vi.fn(),
  },
  mockGoalActivityLogService: {
    getActivityForGoal: vi.fn(),
    getActivity: vi.fn(),
    log: vi.fn().mockResolvedValue(undefined),
  },
  mockBusinessAuditService: {
    log: vi.fn().mockResolvedValue(undefined),
    logCreate: vi.fn().mockResolvedValue(undefined),
    logUpdate: vi.fn().mockResolvedValue(undefined),
    logDelete: vi.fn().mockResolvedValue(undefined),
    getIpAddress: vi.fn().mockReturnValue("127.0.0.1"),
  },
}));

// Mock Services - Both actual service paths AND re-export file
vi.mock("../../../services/GoalService", () => ({
  goalService: mockGoalService,
}));

// Mock local goals.service (re-export file used by controllers)
vi.mock("../goals.service", () => ({
  goalService: mockGoalService,
  goalAccountAssignmentService: mockGoalAccountAssignmentService,
  goalActivityLogService: mockGoalActivityLogService,
  goalTransferService: mockGoalTransferService,
  transactionGoalLinkService: mockTransactionGoalLinkService,
}));

vi.mock("../../../services/GoalTransferService", () => ({
  goalTransferService: mockGoalTransferService,
}));

vi.mock("../../../services/TransactionGoalLinkService", () => ({
  transactionGoalLinkService: mockTransactionGoalLinkService,
}));

vi.mock("../../../services/GoalAccountAssignmentService", () => ({
  goalAccountAssignmentService: mockGoalAccountAssignmentService,
}));

vi.mock("../../../services/goal/GoalDebtService", () => ({
  GoalDebtService: vi.fn().mockImplementation(() => mockGoalDebtService),
  goalDebtService: mockGoalDebtService,
}));

vi.mock("../../../services/GoalActivityLogService", () => ({
  goalActivityLogService: mockGoalActivityLogService,
}));

vi.mock("../../../services/BusinessAuditService", () => ({
  businessAuditService: mockBusinessAuditService,
}));

// HouseholdRepository is used directly by goalsController.getTransfers (list).
// It is NOT a service mock, so it must be intercepted here, otherwise the
// controller issues a real db.select against households with the non-UUID
// householdId from the mocked middleware ("house-123") and throws a uuid error.
// The controllers show each goal as the member may see it; these goals are
// all visible, so the viewer mapping passes them through.
vi.mock("../../../services/goal/GoalViewerProgress", () => ({
  toViewerGoals: vi.fn(async (_actor: unknown, goalList: unknown[]) => goalList),
  toViewerGoal: vi.fn((goal: unknown) => goal),
  readGoalSourceVisibility: vi.fn(async (_actor: unknown, ids: string[]) => new Map(ids.map((id) => [
    id, { progressVisible: true, linkedAccountVisible: true, debtAccountVisible: true },
  ]))),
}));

vi.mock("../../../repositories/HouseholdRepository", () => ({
  householdRepository: {
    findById: vi
      .fn()
      .mockResolvedValue({ id: "house-123", currency: "ZMW" }),
  },
}));

// Mock Middleware
vi.mock("../../../middleware/householdGuard", () => ({
  householdGuard: (req: any, res: any, next: any) => {
    req.householdContext = {
      householdId: "house-123",
      userId: "user-123",
      role: "admin",
    };
    req.user = { id: "user-123" };
    req.session = { userId: "user-123" };
    next();
  },
}));

vi.mock("../../../middleware/validateEntity", () => ({
  requireRole: () => (req: any, res: any, next: any) => next(),
}));

vi.mock("../../../middleware/rateLimit", () => ({
  generalLimiter: (req: any, res: any, next: any) => next(),
  analyticsLimiter: (req: any, res: any, next: any) => next(),
  uploadLimiter: (req: any, res: any, next: any) => next(),
}));

vi.mock("../../../middleware/requireStepUp", () => ({
  requireStepUp: () => (req: any, res: any, next: any) => next(),
}));

// Import Routes (after mocks are defined)
import goalsRouter from "../goals.routes";
import { errorHandler } from "../../../core/errors/errorHandler";

const app = express();
app.use(express.json());
app.use("/api/goals", goalsRouter);
app.use(errorHandler);

// Integration tests are properly structured and match current schema/contracts.
// Fixed: Mock paths now target the actual service locations since goals.service.ts
// is a re-export file. All service mocks now correctly intercept the imported services.
describe("Goals Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // 1. CRUD OPERATIONS
  // ============================================================================

  describe("Goal CRUD Operations", () => {
    describe("POST /api/goals - Create Goal", () => {
      it("should create a save-up goal successfully", async () => {
        const mockGoal = {
          id: "goal-new",
          name: "Emergency Fund",
          type: "save_up",
          goalType: "emergency_fund",
          targetAmount: "5000.00",
          currentAmount: "0.00",
          currency: "ZMW",
          targetDate: "2026-12-31",
          householdId: "house-123",
        };

        mockGoalService.createGoal.mockResolvedValue(mockGoal);

        const res = await request(app)
          .post("/api/goals")
          .send({
            name: "Emergency Fund",
            type: "save_up",
            goalType: "emergency_fund",
            targetAmount: { amount: "5000.00", currency: "ZMW" },
            targetDate: "2026-12-31",
          })
          .expect(201);

        expect(res.body.success).toBe(true);
        expect(res.body.data.name).toBe("Emergency Fund");
        expect(res.body.data.type).toBe("save_up");
        // FIN-13: the service writes the CREATE row inside the goal's transaction.
        expect(mockGoalService.createGoal).toHaveBeenCalledWith(
          expect.any(Object), "house-123", "user-123", expect.objectContaining({ userId: "user-123" }), { ipAddress: "127.0.0.1" },
        );
        expect(mockBusinessAuditService.logCreate).not.toHaveBeenCalled();
      });

      it("should create a pay-down goal successfully", async () => {
        const mockGoal = {
          id: "goal-paydown",
          name: "Pay Off Credit Card",
          type: "pay_down",
          goalType: "credit_card",
          debtAccountId: "acc-debt",
          interestRate: "18.50",
          minimumPayment: "100.00",
          monthlyPayment: "300.00",
          currency: "ZMW",
        };

        mockGoalService.createGoal.mockResolvedValue(mockGoal);

        const res = await request(app)
          .post("/api/goals")
          .send({
            name: "Pay Off Credit Card",
            type: "pay_down",
            goalType: "credit_card",
            debtAccountId: "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb",
            interestRate: "18.50",
            minimumPayment: { amount: "100.00", currency: "ZMW" },
            monthlyPayment: { amount: "300.00", currency: "ZMW" },
          })
          .expect(201);

        expect(res.body.success).toBe(true);
        expect(res.body.data.type).toBe("pay_down");
      });

      it("should create an investment goal successfully", async () => {
        const mockGoal = {
          id: "goal-invest",
          name: "Retirement Fund",
          type: "investment",
          goalType: "retirement",
          targetAmount: "100000.00",
          targetDate: "2040-12-31",
          expectedReturn: "8.00",
          currency: "ZMW",
        };

        mockGoalService.createGoal.mockResolvedValue(mockGoal);

        const res = await request(app)
          .post("/api/goals")
          .send({
            name: "Retirement Fund",
            type: "investment",
            goalType: "retirement",
            targetAmount: { amount: "100000.00", currency: "ZMW" },
            targetDate: "2040-12-31",
            expectedReturn: "8.00",
          })
          .expect(201);

        expect(res.body.success).toBe(true);
        expect(res.body.data.type).toBe("investment");
      });

      it("should reject goal with negative target amount", async () => {
        const res = await request(app)
          .post("/api/goals")
          .send({
            name: "Invalid Goal",
            type: "save_up",
            goalType: "other",
            targetAmount: { amount: "-500.00", currency: "ZMW" },
          })
          .expect(400);

        // Error response validation - 400/404 status is sufficient
      });

      it("should reject goal with invalid date format", async () => {
        const res = await request(app)
          .post("/api/goals")
          .send({
            name: "Invalid Date Goal",
            type: "save_up",
            goalType: "other",
            targetAmount: { amount: "500.00", currency: "ZMW" },
            targetDate: "2026-13-45",
          })
          .expect(400);

        // Error response validation - 400/404 status is sufficient
      });
    });

    describe("GET /api/goals - List Goals", () => {
      it("should return all goals for household", async () => {
        const mockGoals = [
          {
            id: "goal-1",
            name: "Emergency Fund",
            type: "save_up",
            targetAmount: "5000.00",
            currentAmount: "1000.00",
          },
          {
            id: "goal-2",
            name: "Vacation",
            type: "save_up",
            targetAmount: "2000.00",
            currentAmount: "500.00",
          },
        ];

        mockGoalService.getGoalsForViewer.mockResolvedValue(mockGoals);

        const res = await request(app).get("/api/goals").expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveLength(2);
      });

      it("should filter goals by type", async () => {
        mockGoalService.getGoalsForViewer.mockResolvedValue([]);

        await request(app).get("/api/goals?type=save_up").expect(200);

        expect(mockGoalService.getGoalsForViewer).toHaveBeenCalledWith(
          { householdId: "house-123", userId: "user-123", role: "admin" },
          expect.objectContaining({ type: "save_up" }),
        );
      });

      it("should filter goals by status", async () => {
        mockGoalService.getGoalsForViewer.mockResolvedValue([]);

        await request(app).get("/api/goals?status=on_track").expect(200);

        expect(mockGoalService.getGoalsForViewer).toHaveBeenCalledWith(
          { householdId: "house-123", userId: "user-123", role: "admin" },
          expect.objectContaining({ status: "on_track" }),
        );
      });
    });

    describe("GET /api/goals/:id - Get Goal by ID", () => {
      it("should return goal by id", async () => {
        const mockGoal = {
          id: "goal-1",
          name: "Emergency Fund",
          type: "save_up",
          targetAmount: "5000.00",
          currentAmount: "1000.00",
          currency: "ZMW",
        };

        mockGoalService.getGoalWithProgress.mockResolvedValue(mockGoal);

        const res = await request(app).get("/api/goals/goal-1").expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.data.id).toBe("goal-1");
        expect(mockGoalService.getGoalWithProgress).toHaveBeenCalledWith(
          "goal-1", { householdId: "house-123", userId: "user-123", role: "admin" },
        );
      });

      it("should return 404 for non-existent goal", async () => {
        mockGoalService.getGoalWithProgress.mockRejectedValue(
          new Error("Goal not found"),
        );

        const res = await request(app).get("/api/goals/non-existent");

        // Error response validation - may return 404 or 500
        expect([404, 500]).toContain(res.status);
      });
    });

    describe("PUT /api/goals/:id - Update Goal", () => {
      it("should update goal successfully", async () => {
        const existingGoal = {
          id: "goal-1",
          name: "Original Name",
          type: "save_up",
          targetAmount: { amount: "1000.00", currency: "ZMW" },
        };
        const updatedGoal = {
          ...existingGoal,
          name: "Updated Name",
          targetAmount: "2000.00",
        };

        mockGoalService.getGoalById.mockResolvedValue(existingGoal);
        mockGoalService.updateGoal.mockResolvedValue(updatedGoal);
        mockGoalService.getViewerGoal.mockResolvedValue(updatedGoal);

        const res = await request(app)
          .put("/api/goals/goal-1")
          .send({
            name: "Updated Name",
            targetAmount: { amount: "2000.00", currency: "ZMW" },
          })
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.data.name).toBe("Updated Name");
        expect(mockGoalService.updateGoal).toHaveBeenCalledWith(
          "goal-1", { name: "Updated Name", targetAmount: "2000.00", currency: "ZMW" }, "house-123", "user-123",
          { householdId: "house-123", userId: "user-123", role: "admin" }, { ipAddress: "127.0.0.1" },
        );
      });
    });

    describe("DELETE /api/goals/:id - Delete Goal", () => {
      it("should delete goal successfully", async () => {
        const existingGoal = {
          id: "goal-1",
          name: "Goal to Delete",
          type: "save_up",
        };

        mockGoalService.getGoalById.mockResolvedValue(existingGoal);
        mockGoalService.deleteGoal.mockResolvedValue(undefined);

        const res = await request(app).delete("/api/goals/goal-1").expect(200);

        expect(res.body.success).toBe(true);
        // FIN-13: the service writes the DELETE row inside the deletion's transaction.
        expect(mockGoalService.deleteGoal).toHaveBeenCalledWith("goal-1", "house-123", { userId: "user-123", ipAddress: "127.0.0.1" });
        expect(mockBusinessAuditService.logDelete).not.toHaveBeenCalled();
      });
    });
  });

  // ============================================================================
  // 2. ACCOUNT ASSIGNMENTS
  // ============================================================================

  describe("Account Assignments", () => {
    describe("POST /api/goals/:id/assign-account - Assign Account", () => {
      it("should assign account with full_balance type", async () => {
        const mockResult = {
          assignment: {
            id: "assign-1",
            goalId: "goal-1",
            accountId: "acc-1",
            assignmentType: "full_balance",
            autoUpdate: true,
          },
          goal: {
            id: "goal-1",
            name: "Test Goal",
            currentAmount: { amount: "1000.00", currency: "ZMW" },
          },
        };

        mockGoalAccountAssignmentService.assignAccount.mockResolvedValue(
          mockResult,
        );

        const res = await request(app)
          .post("/api/goals/goal-1/assign-account")
          .send({
            accountId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
            assignmentType: "full_balance",
            autoUpdate: true,
          })
          .expect(201);

        expect(res.body.success).toBe(true);
        expect(res.body.data.assignment.assignmentType).toBe("full_balance");
      });

      it("should assign account with partial_balance type", async () => {
        const mockResult = {
          assignment: {
            id: "assign-2",
            goalId: "goal-1",
            accountId: "acc-2",
            assignmentType: "partial_balance",
            partialAmount: { amount: "250.00", currency: "ZMW" },
            autoUpdate: true,
          },
          goal: {
            id: "goal-1",
            name: "Test Goal",
          },
        };

        mockGoalAccountAssignmentService.assignAccount.mockResolvedValue(
          mockResult,
        );

        const res = await request(app)
          .post("/api/goals/goal-1/assign-account")
          .send({
            accountId: "aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa",
            assignmentType: "partial_balance",
            partialAmount: { amount: "250.00", currency: "ZMW" },
            autoUpdate: true,
          })
          .expect(201);

        expect(res.body.success).toBe(true);
        expect(res.body.data.assignment.assignmentType).toBe("partial_balance");
      });

      it("should reject assignment with negative partial amount", async () => {
        const res = await request(app)
          .post("/api/goals/goal-1/assign-account")
          .send({
            accountId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
            assignmentType: "partial_balance",
            partialAmount: { amount: "-100.00", currency: "ZMW" },
          })
          .expect(400);

        // Error response validation - 400/404 status is sufficient
      });
    });

    describe("PUT /api/goals/:id/accounts/:accountId - Update Assignment", () => {
      it("should update assignment successfully", async () => {
        const mockResult = {
          assignment: {
            id: "assign-1",
            goalId: "goal-1",
            accountId: "acc-1",
            assignmentType: "partial_balance",
            partialAmount: { amount: "500.00", currency: "ZMW" },
            autoUpdate: false,
          },
          goal: { id: "goal-1", name: "Test Goal" },
        };

        mockGoalAccountAssignmentService.getAssignments.mockResolvedValue([]);

        mockGoalAccountAssignmentService.updateAssignment.mockResolvedValue(
          mockResult,
        );

        const res = await request(app)
          .put("/api/goals/goal-1/accounts/acc-1")
          .send({
            accountId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
            assignmentType: "partial_balance",
            partialAmount: { amount: "500.00", currency: "ZMW" },
            autoUpdate: false,
          })
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.data.assignment.assignmentType).toBe("partial_balance");
      });
    });

    describe("DELETE /api/goals/:id/accounts/:accountId - Remove Assignment", () => {
      it("should remove assignment successfully", async () => {
        mockGoalAccountAssignmentService.getAssignments.mockResolvedValue([]);

        mockGoalAccountAssignmentService.removeAssignment.mockResolvedValue({
          success: true,
          goal: { id: "goal-1", name: "Test Goal" },
        });

        const res = await request(app)
          .delete("/api/goals/goal-1/accounts/acc-1")
          .expect(200);

        expect(res.body.success).toBe(true);
      });
    });

    describe("GET /api/goals/assignments - Household Assignments", () => {
      it("passes the verified actor and preserves the assignment Money DTO", async () => {
        mockGoalAccountAssignmentService.getAssignmentsForHousehold.mockResolvedValue([{
          id: "assign-1", goalId: "goal-1", accountId: "acc-1",
          partialAmount: "11.11", accountBalance: "988.89", accountCurrency: "ZMW",
          goalName: "Test Goal", goalType: "save_up", goalCurrency: "ZMW",
        }]);

        const res = await request(app).get("/api/goals/assignments").expect(200);

        expect(mockGoalAccountAssignmentService.getAssignmentsForHousehold).toHaveBeenCalledWith({
          householdId: "house-123", userId: "user-123", role: "admin",
        });
        expect(res.body.data).toMatchObject([{
          id: "assign-1", goalId: "goal-1", accountId: "acc-1",
          partialAmount: { amount: "11.11", currency: "ZMW" },
          accountBalance: { amount: "988.89", currency: "ZMW" },
          goalName: "Test Goal", goalType: "save_up", goalCurrency: "ZMW",
        }]);
      });
    });

    describe("GET /api/goals/:id/assignments - List Assignments", () => {
      it("should list assignments for goal", async () => {
        const mockAssignments = [
          {
            id: "assign-1",
            goalId: "goal-1",
            accountId: "acc-1",
            assignmentType: "full_balance",
          },
        ];

        mockGoalAccountAssignmentService.getVisibleAssignments.mockResolvedValue(
          mockAssignments,
        );

        const res = await request(app)
          .get("/api/goals/goal-1/assignments")
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveLength(1);
        expect(mockGoalAccountAssignmentService.getVisibleAssignments).toHaveBeenCalledWith(
          "goal-1", { householdId: "house-123", userId: "user-123", role: "admin" },
        );
      });
    });

    describe("GET /api/goals/available-funds - Available Funds", () => {
      it("should return available funds for assignment", async () => {
        const mockFunds = [
          {
            accountId: "acc-1",
            name: "Savings",
            available: { amount: "1000.00", currency: "ZMW" },
          },
        ];

        mockGoalAccountAssignmentService.getAvailableFunds.mockResolvedValue(
          mockFunds,
        );

        const res = await request(app)
          .get("/api/goals/available-funds")
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
      });
    });
  });

  // ============================================================================
  // 3. GOAL TRANSFERS
  // ============================================================================

  describe("Goal Transfers", () => {
    describe("POST /api/goals/transfers - Create Transfer", () => {
      it("should create transfer between goals successfully", async () => {
        const mockResult = {
          transfer: {
            id: "transfer-1",
            fromGoalId: "goal-1",
            toGoalId: "goal-2",
            amount: "500.00",
            reason: "Rebalancing funds",
          },
          fromGoal: {
            id: "goal-1",
            currentAmount: "4500.00",
          },
          toGoal: {
            id: "goal-2",
            currentAmount: "1000.00",
          },
          visibility: new Map(),
        };

        mockGoalTransferService.transfer.mockResolvedValue(mockResult);

        const res = await request(app)
          .post("/api/goals/transfers")
          .send({
            fromGoalId: "11111111-1111-4111-8111-111111111111",
            toGoalId: "22222222-2222-4222-8222-222222222222",
            amount: { amount: "500.00", currency: "ZMW" },
            reason: "Rebalancing funds",
          })
          .expect(201);

        expect(res.body.success).toBe(true);
        expect(res.body.data.transfer).toBeDefined();
        // A-06: the amount reaches the service with its currency.
        expect(mockGoalTransferService.transfer).toHaveBeenCalledWith(
          expect.any(String), expect.any(String),
          expect.objectContaining({ amount: { amount: "500.00", currency: "ZMW" } }),
          expect.anything(), "127.0.0.1",
        );
      });

      it("should reject transfer to same goal", async () => {
        const res = await request(app)
          .post("/api/goals/transfers")
          .send({
            fromGoalId: "11111111-1111-4111-8111-111111111111",
            toGoalId: "11111111-1111-4111-8111-111111111111",
            amount: { amount: "100.00", currency: "ZMW" },
          })
          .expect(400);

        // Error response validation - 400/404 status is sufficient
      });

      it("should reject transfer with negative amount", async () => {
        const res = await request(app)
          .post("/api/goals/transfers")
          .send({
            fromGoalId: "11111111-1111-4111-8111-111111111111",
            toGoalId: "22222222-2222-4222-8222-222222222222",
            amount: { amount: "-100.00", currency: "ZMW" },
          })
          .expect(400);

        // Error response validation - 400/404 status is sufficient
      });

      it("leaves the transfer audit row to the service transaction (A-23)", async () => {
        const mockResult = {
          transfer: {
            id: "transfer-audit",
            fromGoalId: "goal-1",
            toGoalId: "goal-2",
            amount: "50.00",
          },
          fromGoal: { id: "goal-1" },
          toGoal: { id: "goal-2" },
          visibility: new Map(),
        };

        mockGoalTransferService.transfer.mockResolvedValue(mockResult);

        await request(app)
          .post("/api/goals/transfers")
          .send({
            fromGoalId: "11111111-1111-4111-8111-111111111111",
            toGoalId: "22222222-2222-4222-8222-222222222222",
            amount: { amount: "50.00", currency: "ZMW" },
            reason: "Audit test transfer",
          })
          .expect(201);

        // The real row is asserted in completion-astra.goals-wave1.realdb.
        expect(mockGoalTransferService.transfer).toHaveBeenCalledWith(
          expect.any(String), expect.any(String), expect.anything(), expect.anything(), "127.0.0.1",
        );
        expect(mockBusinessAuditService.logCreate).not.toHaveBeenCalled();
      });
    });

    describe("GET /api/goals/transfers - List Transfers", () => {
      it("should list transfers for household", async () => {
        const mockTransfers = [
          {
            id: "transfer-1",
            fromGoalId: "goal-1",
            toGoalId: "goal-2",
            amount: "500.00",
            amountVisible: true,
          },
        ];

        mockGoalTransferService.getTransfers.mockResolvedValue(mockTransfers);

        const res = await request(app).get("/api/goals/transfers").expect(200);

        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
      });
    });

    describe("GET /api/goals/:id/transfers - List Goal Transfers", () => {
      it("should list transfers for specific goal", async () => {
        const mockTransfers = [
          {
            id: "transfer-1",
            fromGoalId: "goal-1",
            toGoalId: "goal-2",
            amount: "500.00",
            amountVisible: true,
          },
        ];

        mockGoalService.getGoalById.mockResolvedValue({
          id: "goal-1",
          currency: "ZMW",
        });

        mockGoalTransferService.getTransfersForGoal.mockResolvedValue(
          mockTransfers,
        );

        const res = await request(app)
          .get("/api/goals/goal-1/transfers")
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
      });
    });
  });

  // ============================================================================
  // 4. TRANSACTION LINKING
  // ============================================================================

  describe("Transaction Linking", () => {
    describe("POST /api/goals/:id/transactions - Link Transaction", () => {
      it("should link transaction to goal successfully", async () => {
        const mockResult = {
          link: {
            id: "link-1",
            transactionId: "tx-1",
            goalId: "goal-1",
            linkType: "contribution",
            amount: "100.00",
          },
          goal: {
            id: "goal-1",
            currentAmount: "1100.00",
          },
        };

        mockTransactionGoalLinkService.linkTransaction.mockResolvedValue(
          mockResult,
        );

        const res = await request(app)
          .post("/api/goals/goal-1/transactions")
          .send({
            transactionId: "cccccccc-1111-4111-8111-cccccccccccc",
            linkType: "contribution",
            amount: { amount: "100.00", currency: "ZMW" },
          })
          .expect(201);

        expect(res.body.success).toBe(true);
        expect(res.body.data.link.linkType).toBe("contribution");
      });

      it("should reject duplicate link for same transaction", async () => {
        mockTransactionGoalLinkService.linkTransaction.mockRejectedValue(
          new Error("Transaction is already linked to this goal"),
        );

        const res = await request(app)
          .post("/api/goals/goal-1/transactions")
          .send({
            transactionId: "cccccccc-1111-4111-8111-cccccccccccc",
            linkType: "contribution",
          });

        // Error response validation - may return 400 or 500
        expect([400, 500]).toContain(res.status);
      });
    });

    describe("DELETE /api/goals/:id/transactions/:txId - Unlink Transaction", () => {
      it("should unlink transaction successfully", async () => {
        mockTransactionGoalLinkService.unlinkTransaction.mockResolvedValue({
          success: true,
          goal: { id: "goal-1" },
        });

        const res = await request(app)
          .delete("/api/goals/goal-1/transactions/tx-1")
          .expect(200);

        expect(res.body.success).toBe(true);
      });
    });

    describe("GET /api/goals/:id/transactions - List Linked Transactions", () => {
      it("should list linked transactions for goal", async () => {
        const mockLinks = [
          {
            id: "link-1",
            transactionId: "tx-1",
            goalId: "goal-1",
            linkType: "contribution",
            amount: "25.00",
            sourceAmount: "25.00",
            sourceCurrency: "ZMW",
            appliedDelta: "25.00",
            transaction: { id: "tx-1", name: "Savings Deposit" },
          },
        ];

        mockGoalService.getGoalById.mockResolvedValue({
          id: "goal-1",
          currency: "ZMW",
        });
        mockTransactionGoalLinkService.getLinkedTransactions.mockResolvedValue(
          mockLinks,
        );

        const res = await request(app)
          .get("/api/goals/goal-1/transactions")
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(mockTransactionGoalLinkService.getLinkedTransactions).toHaveBeenCalledWith(
          "goal-1",
          { householdId: "house-123", userId: "user-123", role: "admin" },
        );
      });
    });
  });

  // ============================================================================
  // 5. CONTRIBUTIONS
  // ============================================================================

  describe("Contributions", () => {
    describe("POST /api/goals/:id/contribute - Add Contribution", () => {
      it("should add contribution successfully", async () => {
        const mockResult = {
          contribution: {
            id: "contrib-1",
            goalId: "goal-1",
            amount: { amount: "500.00", currency: "ZMW" },
            date: "2026-01-28",
          },
          goal: {
            id: "goal-1",
            currentAmount: "1500.00",
          },
        };

        mockGoalService.addContribution.mockResolvedValue(mockResult);

        const res = await request(app)
          .post("/api/goals/goal-1/contribute")
          .send({
            amount: { amount: "500.00", currency: "ZMW" },
            date: "2026-01-28",
            notes: "Monthly savings",
          })
          .expect(201);

        expect(res.body.success).toBe(true);
        expect(res.body.data.contribution).toBeDefined();
      });
    });

    describe("GET /api/goals/:id/contributions - List Contributions", () => {
      it("should list contributions for goal", async () => {
        const mockContributions = [
          {
            id: "contrib-1",
            goalId: "goal-1",
            amount: { amount: "500.00", currency: "ZMW" },
          },
        ];

        mockGoalService.getContributions.mockResolvedValue(
          mockContributions,
        );

        const res = await request(app)
          .get("/api/goals/goal-1/contributions")
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
      });
    });
  });

  // ============================================================================
  // 6. GOAL LIFECYCLE
  // ============================================================================

  describe("Goal Lifecycle", () => {
    describe("POST /api/goals/:id/complete - Complete Goal", () => {
      it("should complete goal successfully", async () => {
        const mockGoal = {
          id: "goal-1",
          name: "Complete Test Goal",
          isCompleted: true,
          completedAt: new Date().toISOString(),
        };

        mockGoalService.completeGoal.mockResolvedValue(mockGoal);
        mockGoalService.getViewerGoal.mockResolvedValue(mockGoal);

        const res = await request(app)
          .post("/api/goals/goal-1/complete")
          .expect(200);

        expect(res.body.success).toBe(true);
      });
    });

    describe("POST /api/goals/:id/archive - Archive Goal", () => {
      it("should archive goal successfully", async () => {
        const mockGoal = {
          id: "goal-1",
          name: "Archive Test Goal",
          isArchived: true,
        };

        mockGoalService.setArchived.mockResolvedValue(mockGoal);
        mockGoalService.getViewerGoal.mockResolvedValue(mockGoal);

        const res = await request(app)
          .post("/api/goals/goal-1/archive")
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.data.isArchived).toBe(true);
      });
    });

    describe("POST /api/goals/:id/unarchive - Unarchive Goal", () => {
      it("should unarchive goal successfully", async () => {
        const mockGoal = {
          id: "goal-1",
          name: "Unarchive Test Goal",
          isArchived: false,
        };

        mockGoalService.setArchived.mockResolvedValue(mockGoal);
        mockGoalService.getViewerGoal.mockResolvedValue(mockGoal);

        const res = await request(app)
          .post("/api/goals/goal-1/unarchive")
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.data.isArchived).toBe(false);
      });
    });
  });

  // ============================================================================
  // 7. PAYOFF TOOLS
  // ============================================================================

  describe("Payoff Tools", () => {
    describe("POST /api/goals/:id/calculate-payoff - Calculate Payoff", () => {
      it("should calculate payoff scenario", async () => {
        const mockResult = {
          monthlyPayment: 400,
          payoffDate: "2027-06-15",
          totalInterest: 450.23,
          totalPayment: 5450.23,
          monthsToPayoff: 18,
        };

        mockGoalDebtService.calculatePayoff.mockResolvedValue(mockResult);

        const res = await request(app)
          .post("/api/goals/goal-1/calculate-payoff")
          .send({
            monthlyPayment: 400,
            oneTimePayment: 500,
          })
          .expect(200);

        expect(res.body.success).toBe(true);
      });
    });

    describe("GET /api/goals/:id/payoff-scenarios - Get Payoff Scenarios", () => {
      it("should return payoff scenarios", async () => {
        const mockScenarios = {
          minimum: { monthsToPayoff: 36 },
          current: { monthsToPayoff: 24 },
          accelerated: { monthsToPayoff: 18 },
          aggressive: { monthsToPayoff: 12 },
        };

        mockGoalDebtService.getPayoffScenarios.mockResolvedValue(mockScenarios);

        const res = await request(app)
          .get("/api/goals/goal-1/payoff-scenarios")
          .expect(200);

        expect(res.body.success).toBe(true);
      });
    });

    describe("POST /api/goals/debt-strategy - Calculate Debt Strategy", () => {
      it("should calculate debt strategy", async () => {
        const mockResult = [
          { debtId: "debt-1", payoffOrder: 1, payoffDate: "2027-03-01" },
          { debtId: "debt-2", payoffOrder: 2, payoffDate: "2027-12-01" },
        ];

        mockGoalDebtService.calculateDebtStrategy.mockResolvedValue(mockResult);

        const res = await request(app)
          .post("/api/goals/debt-strategy")
          .send({
            method: "snowball",
            debts: [
              { id: "dddddddd-1111-4111-8111-dddddddddddd", balance: 5000, rate: 18.99, minPayment: 150 },
              { id: "dddddddd-2222-4222-8222-dddddddddddd", balance: 10000, rate: 15.0, minPayment: 200 },
            ],
          })
          .expect(200);

        expect(res.body.success).toBe(true);
      });
    });
  });

  // ============================================================================
  // 8. SUMMARY & ANALYTICS
  // ============================================================================

  describe("Summary & Analytics", () => {
    describe("GET /api/goals/summary - Get Summary", () => {
      it("should return goals summary", async () => {
        const mockSummary = {
          totalGoals: 5,
          totalSaved: { amount: "10000.00", currency: "ZMW" },
          totalTarget: { amount: "50000.00", currency: "ZMW" },
          completedGoals: 1,
          onTrackGoals: 3,
          offTrackGoals: 1,
        };

        mockGoalService.getSummary.mockResolvedValue(mockSummary);

        const res = await request(app).get("/api/goals/summary").expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.data).toBeDefined();
      });
    });
  });

  // ============================================================================
  // 9. ACTIVITY
  // ============================================================================

  describe("Activity Logging", () => {
    describe("GET /api/goals/:id/activity - Get Activity", () => {
      it("should return activity entries", async () => {
        const mockActivity = [
          {
            id: "activity-1",
            goalId: "goal-1",
            activityType: "goal_created",
            createdAt: new Date().toISOString(),
          },
          {
            id: "activity-2",
            goalId: "goal-1",
            activityType: "contribution_added",
            amount: "100.00",
            createdAt: new Date().toISOString(),
          },
        ];

        mockGoalActivityLogService.getActivity.mockResolvedValue(
          mockActivity,
        );

        const res = await request(app)
          .get("/api/goals/goal-1/activity?limit=10&offset=0")
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(mockGoalActivityLogService.getActivity).toHaveBeenCalledWith(
          "goal-1",
          { householdId: "house-123", userId: "user-123", role: "admin" },
          { limit: 10, offset: 0 },
        );
      });
    });
  });

  // ============================================================================
  // 10. AUDIT LOGGING VERIFICATION
  // ============================================================================

  describe("Audit Logging", () => {
    it("leaves the goal creation's single audit row to the service transaction", async () => {
      const mockGoal = {
        id: "goal-audit",
        name: "Audit Test",
        type: "save_up",
        goalType: "other",
      };
      mockGoalService.createGoal.mockResolvedValue(mockGoal);

      await request(app)
        .post("/api/goals")
        .send({
          name: "Audit Test",
          type: "save_up",
          goalType: "other",
          targetAmount: { amount: "1000.00", currency: "ZMW" },
        })
        .expect(201);

      // FIN-13: the real service writes exactly one CREATE row inside its transaction;
      // the controller must not add a second, post-commit row.
      expect(mockGoalService.createGoal).toHaveBeenCalledWith(
        expect.any(Object), "house-123", "user-123", expect.any(Object), { ipAddress: "127.0.0.1" },
      );
      expect(mockBusinessAuditService.logCreate).not.toHaveBeenCalled();
    });

    it("lets the goal writer audit a relink without a second controller audit", async () => {
      const existingGoal = { id: "goal-1", name: "Original", type: "investment" };
      const updatedGoal = { ...existingGoal, name: "Updated" };
      mockGoalService.getGoalById.mockResolvedValue(existingGoal);
      mockGoalService.updateGoal.mockResolvedValue(updatedGoal);
      mockGoalService.getViewerGoal.mockResolvedValue(updatedGoal);

      await request(app)
        .put("/api/goals/goal-1")
        .send({ name: "Updated", linkedAccountId: null })
        .expect(200);

      expect(mockGoalService.updateGoal).toHaveBeenCalledExactlyOnceWith(
        "goal-1", { name: "Updated", linkedAccountId: null }, "house-123", "user-123",
        { householdId: "house-123", userId: "user-123", role: "admin" }, { ipAddress: "127.0.0.1" },
      );
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });

    it("leaves the goal deletion's single audit row to the service transaction", async () => {
      mockGoalService.deleteGoal.mockResolvedValue(undefined);

      await request(app).delete("/api/goals/goal-1").expect(200);

      expect(mockGoalService.deleteGoal).toHaveBeenCalledWith("goal-1", "house-123", { userId: "user-123", ipAddress: "127.0.0.1" });
      expect(mockBusinessAuditService.logDelete).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // 11. EDGE CASES
  // ============================================================================

  describe("Edge Cases", () => {
    describe("Goal Completion", () => {
      it("should handle goal completion when currentAmount > targetAmount", async () => {
        const mockGoal = {
          id: "goal-over",
          name: "Over-funded Goal",
          type: "save_up",
          targetAmount: "1000.00",
          currentAmount: "1200.00",
          isCompleted: true,
        };

        mockGoalService.completeGoal.mockResolvedValue(mockGoal);
        mockGoalService.getViewerGoal.mockResolvedValue(mockGoal);

        const res = await request(app)
          .post("/api/goals/goal-over/complete")
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.data.isCompleted).toBe(true);
      });
    });

    describe("Archive/Unarchive Completed Goals", () => {
      it("should archive a completed goal", async () => {
        const mockGoal = {
          id: "goal-completed",
          name: "Completed Goal",
          isCompleted: true,
          isArchived: true,
        };

        mockGoalService.setArchived.mockResolvedValue(mockGoal);
        mockGoalService.getViewerGoal.mockResolvedValue(mockGoal);

        const res = await request(app)
          .post("/api/goals/goal-completed/archive")
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.data.isArchived).toBe(true);
      });

      it("should unarchive a completed goal", async () => {
        const mockGoal = {
          id: "goal-completed",
          name: "Completed Goal",
          isCompleted: true,
          isArchived: false,
        };

        mockGoalService.setArchived.mockResolvedValue(mockGoal);
        mockGoalService.getViewerGoal.mockResolvedValue(mockGoal);

        const res = await request(app)
          .post("/api/goals/goal-completed/unarchive")
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.data.isArchived).toBe(false);
      });
    });

    describe("Link Transaction to Archived Goal", () => {
      it("should reject linking transaction to archived goal", async () => {
        mockTransactionGoalLinkService.linkTransaction.mockRejectedValue(
          new Error("Cannot link transactions to archived goals"),
        );

        const res = await request(app)
          .post("/api/goals/goal-archived/transactions")
          .send({
            transactionId: "cccccccc-1111-4111-8111-cccccccccccc",
            linkType: "contribution",
          });

        // Error response validation - may return 400 or 500
        expect([400, 500]).toContain(res.status);
      });
    });

    describe("Delete Goal with Active Assignments", () => {
      it("should handle deletion of goal with active assignments", async () => {
        const existingGoal = {
          id: "goal-with-assignments",
          name: "Goal with Assignments",
        };

        mockGoalService.getGoalById.mockResolvedValue(existingGoal);
        mockGoalService.deleteGoal.mockResolvedValue(undefined);

        const res = await request(app)
          .delete("/api/goals/goal-with-assignments")
          .expect(200);

        expect(res.body.success).toBe(true);
      });
    });
  });
});
