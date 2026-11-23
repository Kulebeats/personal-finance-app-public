import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

// ============================================================================
// MOCKS (Hoisted)
// ============================================================================
const {
  mockGoalService,
  mockGoalAccountAssignmentService,
  mockGoalTransferService,
  mockTransactionGoalLinkService,
  mockGoalActivityLogService,
  mockBusinessAuditService,
  mockHouseholdRepository,
} = vi.hoisted(() => ({
  mockGoalService: {
    getGoals: vi.fn(),
    getGoalsForViewer: vi.fn(),
    getSummary: vi.fn(),
    getGoalWithProgress: vi.fn(),
    // #235 M1: write responses re-read the redacted goal.
    getViewerGoal: vi.fn(async (id: string): Promise<Record<string, unknown>> => ({ id, currency: "ZMW", targetAmount: "1000.00", currentAmount: null, progressAvailability: "unavailable" })),
    getGoalById: vi.fn(),
    getProjection: vi.fn(),
    getContributions: vi.fn(),
    createGoal: vi.fn(),
    updateGoal: vi.fn(),
    deleteGoal: vi.fn(),
    addContribution: vi.fn(),
    completeGoal: vi.fn(),
    setArchived: vi.fn(),
    calculatePayoff: vi.fn(),
    getPayoffScenarios: vi.fn(),
    calculateDebtStrategy: vi.fn(),
  },
  mockGoalAccountAssignmentService: {
    getAvailableFunds: vi.fn(),
    getAssignmentsForHousehold: vi.fn(),
    getAssignments: vi.fn(),
    getVisibleAssignments: vi.fn(),
    assignAccount: vi.fn(),
    updateAssignment: vi.fn(),
    removeAssignment: vi.fn(),
  },
  mockGoalTransferService: {
    getTransfers: vi.fn(),
    getTransfersForGoal: vi.fn(),
    transfer: vi.fn(),
  },
  mockTransactionGoalLinkService: {
    linkTransaction: vi.fn(),
    unlinkTransaction: vi.fn(),
    getLinkedTransactions: vi.fn(),
  },
  mockGoalActivityLogService: {
    getActivity: vi.fn(),
  },
  mockBusinessAuditService: {
    log: vi.fn().mockResolvedValue(undefined),
    logCreate: vi.fn().mockResolvedValue(undefined),
    logUpdate: vi.fn().mockResolvedValue(undefined),
    logDelete: vi.fn().mockResolvedValue(undefined),
    getIpAddress: vi.fn().mockReturnValue("127.0.0.1"),
  },
  mockHouseholdRepository: {
    findById: vi.fn().mockResolvedValue({ id: "house-123", currency: "ZMW" }),
  },
}));

// Mock Dependencies
vi.mock("../../services/GoalService", () => ({
  goalService: mockGoalService,
}));

vi.mock("../../services/GoalAccountAssignmentService", () => ({
  goalAccountAssignmentService: mockGoalAccountAssignmentService,
}));

vi.mock("../../services/GoalTransferService", () => ({
  goalTransferService: mockGoalTransferService,
}));

vi.mock("../../services/TransactionGoalLinkService", () => ({
  transactionGoalLinkService: mockTransactionGoalLinkService,
}));

vi.mock("../../services/GoalActivityLogService", () => ({
  goalActivityLogService: mockGoalActivityLogService,
}));

vi.mock("../../services/BusinessAuditService", () => ({
  businessAuditService: mockBusinessAuditService,
}));

// The controllers show each goal as the member may see it; these goals are
// all visible, so the viewer mapping passes them through.
vi.mock("../../services/goal/GoalViewerProgress", () => ({
  toViewerGoals: vi.fn(async (_actor: unknown, goalList: unknown[]) => goalList),
  toViewerGoal: vi.fn((goal: unknown) => goal),
  readGoalSourceVisibility: vi.fn(async (_actor: unknown, ids: string[]) => new Map(ids.map((id) => [
    id, { progressVisible: true, linkedAccountVisible: true, debtAccountVisible: true },
  ]))),
}));

