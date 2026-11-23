import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { NotFoundError } from "../../core/errors/NotFoundError";

// Hoist mocks
const mockRecurringService = vi.hoisted(() => ({
  getVisibleRecurringRules: vi.fn(),
  getVisibleRecurringById: vi.fn(),
  getRecurringRules: vi.fn(),
  getRecurringById: vi.fn(),
  getUpcomingBills: vi.fn(),
  createRecurring: vi.fn(),
  updateRecurring: vi.fn(),
  deleteRecurring: vi.fn(),
  getSummaryData: vi.fn(),
  // Lifecycle
  changeLifecycle: vi.fn(),
  // Pattern detection
  detectAndSuggest: vi.fn(),
  confirmPattern: vi.fn(),
  // Linking
  linkTransaction: vi.fn(),
  linkVisibleTransaction: vi.fn(),
  unlinkTransaction: vi.fn(),
  getLinkedTransactions: vi.fn(),
  // History & batch
  getHistory: vi.fn(),
  processRecurring: vi.fn(),
  createRecurringFromExistingTransaction: vi.fn(),
}));

const mockBusinessAuditService = vi.hoisted(() => ({
  log: vi.fn().mockResolvedValue(undefined),
  logCreate: vi.fn().mockResolvedValue(undefined),
  logUpdate: vi.fn().mockResolvedValue(undefined),
  logDelete: vi.fn().mockResolvedValue(undefined),
  getIpAddress: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("../../services/RecurringService", () => ({
  recurringService: mockRecurringService,
}));

vi.mock("../../services/BusinessAuditService", () => ({
  businessAuditService: mockBusinessAuditService,
}));

vi.mock("../../middleware/validateEntity", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

import { recurringController } from "../../modules/recurring/recurring.controller";

function createTestApp() {
  const app = express();
  app.use(express.json());

  // Mock auth middleware
  app.use((req, _res, next) => {
    req.user = { id: "user-123", email: "test@example.com" } as unknown as import("@shared/schema").User;
    req.householdContext = {
      householdId: "11111111-1111-1111-1111-111111111111",
      userId: "user-123",
      role: "owner",
    };
    next();
  });

  // Mount recurring routes
  const router = express.Router();
  router.get("/", recurringController.list);
  router.get("/upcoming", recurringController.getUpcoming);
  router.get("/summary", recurringController.getSummary);
  router.get("/:id", recurringController.getById);
  router.get("/:id/history", recurringController.getHistory);
  router.get("/:id/linked-transactions", recurringController.getLinkedTransactions);
  router.post("/", recurringController.create);
  router.post("/detect", recurringController.detectPatterns);
  router.post("/confirm", recurringController.confirmPattern);
  router.post("/process", recurringController.processRecurring);
  router.post("/from-transaction/:transactionId", recurringController.createFromTransaction);
  router.post("/:id/skip", recurringController.skip);
  router.post("/:id/pause", recurringController.pause);
  router.post("/:id/resume", recurringController.resume);
  router.post("/:id/end", recurringController.end);
  router.post("/:id/link", recurringController.linkTransaction);
  router.delete("/:id/link/:linkId", recurringController.unlinkTransaction);
  router.put("/:id", recurringController.update);
  router.delete("/:id", recurringController.delete);

  app.use("/api/recurring", router);

  // Error handling middleware
  app.use((err: any, _req: any, res: any, _next: any) => {
    if (err.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: err.message,
          details: err.details,
        },
      });
    }
    if (err.name === "NotFoundError") {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: err.message },
      });
    }
    console.error(err);
    return res
      .status(500)
      .json({ success: false, error: "Internal Server Error" });
  });

  return app;
}