vi.mock("../../repositories/HouseholdRepository", () => ({
  householdRepository: mockHouseholdRepository,
}));

// Mock Middleware
vi.mock("../../middleware/householdGuard", () => ({
  householdGuard: (req: any, _res: any, next: any) => {
    req.user = { id: "user-123", email: "test@example.com" };
    req.householdContext = {
      householdId: "house-123",
      userId: "user-123",
      role: "owner",
    };
    next();
  },
}));

vi.mock("../../middleware/validateEntity", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

// Import Routes
import goalsRouter from "../../modules/goals/goals.routes";

const app = express();
app.use(express.json());
app.use("/api/goals", goalsRouter);

describe("Goals Integration", () => {
  const goalId = "11111111-1111-1111-1111-111111111111";
  const accountId = "22222222-2222-2222-2222-222222222222";
  const txId = "33333333-3333-3333-3333-333333333333";
  const fromGoalId = "44444444-4444-4444-4444-444444444444";
  const toGoalId = "55555555-5555-5555-5555-555555555555";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/goals", () => {
    it("should list goals with money mapping", async () => {
      mockGoalService.getGoalsForViewer.mockResolvedValue([
        {
          id: "goal-1",
          name: "Emergency Fund",
          type: "save_up",
          goalType: "emergency_fund",
          targetAmount: "500.00",
          currentAmount: "100.00",
          currency: "ZMW",
          isArchived: false,
          isCompleted: false,
        },
      ]);

      const res = await request(app).get("/api/goals");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data[0].targetAmount).toEqual({
        amount: "500.00",
        currency: "ZMW",
      });
      expect(mockGoalService.getGoalsForViewer).toHaveBeenCalledWith(
        { householdId: "house-123", userId: "user-123", role: "owner" },
        expect.any(Object)
      );
    });
  });

  describe("GET /api/goals/summary", () => {
    it("should return goals summary", async () => {
      mockGoalService.getSummary.mockResolvedValue({
        saveUp: {
          total: 1,
          onTrack: 1,
          behind: 0,
          atRisk: 0,
          completed: 0,
          totalSaved: 100,
          totalTarget: 500,
          overallProgress: 20,
        },
        payDown: {
          total: 0,
          totalDebt: 0,
          totalPaid: 0,
          projectedInterest: 0,
          onTrack: 0,
          behind: 0,
        },
        investment: {
          total: 0,
          totalSaved: 0,
          totalTarget: 0,
        },
        recentActivity: [],
        upcomingMilestones: [],
      });

      const res = await request(app).get("/api/goals/summary");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockGoalService.getSummary).toHaveBeenCalledWith({ householdId: "house-123", userId: "user-123", role: "owner" });
    });
  });

  describe("GET /api/goals/:id", () => {
    it("should fetch goal with progress and map money fields", async () => {
      mockGoalService.getGoalWithProgress.mockResolvedValue({
        id: goalId,
        name: "Emergency Fund",
        type: "save_up",
        goalType: "emergency_fund",
        targetAmount: "500.00",
        currentAmount: "150.00",
        currency: "ZMW",
      });

      const res = await request(app).get(`/api/goals/${goalId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.currentAmount).toEqual({
        amount: "150.00",
        currency: "ZMW",
      });
      expect(mockGoalService.getGoalWithProgress).toHaveBeenCalledWith(
        goalId,
        { householdId: "house-123", userId: "user-123", role: "owner" }
      );
    });
  });

  describe("GET /api/goals/:id/projection", () => {
    it("should return projection data", async () => {
      mockGoalService.getProjection.mockResolvedValue({
        monthlyProjection: 75,
        projectedCompletionDate: "2026-12-31",
        status: "on_track",
        monthsRemaining: 12,
      });

      const res = await request(app).get(`/api/goals/${goalId}/projection`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockGoalService.getProjection).toHaveBeenCalledWith(
        goalId,
        { householdId: "house-123", userId: "user-123", role: "owner" }
      );
    });
  });

  describe("GET /api/goals/:id/contributions", () => {
    it("should return goal contributions", async () => {
      mockGoalService.getContributions.mockResolvedValue([
        { id: "contrib-1", amount: "20.00", date: "2026-01-20" },
      ]);

      const res = await request(app).get(
        `/api/goals/${goalId}/contributions`
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockGoalService.getContributions).toHaveBeenCalledWith(
        goalId,
        { householdId: "house-123", userId: "user-123", role: "owner" }
      );
    });
  });

  describe("POST /api/goals", () => {
    it("should create a goal and log audit event", async () => {
      mockGoalService.createGoal.mockResolvedValue({
        id: "goal-1",
        name: "Emergency Fund",
        type: "save_up",
        goalType: "emergency_fund",
        targetAmount: "100.00",
        currentAmount: "0.00",
        currency: "ZMW",
      });

      const res = await request(app)
        .post("/api/goals")
        .send({
          name: "Emergency Fund",
          type: "save_up",
          goalType: "emergency_fund",
          targetAmount: { amount: "100.00", currency: "ZMW" },
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(mockGoalService.createGoal).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "save_up",
          targetAmount: "100.00",
          currency: "ZMW",
        }),
        "house-123",
        "user-123",
        // A-70: the creating member, so the goal's account is checked against their custody.
        expect.objectContaining({ householdId: "house-123", userId: "user-123" }),
        // FIN-13: the service writes the CREATE row inside the goal's transaction.
        { ipAddress: "127.0.0.1" },
      );
      expect(mockBusinessAuditService.logCreate).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/goals/:id/contribute", () => {
    it("should add a contribution, passing the audit context to the service", async () => {
      mockGoalService.addContribution.mockResolvedValue({
        goal: {
          id: goalId,
          name: "Emergency Fund",
          targetAmount: "100.00",
          currentAmount: "20.00",
          currency: "ZMW",
        },
        contribution: {
          id: "contrib-1",
          amount: "20.00",
          date: "2026-01-20",
        },
      });

      const res = await request(app)
        .post(`/api/goals/${goalId}/contribute`)
        .send({
          amount: { amount: "20.00", currency: "ZMW" },
          date: "2026-01-20",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(mockGoalService.addContribution).toHaveBeenCalledWith(
        goalId,
        "house-123",
        "user-123",
        "20.00",
        expect.objectContaining({ date: "2026-01-20", currency: "ZMW", confirmOverfund: false })
      );
      // R10.3: the audit row is written inside the service's transaction.
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });
  });

  describe("PUT /api/goals/:id", () => {
    it("passes the goal update and audit context to the writer", async () => {
      mockGoalService.getGoalById.mockResolvedValue({
        id: "goal-1",
        name: "Emergency Fund",
        type: "save_up",
        goalType: "emergency_fund",
        targetAmount: "100.00",
        currentAmount: "0.00",
        currency: "ZMW",
        isArchived: false,
        isCompleted: false,
      });

      mockGoalService.updateGoal.mockResolvedValue({
        id: "goal-1",
        name: "Emergency Fund",
        type: "save_up",
        goalType: "emergency_fund",
        targetAmount: "200.00",
        currentAmount: "0.00",
        currency: "ZMW",
      });

      const res = await request(app)
        .put("/api/goals/goal-1")
        .send({
          targetAmount: { amount: "200.00", currency: "ZMW" },
        });

      expect(res.status).toBe(200);
      expect(mockGoalService.updateGoal).toHaveBeenCalledWith(
        "goal-1",
        expect.objectContaining({
          targetAmount: "200.00",
          currency: "ZMW",
        }),
        "house-123",
        "user-123",
        expect.objectContaining({ householdId: "house-123", userId: "user-123" }),
        { ipAddress: "127.0.0.1" },
      );
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/goals/:id/complete", () => {
    it("should complete a goal, passing the audit context to the service", async () => {
      mockGoalService.completeGoal.mockResolvedValue({
        id: goalId,
        name: "Emergency Fund",
        targetAmount: "100.00",
        currentAmount: "100.00",
        currency: "ZMW",
        status: "completed",
      });

      const res = await request(app).post(`/api/goals/${goalId}/complete`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockGoalService.completeGoal).toHaveBeenCalledWith(
        goalId,
        "house-123",
        "user-123",
        expect.objectContaining({ householdId: "house-123", userId: "user-123" }),
        expect.objectContaining({ ipAddress: expect.anything() }),
      );
      // The audit row is written by the service in the completion's transaction.
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/goals/:id/archive", () => {
    it("should archive a goal and log audit update", async () => {
      mockGoalService.setArchived.mockResolvedValue({
        id: goalId,
        name: "Emergency Fund",
        currency: "ZMW",
        isArchived: true,
      });

      const res = await request(app).post(`/api/goals/${goalId}/archive`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockGoalService.setArchived).toHaveBeenCalledWith(
        goalId,
        "house-123",
        "user-123",
        true,
        // FIN-13: the service writes the UPDATE row inside the archive's transaction.
        { ipAddress: "127.0.0.1" },
      );
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/goals/:id/unarchive", () => {
    it("should unarchive a goal and log audit update", async () => {
      mockGoalService.setArchived.mockResolvedValue({
        id: goalId,
        name: "Emergency Fund",
        currency: "ZMW",
        isArchived: false,
      });

      const res = await request(app).post(`/api/goals/${goalId}/unarchive`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockGoalService.setArchived).toHaveBeenCalledWith(
        goalId,
        "house-123",
        "user-123",
        false,
        // FIN-13: the service writes the UPDATE row inside the unarchive's transaction.
        { ipAddress: "127.0.0.1" },
      );
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /api/goals/:id", () => {
    it("should delete goal and log audit event", async () => {
      mockGoalService.getGoalById.mockResolvedValue({
        id: goalId,
        name: "Emergency Fund",
        type: "save_up",
        targetAmount: "100.00",
        currentAmount: "10.00",
      });
      mockGoalService.deleteGoal.mockResolvedValue(true);

      const res = await request(app).delete(`/api/goals/${goalId}`);

      expect(res.status).toBe(200);
      // FIN-13: the service locks, deletes and writes the DELETE row in one transaction.
      expect(mockGoalService.deleteGoal).toHaveBeenCalledWith(
        goalId,
        "house-123",
        { userId: "user-123", ipAddress: "127.0.0.1" },
      );
      expect(mockBusinessAuditService.logDelete).not.toHaveBeenCalled();
    });
  });

  describe("Assignments", () => {
    it("should return available funds with money mapping", async () => {
      mockGoalAccountAssignmentService.getAvailableFunds.mockResolvedValue([
        {
          accountId,
          balance: "100.00",
          assignedAmount: "25.00",
          availableAmount: "75.00",
          currency: "ZMW",
        },
      ]);

      const res = await request(app).get("/api/goals/available-funds");

      expect(res.status).toBe(200);
      expect(res.body.data[0].availableAmount).toEqual({
        amount: "75.00",
        currency: "ZMW",
      });
    });

    it("should list assignments for household", async () => {
      mockGoalAccountAssignmentService.getAssignmentsForHousehold.mockResolvedValue(
        [
          {
            id: "assign-1",
            accountId,
            assignmentType: "full_balance",
            partialAmount: null,
            accountBalance: "100.00",
            accountCurrency: "ZMW",
          },
        ]
      );

      const res = await request(app).get("/api/goals/assignments");

      expect(res.status).toBe(200);
      expect(res.body.data[0].accountBalance).toEqual({
        amount: "100.00",
        currency: "ZMW",
      });
    });

    it("should list assignments for a goal", async () => {
      mockGoalAccountAssignmentService.getVisibleAssignments.mockResolvedValue([
        {
          id: "assign-1",
          accountId,
          assignmentType: "full_balance",
          partialAmount: null,
          accountBalance: "100.00",
          accountCurrency: "ZMW",
        },
      ]);

      const res = await request(app).get(`/api/goals/${goalId}/assignments`);

      expect(res.status).toBe(200);
      expect(mockGoalAccountAssignmentService.getVisibleAssignments).toHaveBeenCalledWith(
        goalId,
        { householdId: "house-123", userId: "user-123", role: "owner" }
      );
    });

    it("should assign an account and log audit update", async () => {
      mockGoalAccountAssignmentService.assignAccount.mockResolvedValue({
        assignment: {
          id: "assign-1",
          accountId,
          assignmentType: "full_balance",
          partialAmount: null,
          autoUpdate: true,
        },
        goal: {
          id: goalId,
          targetAmount: "100.00",
          currentAmount: "25.00",
          currency: "ZMW",
        },
      });

      const res = await request(app)
        .post(`/api/goals/${goalId}/assign-account`)
        .send({
          accountId,
          assignmentType: "full_balance",
          autoUpdate: true,
        });

      expect(res.status).toBe(201);
      expect(mockGoalAccountAssignmentService.assignAccount).toHaveBeenCalledWith(
        goalId,
        "house-123",
        "user-123",
        expect.objectContaining({
          accountId,
          assignmentType: "full_balance",
        }),
        // FIN-13: the service writes the UPDATE row inside the assignment's transaction.
        { ipAddress: "127.0.0.1" },
      );
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });

    it("should update an assignment and log audit update", async () => {
      mockGoalAccountAssignmentService.getAssignments.mockResolvedValue([
        {
          accountId,
          assignmentType: "full_balance",
          partialAmount: null,
          autoUpdate: true,
        },
      ]);
      mockGoalAccountAssignmentService.updateAssignment.mockResolvedValue({
        assignment: {
          id: "assign-1",
          accountId,
          assignmentType: "partial_balance",
          partialAmount: "25.00",
          autoUpdate: false,
        },
        goal: {
          id: goalId,
          targetAmount: "100.00",
          currentAmount: "25.00",
          currency: "ZMW",
        },
      });

      const res = await request(app)
        .put(`/api/goals/${goalId}/accounts/${accountId}`)
        .send({
          accountId,
          assignmentType: "partial_balance",
          partialAmount: { amount: "25.00", currency: "ZMW" },
          autoUpdate: false,
        });

      expect(res.status).toBe(200);
      expect(mockGoalAccountAssignmentService.updateAssignment).toHaveBeenCalledWith(
        goalId,
        accountId,
        "house-123",
        "user-123",
        expect.objectContaining({
          assignmentType: "partial_balance",
        }),
        // FIN-13: the service writes the UPDATE row inside the update's transaction.
        { ipAddress: "127.0.0.1" },
      );
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });

    it("should remove an assignment and log audit update", async () => {
      mockGoalAccountAssignmentService.getAssignments.mockResolvedValue([
        {
          accountId,
          assignmentType: "full_balance",
          partialAmount: null,
          autoUpdate: true,
        },
      ]);
      mockGoalAccountAssignmentService.removeAssignment.mockResolvedValue({
        success: true,
        goal: { id: goalId, currentAmount: "0.00", currency: "ZMW" },
      });

      const res = await request(app).delete(
        `/api/goals/${goalId}/accounts/${accountId}`
      );

      expect(res.status).toBe(200);
      expect(mockGoalAccountAssignmentService.removeAssignment).toHaveBeenCalledWith(
        goalId,
        accountId,
        "house-123",
        "user-123",
        // FIN-13: the service writes the UPDATE row inside the removal's transaction.
        { ipAddress: "127.0.0.1" },
      );
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });
  });

  describe("Transfers", () => {
    it("should list household transfers with money mapping", async () => {
      mockGoalTransferService.getTransfers.mockResolvedValue([
        { id: "transfer-1", amount: "25.00", amountVisible: true },
        { id: "transfer-2", amount: "30.00", amountVisible: false },
      ]);

      const res = await request(app).get("/api/goals/transfers");

      expect(res.status).toBe(200);
      expect(res.body.data[0].amount).toEqual({
        amount: "25.00",
        currency: "ZMW",
      });
      // A transfer touching a goal whose progress the caller cannot see keeps no amount.
      expect(res.body.data[1].amount).toBeNull();
      expect(res.body.data[1]).not.toHaveProperty("amountVisible");
    });

    it("should list goal transfers with money mapping", async () => {
      mockGoalTransferService.getTransfersForGoal.mockResolvedValue([
        { id: "transfer-1", amount: "15.00", amountVisible: true },
      ]);
      mockGoalService.getGoalById.mockResolvedValue({
        id: goalId,
        currency: "ZMW",
      });

      const res = await request(app).get(`/api/goals/${goalId}/transfers`);

      expect(res.status).toBe(200);
      expect(res.body.data[0].amount).toEqual({
        amount: "15.00",
        currency: "ZMW",
      });
    });

    it("should create a transfer, leaving its audit row to the service transaction (A-23)", async () => {
      mockGoalTransferService.transfer.mockResolvedValue({
        transfer: { id: "transfer-1", amount: "10.00" },
        fromGoal: { id: fromGoalId, currency: "ZMW" },
        toGoal: { id: toGoalId, currency: "ZMW" },
        visibility: new Map(),
      });

      const res = await request(app)
        .post("/api/goals/transfers")
        .send({
          fromGoalId,
          toGoalId,
          amount: { amount: "10.00", currency: "ZMW" },
          reason: "Rebalance",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.transfer.amount).toEqual({
        amount: "10.00",
        currency: "ZMW",
      });
      expect(mockGoalTransferService.transfer).toHaveBeenCalledWith(
        expect.any(String), expect.any(String),
        expect.objectContaining({ amount: { amount: "10.00", currency: "ZMW" } }),
        expect.anything(), "127.0.0.1",
      );
      expect(mockBusinessAuditService.logCreate).not.toHaveBeenCalled();
    });
  });

  describe("Transaction Links", () => {
    it("should list linked transactions for a goal", async () => {
      mockGoalService.getGoalById.mockResolvedValue({
        id: goalId,
        currency: "ZMW",
      });
      mockTransactionGoalLinkService.getLinkedTransactions.mockResolvedValue([
        {
          id: "link-1",
          goalId,
          transactionId: txId,
          amount: "10.00",
          linkType: "contribution",
          transaction: { id: txId, amount: "10.00" },
        },
      ]);

      const res = await request(app).get(`/api/goals/${goalId}/transactions`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data[0].amount).toEqual({
        amount: "10.00",
        currency: "ZMW",
      });
      expect(
        mockTransactionGoalLinkService.getLinkedTransactions
      ).toHaveBeenCalledWith(goalId, {
        householdId: "house-123",
        userId: "user-123",
        role: "owner",
      });
    });

    it("should link a transaction, passing the audit context to the service", async () => {
      mockTransactionGoalLinkService.linkTransaction.mockResolvedValue({
        link: { id: "link-1", amount: "10.00" },
        goal: {
          id: goalId,
          targetAmount: "100.00",
          currentAmount: "10.00",
          currency: "ZMW",
        },
      });

      const res = await request(app)
        .post(`/api/goals/${goalId}/transactions`)
        .send({
          transactionId: txId,
          linkType: "contribution",
          amount: { amount: "10.00", currency: "ZMW" },
        });

      expect(res.status).toBe(201);
      expect(res.body.data.link.amount).toEqual({
        amount: "10.00",
        currency: "ZMW",
      });
      expect(mockTransactionGoalLinkService.linkTransaction).toHaveBeenCalledWith(
        goalId, "house-123", "user-123", expect.objectContaining({ transactionId: txId }),
        undefined, expect.objectContaining({ userId: "user-123" }),
      );
    });

    it("should unlink a transaction, passing the audit context to the service", async () => {
      mockTransactionGoalLinkService.unlinkTransaction.mockResolvedValue(
        undefined
      );

      const res = await request(app).delete(
        `/api/goals/${goalId}/transactions/${txId}`
      );

      expect(res.status).toBe(200);
      expect(mockTransactionGoalLinkService.unlinkTransaction).toHaveBeenCalledWith(
        goalId,
        txId,
        { householdId: "house-123", userId: "user-123", role: "owner" },
        expect.objectContaining({ userId: "user-123" }),
      );
    });
  });

  describe("Payoff tools", () => {
    it("should calculate payoff scenario", async () => {
      mockGoalService.calculatePayoff.mockResolvedValue({
        monthlyPayment: 100,
        payoffDate: "2026-12-31",
        totalInterest: 25,
        totalPayment: 125,
        monthsToPayoff: 2,
        interestSavedVsMinimum: 0,
        schedule: [],
      });

      const res = await request(app)
        .post(`/api/goals/${goalId}/calculate-payoff`)
        .send({ monthlyPayment: 100, oneTimePayment: 10 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockGoalService.calculatePayoff).toHaveBeenCalledWith(
        goalId,
        { householdId: "house-123", userId: "user-123", role: "owner" },
        expect.objectContaining({ monthlyPayment: 100, oneTimePayment: 10 })
      );
    });

    it("should fetch payoff scenarios", async () => {
      mockGoalService.getPayoffScenarios.mockResolvedValue({
        minimum: {
          monthlyPayment: 50,
          payoffDate: null,
          totalInterest: 0,
          totalPayment: 0,
          monthsToPayoff: null,
          interestSavedVsMinimum: 0,
          schedule: [],
        },
        current: {
          monthlyPayment: 75,
          payoffDate: null,
          totalInterest: 0,
          totalPayment: 0,
          monthsToPayoff: null,
          interestSavedVsMinimum: 0,
          schedule: [],
        },
        accelerated: {
          monthlyPayment: 100,
          payoffDate: null,
          totalInterest: 0,
          totalPayment: 0,
          monthsToPayoff: null,
          interestSavedVsMinimum: 0,
          schedule: [],
        },
        aggressive: {
          monthlyPayment: 125,
          payoffDate: null,
          totalInterest: 0,
          totalPayment: 0,
          monthsToPayoff: null,
          interestSavedVsMinimum: 0,
          schedule: [],
        },
      });

      const res = await request(app).get(
        `/api/goals/${goalId}/payoff-scenarios`
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockGoalService.getPayoffScenarios).toHaveBeenCalledWith(
        goalId,
        { householdId: "house-123", userId: "user-123", role: "owner" }
      );
    });
  });

  describe("POST /api/goals/debt-strategy", () => {
    it("should calculate debt strategy", async () => {
      const debtId = "66666666-6666-6666-6666-666666666666";
      mockGoalService.calculateDebtStrategy.mockResolvedValue([
        { debtId, payoffOrder: 1, payoffDate: null },
      ]);

      const res = await request(app)
        .post("/api/goals/debt-strategy")
        .send({
          method: "snowball",
          debts: [
            { id: debtId, balance: 1000, rate: 12, minPayment: 50 },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockGoalService.calculateDebtStrategy).toHaveBeenCalledWith(
        "snowball",
        [{ id: debtId, balance: 1000, rate: 12, minPayment: 50 }]
      );
    });
  });

  describe("GET /api/goals/:id/activity", () => {
    it("should return activity entries with limit/offset", async () => {
      mockGoalActivityLogService.getActivity.mockResolvedValue([
        { id: "activity-1", activityType: "goal_created" },
      ]);

      const res = await request(app).get(
        `/api/goals/${goalId}/activity?limit=5&offset=0`
      );

      expect(res.status).toBe(200);
      expect(mockGoalActivityLogService.getActivity).toHaveBeenCalledWith(
        goalId,
        { householdId: "house-123", userId: "user-123", role: "owner" },
        { limit: 5, offset: 0 }
      );
    });
  });
});