describe("Recurring Rules Integration", () => {
  let app: ReturnType<typeof createTestApp>;
  const householdId = "11111111-1111-1111-1111-111111111111";
  const accountId = "22222222-2222-2222-2222-222222222222";
  const ruleId = "33333333-3333-3333-3333-333333333333";

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  describe("CREATE - POST /api/recurring", () => {
    it("creates a recurring rule and logs audit event", async () => {
      const newRule = {
        id: ruleId,
        householdId,
        accountId,
        name: "Netflix Subscription",
        amount: "15.99",
        type: "expense",
        frequency: "monthly",
        nextDueDate: "2024-02-01",
        isActive: true,
      };

      mockRecurringService.createRecurring.mockResolvedValue(newRule);

      const response = await request(app)
        .post("/api/recurring")
        .send({
          accountId,
          name: "Netflix Subscription",
          amount: { amount: "15.99", currency: "ZMW" },
          type: "expense",
          frequency: "monthly",
          nextDueDate: "2024-02-01",
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe("Netflix Subscription");

      // FIN-13: the service writes the CREATE row inside the rule's transaction.
      expect(mockRecurringService.createRecurring).toHaveBeenCalledWith(
        expect.any(Object), householdId, "user-123",
        expect.objectContaining({ audit: { ipAddress: "127.0.0.1" } }),
      );
      expect(mockBusinessAuditService.logCreate).not.toHaveBeenCalled();
    });

    it("returns 400 for invalid input", async () => {
      const response = await request(app).post("/api/recurring").send({
        // Missing required fields
        name: "Test",
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe("READ - GET /api/recurring", () => {
    it("lists all recurring rules for household", async () => {
      const rules = [
        { id: ruleId, name: "Netflix", frequency: "monthly" },
        {
          id: "44444444-4444-4444-4444-444444444444",
          name: "Gym",
          frequency: "monthly",
        },
      ];

      mockRecurringService.getVisibleRecurringRules.mockResolvedValue(rules);

      const response = await request(app).get("/api/recurring");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
    });

    it("gets a specific recurring rule by ID", async () => {
      const rule = { id: ruleId, name: "Netflix", frequency: "monthly" };
      mockRecurringService.getVisibleRecurringById.mockResolvedValue(rule);

      const response = await request(app).get(`/api/recurring/${ruleId}`);

      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(ruleId);
    });
  });

  describe("UPDATE - PUT /api/recurring/:id", () => {
    it("updates a recurring rule and logs audit event", async () => {
      const updatedRule = {
        id: ruleId,
        name: "Netflix Premium",
        amount: "22.99",
        frequency: "monthly",
      };

      mockRecurringService.updateRecurring.mockResolvedValue({
        beforeRule: { ...updatedRule, name: "Netflix", amount: "15.99" },
        rule: updatedRule,
      });

      const response = await request(app)
        .put(`/api/recurring/${ruleId}`)
        .send({
          name: "Netflix Premium",
          amount: { amount: "22.99", currency: "ZMW" },
        });

      expect(response.status).toBe(200);
      expect(response.body.data.name).toBe("Netflix Premium");
      expect(mockRecurringService.updateRecurring).toHaveBeenCalledWith(
        ruleId,
        { name: "Netflix Premium", amount: "22.99" },
        { householdId: "11111111-1111-1111-1111-111111111111", userId: "user-123", role: "owner" },
        { confirmDenomination: undefined, currency: "ZMW" },
        { ipAddress: "127.0.0.1" },
      );

      // FIN-13: the service writes the UPDATE row inside the update's transaction.
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });
  });

  describe("DELETE - DELETE /api/recurring/:id", () => {
    it("deletes a recurring rule and logs audit event", async () => {
      const deletedRule = {
        id: ruleId,
        name: "Netflix",
        amount: "15.99",
        frequency: "monthly",
        accountId,
      };
      mockRecurringService.deleteRecurring.mockResolvedValue(deletedRule);

      const response = await request(app).delete(`/api/recurring/${ruleId}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // FIN-13: the service writes the DELETE row inside the deletion's transaction.
      expect(mockRecurringService.deleteRecurring).toHaveBeenCalledWith(
        ruleId, { householdId, userId: "user-123", role: "owner" }, { ipAddress: "127.0.0.1" },
      );
      expect(mockBusinessAuditService.logDelete).not.toHaveBeenCalled();
    });
  });

  describe("PREVIEW - GET /api/recurring/upcoming", () => {
    it("returns upcoming occurrences within default 30 days", async () => {
      const upcomingBills = [
        {
          id: ruleId,
          name: "Netflix",
          nextDueDate: "2024-02-01",
          amount: "15.99",
        },
        {
          id: "44444444-4444-4444-4444-444444444444",
          name: "Gym",
          nextDueDate: "2024-02-05",
          amount: "50.00",
        },
      ];

      mockRecurringService.getUpcomingBills.mockResolvedValue(upcomingBills);

      const response = await request(app).get("/api/recurring/upcoming");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(mockRecurringService.getUpcomingBills).toHaveBeenCalledWith(
        { householdId, userId: "user-123", role: "owner" },
        14
      );
    });

    it("respects custom days parameter", async () => {
      mockRecurringService.getUpcomingBills.mockResolvedValue([]);

      const response = await request(app).get("/api/recurring/upcoming?days=7");

      expect(response.status).toBe(200);
      expect(mockRecurringService.getUpcomingBills).toHaveBeenCalledWith(
        { householdId, userId: "user-123", role: "owner" },
        7
      );
    });
  });

  describe("SUMMARY - GET /api/recurring/summary", () => {
    it("returns recurring summary statistics", async () => {
      const summary = {
        totalMonthlyIncome: 5000,
        totalMonthlyExpenses: 2500,
        netMonthly: 2500,
        activeRulesCount: 8,
      };

      mockRecurringService.getSummaryData.mockResolvedValue(summary);

      const response = await request(app).get("/api/recurring/summary");

      expect(response.status).toBe(200);
      expect(response.body.data.totalMonthlyIncome).toEqual({
        amount: "5000.00",
        currency: "ZMW",
      });
      expect(response.body.data.activeRulesCount).toBe(8);
    });
  });

  // =========================================================================
  // LIFECYCLE TESTS
  // =========================================================================

  describe("LIFECYCLE - POST /api/recurring/:id/skip", () => {
    it("skips next occurrence through the audited service write", async () => {
      const beforeRule = {
        id: ruleId,
        nextDueDate: "2024-02-01",
        lastOccurredDate: null,
        totalOccurrences: 0,
      };
      const afterRule = {
        ...beforeRule,
        nextDueDate: "2024-03-01",
        lastOccurredDate: "2024-02-01",
        totalOccurrences: 1,
        amount: "15.99",
      };

      mockRecurringService.changeLifecycle.mockResolvedValue({ beforeRule: beforeRule, rule: afterRule });

      const response = await request(app).post(`/api/recurring/${ruleId}/skip`);

      expect(response.status).toBe(200);
      expect(response.body.data.nextDueDate).toBe("2024-03-01");
      // R14: the service writes the audit row inside its transaction.
      expect(mockRecurringService.changeLifecycle).toHaveBeenCalledWith(
        ruleId, expect.anything(), expect.objectContaining({ action: "skipped" }), "127.0.0.1",
      );
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });
  });

  describe("LIFECYCLE - POST /api/recurring/:id/pause", () => {
    it("pauses a recurring rule through the audited service write", async () => {
      const beforeRule = { id: ruleId, isPaused: false, isActive: true };
      const afterRule = { ...beforeRule, isPaused: true, amount: "15.99" };

      mockRecurringService.changeLifecycle.mockResolvedValue({ beforeRule: beforeRule, rule: afterRule });

      const response = await request(app).post(`/api/recurring/${ruleId}/pause`);

      expect(response.status).toBe(200);
      expect(response.body.data.isPaused).toBe(true);
      // R14: the service writes the audit row inside its transaction.
      expect(mockRecurringService.changeLifecycle).toHaveBeenCalledWith(
        ruleId, expect.anything(), expect.objectContaining({ action: "paused" }), "127.0.0.1",
      );
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });
  });

  describe("LIFECYCLE - POST /api/recurring/:id/resume", () => {
    it("resumes a paused recurring rule", async () => {
      const beforeRule = { id: ruleId, isPaused: true, isActive: true };
      const afterRule = { ...beforeRule, isPaused: false, amount: "15.99" };

      mockRecurringService.changeLifecycle.mockResolvedValue({ beforeRule: beforeRule, rule: afterRule });

      const response = await request(app).post(`/api/recurring/${ruleId}/resume`);

      expect(response.status).toBe(200);
      expect(response.body.data.isPaused).toBe(false);
      // R14: the service writes the audit row inside its transaction.
      expect(mockRecurringService.changeLifecycle).toHaveBeenCalledWith(
        ruleId, expect.anything(), expect.objectContaining({ action: "resumed" }), "127.0.0.1",
      );
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });
  });

  describe("LIFECYCLE - POST /api/recurring/:id/end", () => {
    it("ends a recurring rule with end date", async () => {
      const beforeRule = {
        id: ruleId,
        endDate: null,
        isActive: true,
        isPaused: false,
      };
      const afterRule = {
        ...beforeRule,
        endDate: "2024-12-31",
        isActive: false,
        amount: "15.99",
      };

      mockRecurringService.changeLifecycle.mockResolvedValue({ beforeRule: beforeRule, rule: afterRule });

      const response = await request(app)
        .post(`/api/recurring/${ruleId}/end`)
        .send({ endDate: "2024-12-31" });

      expect(response.status).toBe(200);
      expect(response.body.data.endDate).toBe("2024-12-31");
      // R14: the service writes the audit row inside its transaction.
      expect(mockRecurringService.changeLifecycle).toHaveBeenCalledWith(
        ruleId, expect.anything(), expect.objectContaining({ action: "ended", endDate: "2024-12-31" }), "127.0.0.1",
      );
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // PATTERN DETECTION TESTS
  // =========================================================================

  describe("PATTERN DETECTION - POST /api/recurring/detect", () => {
    it("detects recurring patterns in transactions", async () => {
      const patterns = [
        {
          name: "Netflix",
          estimatedAmount: "15.99",
          currency: "ZMW",
          frequency: "monthly",
          confidence: 95,
        },
        {
          name: "Spotify",
          estimatedAmount: "9.99",
          currency: "ZMW",
          frequency: "monthly",
          confidence: 88,
        },
      ];

      mockRecurringService.detectAndSuggest.mockResolvedValue(patterns);

      const response = await request(app)
        .post("/api/recurring/detect")
        .send({ minOccurrences: 3, lookbackMonths: 6 });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].estimatedAmount).toEqual({
        amount: "15.99",
        currency: "ZMW",
      });
      expect(mockRecurringService.detectAndSuggest).toHaveBeenCalledWith(
        "11111111-1111-1111-1111-111111111111",
        { minOccurrences: 3, lookbackMonths: 6, confidenceThreshold: 80 },
        { householdId: "11111111-1111-1111-1111-111111111111", userId: "user-123", role: "owner" },
      );
    });

    it.each(["", null, undefined])("preserves unknown detector denomination %s without inventing ZMW", async currency => {
      mockRecurringService.detectAndSuggest.mockResolvedValue([{ name: "Unknown-unit source", estimatedAmount: "15.99", currency,
        confirmationIssue: "Recurring denomination is unknown; review the source before confirmation." }]);
      const response = await request(app).post("/api/recurring/detect").send({}).expect(200);
      expect(response.body.data[0]).toMatchObject({ estimatedAmount: { amount: "15.99", currency: "" },
        confirmationIssue: "Recurring denomination is unknown; review the source before confirmation." });
    });
  });

  describe("PATTERN DETECTION - POST /api/recurring/confirm", () => {
    it("confirms a detected pattern and creates recurring rule", async () => {
      const newRule = {
        id: ruleId,
        name: "Netflix",
        amount: "15.99",
        frequency: "monthly",
      };

      mockRecurringService.confirmPattern.mockResolvedValue(newRule);
      const contributorIds = ["55555555-5555-5555-5555-555555555555", "66666666-6666-6666-6666-666666666666", "77777777-7777-7777-7777-777777777777"];
      const pattern = {
        name: "Netflix", type: "expense", estimatedAmount: { amount: "15.99", currency: "ZMW" }, frequency: "monthly",
        confidence: 95, amountVariance: 0, occurrences: 3, suggestedStartDate: "2026-08-01", suggestedNextDueDate: "2026-11-01",
        sampleTransactionIds: contributorIds,
        selection: { version: 1, startDate: "2026-05-02", endDate: "2026-11-02", timezone: "UTC", timezoneSource: "profile",
          options: { minOccurrences: 3, lookbackMonths: 6, confidenceThreshold: 80 }, groupKey: '["netflix","expense","ZMW"]',
          contributorIds, fingerprint: "a".repeat(64) },
      };

      const response = await request(app)
        .post("/api/recurring/confirm")
        .send({
          accountId,
          pattern,
        });

      expect(response.status).toBe(201);
      expect(response.body.data.name).toBe("Netflix");
      expect(mockRecurringService.confirmPattern).toHaveBeenCalledTimes(1);
      expect(mockRecurringService.confirmPattern).toHaveBeenCalledWith(
        "11111111-1111-1111-1111-111111111111", pattern, "user-123", accountId,
        { householdId: "11111111-1111-1111-1111-111111111111", userId: "user-123", role: "owner" }, "127.0.0.1",
      );
      // The real helper owns its atomic audit. The HTTP caller must not append a duplicate after commit.
      expect(mockBusinessAuditService.logCreate).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // TRANSACTION LINKING TESTS
  // =========================================================================

  describe("LINKING - POST /api/recurring/:id/link", () => {
    it("links a transaction to a recurring rule", async () => {
      const transactionId = "77777777-7777-7777-7777-777777777777";
      const link = {
        id: "88888888-8888-8888-8888-888888888888",
        recurringTransactionId: ruleId,
        transactionId,
        expectedAmount: "15.99",
        actualAmount: "15.99",
        matchMethod: "manual",
        // FIN-05: the service returns the units it proved — a ZMW-proven rule
        // and a ZMW transaction.
        expectedCurrency: "ZMW",
        actualCurrency: "ZMW",
      };

      mockRecurringService.linkVisibleTransaction.mockResolvedValue(link);

      const response = await request(app)
        .post(`/api/recurring/${ruleId}/link`)
        .send({ transactionId });

      expect(response.status).toBe(200);
      expect(response.body.data.expectedAmount).toEqual({
        amount: "15.99",
        currency: "ZMW",
      });
      expect(response.body.data).not.toHaveProperty("expectedCurrency");
      expect(response.body.data).not.toHaveProperty("actualCurrency");
      // FIN-13: the service writes the LINK row inside the link's transaction.
      expect(mockRecurringService.linkVisibleTransaction).toHaveBeenCalledWith(
        ruleId, transactionId, expect.objectContaining({ userId: "user-123" }), { ipAddress: "127.0.0.1" },
      );
      expect(mockBusinessAuditService.log).not.toHaveBeenCalled();
    });
  });

  describe("LINKING - DELETE /api/recurring/:id/link/:linkId", () => {
    it("unlinks a transaction from a recurring rule", async () => {
      const linkId = "55555555-5555-5555-5555-555555555555";
      const deletedLink = {
        id: linkId,
        recurringTransactionId: ruleId,
        transactionId: "tx-456",
      };

      mockRecurringService.unlinkTransaction.mockResolvedValue(deletedLink);

      const response = await request(app).delete(`/api/recurring/${ruleId}/link/${linkId}`);

      expect(response.status).toBe(200);
      expect(response.body.data.message).toBe("Unlinked successfully");
      expect(mockRecurringService.unlinkTransaction).toHaveBeenCalledWith(ruleId, linkId, {
        householdId: "11111111-1111-1111-1111-111111111111",
        userId: "user-123",
        role: "owner",
      }, { ipAddress: "127.0.0.1" });
      // FIN-13: the service writes the UNLINK row inside the unlink's transaction.
      expect(mockBusinessAuditService.log).not.toHaveBeenCalled();
    });
  });

  describe("LINKING - GET /api/recurring/:id/linked-transactions", () => {
    it("returns linked transactions for a recurring rule", async () => {
      const links = [
        {
          id: "link-1",
          transactionId: "tx-1",
          expectedAmount: "15.99",
          actualAmount: "15.99",
          expectedCurrency: "ZMW",
          actualCurrency: "ZMW",
        },
        {
          // FIN-05: a link to a rule whose unit is unproven.
          id: "link-2",
          transactionId: "tx-2",
          expectedAmount: "15.99",
          actualAmount: "16.49",
          expectedCurrency: null,
          actualCurrency: "USD",
        },
      ];

      mockRecurringService.getLinkedTransactions.mockResolvedValue(links);

      const response = await request(app).get(
        `/api/recurring/${ruleId}/linked-transactions`
      );

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].expectedAmount).toEqual({
        amount: "15.99",
        currency: "ZMW",
      });
      expect(response.body.data[1].expectedAmount).toEqual({ amount: "15.99", currency: null });
      expect(response.body.data[1].actualAmount).toEqual({ amount: "16.49", currency: "USD" });
      expect(mockRecurringService.getLinkedTransactions).toHaveBeenCalledWith(
        ruleId,
        { householdId, userId: "user-123", role: "owner" },
      );
    });
  });

  // =========================================================================
  // HISTORY & CREATE FROM TRANSACTION TESTS
  // =========================================================================

  describe("HISTORY - GET /api/recurring/:id/history", () => {
    it("returns occurrence history for a recurring rule", async () => {
      const history = [
        { date: "2024-01-15", status: "paid", transactionId: "tx-1" },
        { date: "2024-02-15", status: "skipped", transactionId: null },
      ];

      mockRecurringService.getHistory.mockResolvedValue(history);

      const response = await request(app).get(`/api/recurring/${ruleId}/history`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
      expect(mockRecurringService.getHistory).toHaveBeenCalledWith(
        ruleId,
        { householdId, userId: "user-123", role: "owner" },
        50
      );
    });

    it("respects custom limit parameter", async () => {
      mockRecurringService.getHistory.mockResolvedValue([]);

      const response = await request(app).get(
        `/api/recurring/${ruleId}/history?limit=10`
      );

      expect(response.status).toBe(200);
      expect(mockRecurringService.getHistory).toHaveBeenCalledWith(
        ruleId,
        { householdId, userId: "user-123", role: "owner" },
        10
      );
    });
  });

  // =========================================================================
  // HOUSEHOLD ISOLATION TESTS (TEST-ISOLATION-001)
  // =========================================================================

  describe("SECURITY - Household Isolation", () => {
    it("returns 404 when accessing recurring rule from another household", async () => {
      mockRecurringService.getVisibleRecurringById.mockRejectedValue(
        new NotFoundError("Recurring rule", ruleId)
      );

      const response = await request(app).get(`/api/recurring/${ruleId}`);

      expect(response.status).toBe(404);
    });

    it("cannot update a recurring rule from another household", async () => {
      mockRecurringService.updateRecurring.mockRejectedValue(
        new NotFoundError("Recurring rule", ruleId)
      );

      const response = await request(app)
        .put(`/api/recurring/${ruleId}`)
        .send({ name: "Hacked Rule" });

      expect(response.status).toBe(404);
    });

    it("cannot delete a recurring rule from another household", async () => {
      mockRecurringService.deleteRecurring.mockRejectedValue(
        new NotFoundError("Recurring rule", ruleId)
      );

      const response = await request(app).delete(`/api/recurring/${ruleId}`);

      expect(response.status).toBe(404);
    });

    it("cannot link transaction from another household", async () => {
      mockRecurringService.linkVisibleTransaction.mockRejectedValue(
        new NotFoundError("Transaction")
      );

      const response = await request(app)
        .post(`/api/recurring/${ruleId}/link`)
        .send({ transactionId: "77777777-7777-7777-7777-777777777777" });

      expect(response.status).toBe(404);
    });

    it("cannot skip recurring rule from another household", async () => {
      mockRecurringService.changeLifecycle.mockRejectedValue(
        new NotFoundError("Recurring rule", ruleId)
      );

      const response = await request(app).post(`/api/recurring/${ruleId}/skip`);

      expect(response.status).toBe(404);
    });

    it("cannot pause recurring rule from another household", async () => {
      mockRecurringService.changeLifecycle.mockRejectedValue(
        new NotFoundError("Recurring rule", ruleId)
      );

      const response = await request(app).post(`/api/recurring/${ruleId}/pause`);

      expect(response.status).toBe(404);
    });
  });

  describe("CREATE FROM TRANSACTION - POST /api/recurring/from-transaction/:transactionId", () => {
    it("creates a recurring rule from an existing transaction", async () => {
      const result = {
        transaction: {
          id: "tx-123",
          name: "Netflix",
          amount: "15.99",
          currency: "ZMW",
        },
        recurringRule: {
          id: ruleId,
          name: "Netflix",
          amount: "15.99",
          frequency: "monthly",
        },
        isDuplicate: false,
      };

      mockRecurringService.createRecurringFromExistingTransaction.mockResolvedValue(
        result
      );

      const response = await request(app)
        .post("/api/recurring/from-transaction/tx-123")
        .send({ frequency: "monthly" });

      expect(response.status).toBe(200);
      expect(response.body.data.recurringRule.name).toBe("Netflix");
      expect(response.body.data.isDuplicate).toBe(false);
      // FIN-13: the service writes the CREATE row inside the rule's transaction.
      expect(mockRecurringService.createRecurringFromExistingTransaction).toHaveBeenCalledWith(
        "tx-123", expect.any(Object), expect.any(String), "user-123", { ipAddress: "127.0.0.1" },
      );
      expect(mockBusinessAuditService.logCreate).not.toHaveBeenCalled();
    });

    it("does not log audit for duplicate detection", async () => {
      const result = {
        transaction: { id: "tx-123", name: "Netflix", amount: "15.99", currency: "ZMW" },
        recurringRule: { id: ruleId, name: "Netflix", amount: "15.99" },
        isDuplicate: true,
      };

      mockRecurringService.createRecurringFromExistingTransaction.mockResolvedValue(
        result
      );
      mockBusinessAuditService.logCreate.mockClear();

      const response = await request(app)
        .post("/api/recurring/from-transaction/tx-123")
        .send({ frequency: "monthly" });

      expect(response.status).toBe(200);
      expect(response.body.data.isDuplicate).toBe(true);
      expect(mockBusinessAuditService.logCreate).not.toHaveBeenCalled();
    });
  });
});
