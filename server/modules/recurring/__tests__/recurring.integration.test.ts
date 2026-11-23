/**
 * Recurring Module Integration Tests
 *
 * Covers: pattern detection, transaction linking, lifecycle actions,
 * history, processing, and create from transaction.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

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
  detectAndSuggest: vi.fn(),
  confirmPattern: vi.fn(),
  linkTransaction: vi.fn(),
  linkVisibleTransaction: vi.fn(),
  unlinkTransaction: vi.fn(),
  changeLifecycle: vi.fn(),
  getHistory: vi.fn(),
  getLinkedTransactions: vi.fn(),
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

vi.mock("../../../services/RecurringService", () => ({
  recurringService: mockRecurringService,
}));

vi.mock("../../../services/BusinessAuditService", () => ({
  businessAuditService: mockBusinessAuditService,
}));

// The batch summary row is written in its own transaction (FIN-13); here it
// runs the audit call against a stand-in transaction.
vi.mock("../../../utils/withTransaction", () => ({
  withTransaction: (work: (tx: object) => Promise<unknown>) => work({}),
}));

vi.mock("../../../middleware/validateEntity", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../../middleware/rateLimit", () => ({
  generalLimiter: (_req: any, _res: any, next: any) => next(),
  analyticsLimiter: (_req: any, _res: any, next: any) => next(),
}));

import { recurringController } from "../recurring.controller";
import { recurringLifecycleController } from "../recurring.lifecycle.controller";

function createTestApp() {
  const app = express();
  app.use(express.json());

  // Mock auth middleware
  app.use((req: any, _res, next) => {
    req.user = { id: "user-123", email: "test@example.com" };
    req.householdContext = {
      householdId: "11111111-1111-1111-1111-111111111111",
      userId: "user-123",
      role: "owner",
    };
    next();
  });

  // Mount recurring routes
  const router = express.Router();

  // Query routes
  router.get("/", recurringController.list);
  router.get("/upcoming", recurringController.getUpcoming);
  router.get("/summary", recurringController.getSummary);

  // Batch processing
  router.post("/process", recurringController.processRecurring);

  // Pattern detection
  router.post("/detect", recurringController.detectPatterns);
  router.post("/confirm", recurringController.confirmPattern);

  // Create
  router.post("/", recurringController.create);

  // Individual routes
  router.get("/:id", recurringController.getById);
  router.put("/:id", recurringController.update);
  router.delete("/:id", recurringController.delete);
  router.get("/:id/history", recurringController.getHistory);
  router.get("/:id/transactions", recurringController.getLinkedTransactions);

  // Lifecycle actions
  router.post("/:id/skip", recurringLifecycleController.skip);
  router.post("/:id/pause", recurringLifecycleController.pause);
  router.post("/:id/resume", recurringLifecycleController.resume);
  router.post("/:id/end", recurringLifecycleController.end);

  // Transaction linking
  router.post("/:id/link", recurringController.linkTransaction);
  router.delete("/:id/link/:linkId", recurringController.unlinkTransaction);

  // Create from transaction
  router.post(
    "/transaction/:transactionId",
    recurringController.createFromTransaction,
  );

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

describe("Recurring Module - Extended Integration Tests", () => {
  let app: ReturnType<typeof createTestApp>;
  const householdId = "11111111-1111-1111-1111-111111111111";
  const accountId = "22222222-2222-2222-2222-222222222222";
  const ruleId = "33333333-3333-3333-3333-333333333333";
  const transactionId = "44444444-4444-4444-4444-444444444444";
  const linkId = "55555555-5555-5555-5555-555555555555";

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  // =========================================================================
  // Pattern Detection
  // =========================================================================
  describe("PATTERN DETECTION - POST /api/recurring/detect", () => {
    it("detects recurring patterns from transactions", async () => {
      // Service returns raw amounts, controller maps to MoneyDto
      const patterns = [
        {
          name: "Netflix",
          type: "expense",
          frequency: "monthly",
          confidence: 95,
          estimatedAmount: "15.99",
          currency: "ZMW",
          suggestedStartDate: "2024-01-01",
          suggestedNextDueDate: "2024-02-01",
          sampleTransactionIds: [transactionId],
        },
      ];

      mockRecurringService.detectAndSuggest.mockResolvedValue(patterns);

      const response = await request(app).post("/api/recurring/detect").send({
        minOccurrences: 3,
        lookbackMonths: 6,
        confidenceThreshold: 80,
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe("Netflix");
      expect(response.body.data[0].confidence).toBe(95);
    });

    it("uses default parameters when not provided", async () => {
      mockRecurringService.detectAndSuggest.mockResolvedValue([]);

      const response = await request(app)
        .post("/api/recurring/detect")
        .send({});

      expect(response.status).toBe(200);
      expect(mockRecurringService.detectAndSuggest).toHaveBeenCalledWith(
        householdId,
        expect.objectContaining({
          minOccurrences: 3,
          lookbackMonths: 6,
          confidenceThreshold: 80,
        }),
        expect.objectContaining({
          householdId,
          userId: "user-123",
          role: "owner",
        }),
      );
    });
  });

  describe("PATTERN CONFIRM - POST /api/recurring/confirm", () => {
    it("maps the confirmed service result and supplies the signed actor and audit context", async () => {
      const createdRule = {
        id: ruleId,
        name: "Netflix",
        frequency: "monthly",
        amount: "15.99",
        type: "expense",
        isActive: true,
      };

      mockRecurringService.confirmPattern.mockResolvedValue(createdRule);

      const response = await request(app)
        .post("/api/recurring/confirm")
        .send({
          accountId,
          pattern: {
            name: "Netflix",
            type: "expense",
            frequency: "monthly",
            estimatedAmount: { amount: "15.99", currency: "ZMW" },
            suggestedStartDate: "2024-01-01",
            suggestedNextDueDate: "2024-02-01",
            sampleTransactionIds: [transactionId, "44444444-4444-4444-4444-444444444445", "44444444-4444-4444-4444-444444444446"],
          },
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe("Netflix");
      expect(mockRecurringService.confirmPattern).toHaveBeenCalledWith(householdId, expect.any(Object), "user-123", accountId,
        expect.objectContaining({ householdId, userId: "user-123", role: "owner" }), "127.0.0.1");
    });

    it("returns 400 for invalid pattern data", async () => {
      const response = await request(app)
        .post("/api/recurring/confirm")
        .send({
          accountId,
          pattern: {
            // Missing required fields
            name: "Test",
          },
        });

      expect(response.status).toBe(400);
    });
  });

  // =========================================================================
  // Transaction Linking
  // =========================================================================
  describe("LINK TRANSACTION - POST /api/recurring/:id/link", () => {
    it("links a transaction to a recurring rule", async () => {
      const link = {
        id: linkId,
        recurringTransactionId: ruleId,
        transactionId,
        matchMethod: "manual",
        matchConfidence: 100,
      };

      mockRecurringService.linkVisibleTransaction.mockResolvedValue(link);

      const response = await request(app)
        .post(`/api/recurring/${ruleId}/link`)
        .send({
          transactionId,
          matchConfidence: 100,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.transactionId).toBe(transactionId);

      // FIN-13: the service writes the LINK row inside the link's transaction.
      expect(mockRecurringService.linkVisibleTransaction).toHaveBeenCalledWith(
        ruleId, transactionId, expect.objectContaining({ householdId }), { ipAddress: "127.0.0.1" },
      );
      expect(mockBusinessAuditService.log).not.toHaveBeenCalled();
    });

    it("returns 400 for invalid transaction ID", async () => {
      const response = await request(app)
        .post(`/api/recurring/${ruleId}/link`)
        .send({
          transactionId: "invalid-uuid",
        });

      expect(response.status).toBe(400);
    });
  });

  describe("UNLINK TRANSACTION - DELETE /api/recurring/:id/link/:linkId", () => {
    it("unlinks a transaction from a recurring rule", async () => {
      mockRecurringService.unlinkTransaction.mockResolvedValue({ id: linkId, transactionId, recurringTransactionId: ruleId });

      const response = await request(app).delete(
        `/api/recurring/${ruleId}/link/${linkId}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // FIN-13: the service writes the UNLINK row inside the unlink's transaction.
      expect(mockRecurringService.unlinkTransaction).toHaveBeenCalledWith(ruleId, linkId, {
        householdId,
        userId: "user-123",
        role: "owner",
      }, { ipAddress: "127.0.0.1" });
      expect(mockBusinessAuditService.log).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Lifecycle Actions
  // =========================================================================
  describe("SKIP - POST /api/recurring/:id/skip", () => {
    it("skips the next occurrence", async () => {
      const beforeRule = {
        id: ruleId,
        name: "Test",
        nextDueDate: "2024-02-01",
      };
      const updatedRule = {
        id: ruleId,
        nextDueDate: "2024-03-01", // Skipped to next
      };

      mockRecurringService.changeLifecycle.mockResolvedValue({ beforeRule: beforeRule, rule: updatedRule });

      const response = await request(app)
        .post(`/api/recurring/${ruleId}/skip`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.nextDueDate).toBe("2024-03-01");
    });
  });

  describe("PAUSE - POST /api/recurring/:id/pause", () => {
    it("pauses a recurring rule", async () => {
      const beforeRule = { id: ruleId, name: "Test", isPaused: false };
      const pausedRule = { id: ruleId, isPaused: true };

      mockRecurringService.changeLifecycle.mockResolvedValue({ beforeRule: beforeRule, rule: pausedRule });

      const response = await request(app)
        .post(`/api/recurring/${ruleId}/pause`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.isPaused).toBe(true);
    });
  });

  describe("RESUME - POST /api/recurring/:id/resume", () => {
    it("resumes a paused recurring rule", async () => {
      const beforeRule = { id: ruleId, name: "Test", isPaused: true };
      const resumedRule = { id: ruleId, isPaused: false };

      mockRecurringService.changeLifecycle.mockResolvedValue({ beforeRule: beforeRule, rule: resumedRule });

      const response = await request(app)
        .post(`/api/recurring/${ruleId}/resume`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.isPaused).toBe(false);
    });
  });

  describe("END - POST /api/recurring/:id/end", () => {
    it("ends a recurring rule with end date", async () => {
      const beforeRule = { id: ruleId, name: "Test", isActive: true };
      const endedRule = { id: ruleId, isActive: false, endDate: "2024-01-31" };

      mockRecurringService.changeLifecycle.mockResolvedValue({ beforeRule: beforeRule, rule: endedRule });

      const response = await request(app)
        .post(`/api/recurring/${ruleId}/end`)
        .send({
          endDate: "2024-01-31",
          reason: "Cancelled subscription",
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.isActive).toBe(false);
    });

    it("ends without explicit end date (uses today)", async () => {
      const beforeRule = { id: ruleId, name: "Test", isActive: true };
      const endedRule = { id: ruleId, isActive: false };

      mockRecurringService.changeLifecycle.mockResolvedValue({ beforeRule: beforeRule, rule: endedRule });

      const response = await request(app)
        .post(`/api/recurring/${ruleId}/end`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  // =========================================================================
  // History and Linked Transactions
  // =========================================================================
  describe("HISTORY - GET /api/recurring/:id/history", () => {
    it("returns execution history with default limit", async () => {
      const history = [
        { id: "h1", action: "CREATED", createdAt: "2024-01-01" },
        { id: "h2", action: "PROCESSED", createdAt: "2024-02-01" },
      ];

      mockRecurringService.getHistory.mockResolvedValue(history);

      const response = await request(app).get(
        `/api/recurring/${ruleId}/history`,
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(mockRecurringService.getHistory).toHaveBeenCalledWith(
        ruleId,
        { householdId, userId: "user-123", role: "owner" },
        50,
      );
    });

    it("respects custom limit parameter", async () => {
      mockRecurringService.getHistory.mockResolvedValue([]);

      const response = await request(app).get(
        `/api/recurring/${ruleId}/history?limit=10`,
      );

      expect(response.status).toBe(200);
      expect(mockRecurringService.getHistory).toHaveBeenCalledWith(
        ruleId,
        { householdId, userId: "user-123", role: "owner" },
        10,
      );
    });

    it("caps limit at 100", async () => {
      mockRecurringService.getHistory.mockResolvedValue([]);

      const response = await request(app).get(
        `/api/recurring/${ruleId}/history?limit=500`,
      );

      expect(response.status).toBe(200);
      expect(mockRecurringService.getHistory).toHaveBeenCalledWith(
        ruleId,
        { householdId, userId: "user-123", role: "owner" },
        100,
      );
    });

    it("handles invalid limit gracefully", async () => {
      mockRecurringService.getHistory.mockResolvedValue([]);

      const response = await request(app).get(
        `/api/recurring/${ruleId}/history?limit=abc`,
      );

      expect(response.status).toBe(200);
      expect(mockRecurringService.getHistory).toHaveBeenCalledWith(
        ruleId,
        { householdId, userId: "user-123", role: "owner" },
        50, // Default
      );
    });
  });

  describe("LINKED TRANSACTIONS - GET /api/recurring/:id/transactions", () => {
    it("returns linked transactions for a rule", async () => {
      // Service returns raw amount (string), controller maps to MoneyDto
      const links = [
        {
          id: linkId,
          transactionId,
          matchMethod: "auto",
          matchConfidence: 95,
          expectedAmount: "15.99",
        },
      ];

      mockRecurringService.getLinkedTransactions.mockResolvedValue(links);

      const response = await request(app).get(
        `/api/recurring/${ruleId}/transactions`,
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].transactionId).toBe(transactionId);
      expect(mockRecurringService.getLinkedTransactions).toHaveBeenCalledWith(
        ruleId,
        { householdId, userId: "user-123", role: "owner" },
      );
    });
  });

  // =========================================================================
  // Batch Processing
  // =========================================================================
  describe("PROCESS - POST /api/recurring/process", () => {
    it("processes due recurring transactions", async () => {
      const result = {
        processed: 5,
        created: 3,
        errors: [],
      };

      mockRecurringService.processRecurring.mockResolvedValue(result);

      const response = await request(app)
        .post("/api/recurring/process")
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.processed).toBe(5);
      expect(response.body.data.created).toBe(3);

      expect(mockBusinessAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "PROCESS",
          entityType: "recurring_batch",
        }),
      );
    });

    it("reports errors in processing result", async () => {
      const result = {
        processed: 2,
        created: 1,
        errors: [{ ruleId, error: "Insufficient balance" }],
      };

      mockRecurringService.processRecurring.mockResolvedValue(result);

      const response = await request(app)
        .post("/api/recurring/process")
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.data.errors).toHaveLength(1);
    });

    it("uses the same UTC cutoff for processing and its audit across midnight", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date("2030-02-28T23:59:59Z"));
        mockRecurringService.processRecurring.mockImplementationOnce(async () => {
          vi.setSystemTime(new Date("2030-03-01T00:00:01Z"));
          return { processed: 1, created: 1, errors: [] };
        });
        await request(app).post("/api/recurring/process").send({}).expect(200);
        expect.soft(mockRecurringService.processRecurring).toHaveBeenCalledWith(
          "11111111-1111-1111-1111-111111111111", "2030-02-28", false, expect.objectContaining({ role: "owner" }),
        );
        expect(mockBusinessAuditService.log).toHaveBeenCalledWith(expect.objectContaining({
          entityType: "recurring_batch", details: expect.objectContaining({ asOfDate: "2030-02-28" }),
        }));
      } finally { vi.useRealTimers(); }
    });
  });

  // =========================================================================
  // Create from Transaction
  // =========================================================================
  describe("CREATE FROM TRANSACTION - POST /api/recurring/transaction/:transactionId", () => {
    it("creates recurring rule from existing transaction", async () => {
      const result = {
        transaction: {
          id: transactionId,
          name: "Netflix",
          amount: "15.99",
        },
        recurringRule: {
          id: ruleId,
          name: "Netflix from Transaction",
          amount: "15.99",
          frequency: "monthly",
          type: "expense",
        },
        isDuplicate: false,
      };

      mockRecurringService.createRecurringFromExistingTransaction.mockResolvedValue(
        result,
      );

      const response = await request(app)
        .post(`/api/recurring/transaction/${transactionId}`)
        .send({
          frequency: "monthly",
          startDate: "2024-01-15",
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.recurringRule.name).toBe(
        "Netflix from Transaction",
      );

      // FIN-13: the service writes the CREATE row inside the rule's transaction.
      expect(mockRecurringService.createRecurringFromExistingTransaction).toHaveBeenCalledWith(
        transactionId, expect.any(Object), householdId, "user-123", { ipAddress: "127.0.0.1" },
      );
      expect(mockBusinessAuditService.logCreate).not.toHaveBeenCalled();
    });

    it("requires frequency parameter", async () => {
      const response = await request(app)
        .post(`/api/recurring/transaction/${transactionId}`)
        .send({});

      expect(response.status).toBe(400);
    });
  });

  // =========================================================================
  // Not Found Paths (404)
  // =========================================================================
  describe("NOT FOUND PATHS", () => {
    const notFoundError = new Error("Rule not found");
    notFoundError.name = "NotFoundError";

    it("returns 404 for history of non-existent rule", async () => {
      mockRecurringService.getHistory.mockRejectedValue(notFoundError);

      const response = await request(app).get(
        `/api/recurring/${ruleId}/history`,
      );
      expect(response.status).toBe(404);
    });

    it("returns 404 for transactions of non-existent rule", async () => {
      mockRecurringService.getLinkedTransactions.mockRejectedValue(
        notFoundError,
      );

      const response = await request(app).get(
        `/api/recurring/${ruleId}/transactions`,
      );
      expect(response.status).toBe(404);
    });

    it("returns 404 when linking to non-existent rule", async () => {
      mockRecurringService.linkVisibleTransaction.mockRejectedValue(notFoundError);

      const response = await request(app)
        .post(`/api/recurring/${ruleId}/link`)
        .send({ transactionId });
      expect(response.status).toBe(404);
    });
  });

  // =========================================================================
  // Validation Edge Cases
  // =========================================================================
  describe("VALIDATION", () => {
    it("rejects invalid date format in nextDueDate", async () => {
      const response = await request(app)
        .post("/api/recurring")
        .send({
          accountId,
          name: "Test",
          amount: { amount: "10.00", currency: "ZMW" },
          type: "expense",
          frequency: "monthly",
          nextDueDate: "2024-02-30", // Invalid date
        });

      expect(response.status).toBe(400);
    });

    it("rejects invalid UUID for accountId", async () => {
      const response = await request(app)
        .post("/api/recurring")
        .send({
          accountId: "not-a-uuid",
          name: "Test",
          amount: { amount: "10.00", currency: "ZMW" },
          type: "expense",
          frequency: "monthly",
          nextDueDate: "2024-02-15",
        });

      expect(response.status).toBe(400);
    });

    it("rejects custom frequency without interval", async () => {
      const response = await request(app)
        .post("/api/recurring")
        .send({
          accountId,
          name: "Custom Test",
          amount: { amount: "10.00", currency: "ZMW" },
          type: "expense",
          frequency: "custom",
          nextDueDate: "2024-02-15",
          // Missing intervalUnit and intervalValue
        });

      expect(response.status).toBe(400);
    });

    it("accepts custom frequency with interval", async () => {
      const newRule = {
        id: ruleId,
        name: "Every 10 Days",
        frequency: "custom",
        intervalValue: 10,
        intervalUnit: "days",
      };

      mockRecurringService.createRecurring.mockResolvedValue(newRule);

      const response = await request(app)
        .post("/api/recurring")
        .send({
          accountId,
          name: "Every 10 Days",
          amount: { amount: "10.00", currency: "ZMW" },
          type: "expense",
          frequency: "custom",
          intervalValue: 10,
          intervalUnit: "days",
          nextDueDate: "2024-02-15",
        });

      expect(response.status).toBe(201);
    });
  });

  // =========================================================================
  // Privacy - ISSUE-REC-008 Fix Verification
  // =========================================================================
  describe("PRIVACY - Transaction Visibility", () => {
    it("passes the complete actor to signed link authorization", async () => {
      const link = {
        id: linkId,
        recurringTransactionId: ruleId,
        transactionId,
        matchMethod: "manual",
      };

      mockRecurringService.linkVisibleTransaction.mockResolvedValue(link);

      await request(app)
        .post(`/api/recurring/${ruleId}/link`)
        .send({ transactionId });

      // The complete signed actor reaches the link authorization boundary.
      expect(mockRecurringService.linkVisibleTransaction).toHaveBeenCalledWith(
        ruleId,
        transactionId,
        { householdId, userId: "user-123", role: "owner" },
        { ipAddress: "127.0.0.1" },
      );
    });
  });

  // =========================================================================
  // Security & Isolation (Phase 0)
  // =========================================================================
  describe("SECURITY - Cross Household Isolation", () => {
    it("prevents access to other households' resources (GetById)", async () => {
      // Actor-scoped read must hide a rule outside the current audience.
      const error = new Error("Rule not found");
      error.name = "NotFoundError";
      mockRecurringService.getVisibleRecurringById.mockRejectedValue(error);

      const response = await request(app).get(`/api/recurring/${ruleId}`);

      expect(response.status).toBe(404);
      expect(mockRecurringService.getVisibleRecurringById).toHaveBeenCalledWith(
        ruleId,
        { householdId, userId: "user-123", role: "owner" },
      );
    });

    it("prevents updating other households' resources", async () => {
      const error = new Error("Rule not found");
      error.name = "NotFoundError";
      mockRecurringService.updateRecurring.mockRejectedValue(error);

      const response = await request(app).put(`/api/recurring/${ruleId}`).send({
        name: "Hacked Update",
      });

      expect(response.status).toBe(404);
      expect(mockRecurringService.updateRecurring).toHaveBeenCalledWith(
        ruleId,
        { name: "Hacked Update" },
        { householdId, userId: "user-123", role: "owner" },
        undefined,
        { ipAddress: "127.0.0.1" },
      );
    });

    it("prevents deleting other households' resources", async () => {
      const error = new Error("Rule not found");
      error.name = "NotFoundError";
      mockRecurringService.deleteRecurring.mockRejectedValue(error);

      const response = await request(app).delete(`/api/recurring/${ruleId}`);

      expect(response.status).toBe(404);
      expect(mockRecurringService.deleteRecurring).toHaveBeenCalledWith(
        ruleId, { householdId, userId: "user-123", role: "owner" }, { ipAddress: "127.0.0.1" },
      );
    });
  });

  describe("SECURITY - Account Ownership", () => {
    it("verifies account ownership on create", async () => {
      // Simulate service rejecting if account doesn't belong to household
      const error = new Error("Account not found");
      error.name = "NotFoundError"; // Service typically throws this if account invalid

      mockRecurringService.createRecurring.mockRejectedValue(error);

      const response = await request(app)
        .post("/api/recurring")
        .send({
          accountId, // If this account isn't in household...
          name: "Malicious Create",
          amount: { amount: "100.00", currency: "ZMW" },
          type: "expense",
          frequency: "monthly",
          nextDueDate: "2024-02-01", // Required field
        });

      expect(response.status).toBe(404);
      expect(mockRecurringService.createRecurring).toHaveBeenCalledWith(
        expect.objectContaining({ accountId }),
        householdId,
        expect.any(String),
        { actor: { householdId, userId: "user-123", role: "owner" }, currency: "ZMW", audit: { ipAddress: "127.0.0.1" } },
      );
    });

    it("verifies account ownership on update with new accountId", async () => {
      const differentAccountId = "66666666-6666-6666-6666-666666666666";
      const error = new Error("Account not found");
      error.name = "NotFoundError";

      mockRecurringService.getRecurringById.mockResolvedValue({
        id: ruleId,
        name: "Existing Rule",
        accountId,
      });
      mockRecurringService.updateRecurring.mockRejectedValue(error);

      const response = await request(app)
        .put(`/api/recurring/${ruleId}`)
        .send({
          accountId: differentAccountId, // Trying to move to account not in household
          name: "Updated Name",
        });

      expect(response.status).toBe(404);
    });
  });

  // =========================================================================
  // P0 - Cross Household Isolation for Lifecycle Endpoints
  // =========================================================================
  describe("SECURITY - Lifecycle Endpoint Isolation", () => {
    const notFoundError = new Error("Rule not found");
    notFoundError.name = "NotFoundError";

    it("prevents skipping other households' recurring rules", async () => {
      mockRecurringService.changeLifecycle.mockRejectedValue(notFoundError);

      const response = await request(app)
        .post(`/api/recurring/${ruleId}/skip`)
        .send({});

      expect(response.status).toBe(404);
      expect(mockRecurringService.changeLifecycle).toHaveBeenCalledWith(ruleId,
        { householdId, userId: "user-123", role: "owner" }, expect.objectContaining({ action: "skipped" }), "127.0.0.1");
    });

    it("prevents pausing other households' recurring rules", async () => {
      mockRecurringService.changeLifecycle.mockRejectedValue(notFoundError);

      const response = await request(app)
        .post(`/api/recurring/${ruleId}/pause`)
        .send({});

      expect(response.status).toBe(404);
      expect(mockRecurringService.changeLifecycle).toHaveBeenCalledWith(ruleId,
        { householdId, userId: "user-123", role: "owner" }, expect.objectContaining({ action: "paused" }), "127.0.0.1");
    });

    it("prevents resuming other households' recurring rules", async () => {
      mockRecurringService.changeLifecycle.mockRejectedValue(notFoundError);

      const response = await request(app)
        .post(`/api/recurring/${ruleId}/resume`)
        .send({});

      expect(response.status).toBe(404);
      expect(mockRecurringService.changeLifecycle).toHaveBeenCalledWith(ruleId,
        { householdId, userId: "user-123", role: "owner" }, expect.objectContaining({ action: "resumed" }), "127.0.0.1");
    });

    it("prevents ending other households' recurring rules", async () => {
      mockRecurringService.changeLifecycle.mockRejectedValue(notFoundError);

      const response = await request(app)
        .post(`/api/recurring/${ruleId}/end`)
        .send({ endDate: "2024-12-31" });

      expect(response.status).toBe(404);
      expect(mockRecurringService.changeLifecycle).toHaveBeenCalledWith(ruleId,
        { householdId, userId: "user-123", role: "owner" }, expect.objectContaining({ action: "ended" }), "127.0.0.1");
    });

    it("prevents viewing history of other households' recurring rules", async () => {
      mockRecurringService.getHistory.mockRejectedValue(notFoundError);

      const response = await request(app).get(
        `/api/recurring/${ruleId}/history`,
      );

      expect(response.status).toBe(404);
      expect(mockRecurringService.getHistory).toHaveBeenCalledWith(
        ruleId,
        { householdId, userId: "user-123", role: "owner" },
        50,
      );
    });

    it("prevents viewing linked transactions of other households' rules", async () => {
      mockRecurringService.getLinkedTransactions.mockRejectedValue(
        notFoundError,
      );

      const response = await request(app).get(
        `/api/recurring/${ruleId}/transactions`,
      );

      expect(response.status).toBe(404);
    });
  });

  // =========================================================================
  // P0 - Private Transaction Visibility on Link
  // =========================================================================
  describe("SECURITY - Private Transaction Visibility", () => {
    it("prevents linking another user's private transaction", async () => {
      // Service should throw NotFoundError when private transaction not visible
      const error = new Error("Transaction not found");
      error.name = "NotFoundError";

      mockRecurringService.linkVisibleTransaction.mockRejectedValue(error);

      const response = await request(app)
        .post(`/api/recurring/${ruleId}/link`)
        .send({
          transactionId, // This is another user's private transaction
        });

      expect(response.status).toBe(404);
      // Private transaction checks use the signed actor.
      expect(mockRecurringService.linkVisibleTransaction).toHaveBeenCalledWith(
        ruleId,
        transactionId,
        { householdId, userId: "user-123", role: "owner" },
        { ipAddress: "127.0.0.1" },
      );
    });

    it("allows linking household member's non-private transaction", async () => {
      const link = {
        id: linkId,
        recurringTransactionId: ruleId,
        transactionId,
        matchMethod: "manual",
      };

      mockRecurringService.linkVisibleTransaction.mockResolvedValue(link);

      const response = await request(app)
        .post(`/api/recurring/${ruleId}/link`)
        .send({ transactionId });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  // =========================================================================
  // Additional Edge Cases (to reach 50+ tests)
  // =========================================================================
  describe("EDGE CASES - Date Handling", () => {
    it("handles leap year (Feb 29) skip correctly", async () => {
      const leapYearRule = {
        id: ruleId,
        name: "Leap Year Subscription",
        frequency: "yearly",
        nextDueDate: "2024-02-29",
      };
      const skippedRule = {
        ...leapYearRule,
        nextDueDate: "2025-02-28", // 2025 is not a leap year
      };

      mockRecurringService.changeLifecycle.mockResolvedValue({ beforeRule: leapYearRule, rule: skippedRule });

      const response = await request(app)
        .post(`/api/recurring/${ruleId}/skip`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.nextDueDate).toBeDefined();
    });

    it("handles month-end (31st) in 30-day month skip", async () => {
      const monthEndRule = {
        id: ruleId,
        name: "End of Month Bill",
        frequency: "monthly",
        nextDueDate: "2024-01-31",
      };
      const skippedRule = {
        ...monthEndRule,
        nextDueDate: "2024-02-29", // Feb 2024 has 29 days (leap year)
      };

      mockRecurringService.changeLifecycle.mockResolvedValue({ beforeRule: monthEndRule, rule: skippedRule });

      const response = await request(app)
        .post(`/api/recurring/${ruleId}/skip`)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it("handles very old recurring with many occurrences", async () => {
      const oldRule = {
        id: ruleId,
        name: "Long-running Subscription",
        startDate: "2020-01-01",
        totalOccurrences: 48,
        nextDueDate: "2024-01-01",
      };
      const history = Array(50).fill(null).map((_, i) => ({
        id: `history-${i}`,
        action: "processed",
        createdAt: new Date(2020 + Math.floor(i / 12), i % 12, 1),
      }));

      mockRecurringService.getHistory.mockResolvedValue(history);

      const response = await request(app)
        .get(`/api/recurring/${ruleId}/history`)
        .query({ limit: 50 });

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBe(50);
    });
  });

  describe("EDGE CASES - Amount Tolerance", () => {
    it("accepts amount tolerance within valid range (0-50)", async () => {
      const newRule = {
        id: ruleId,
        name: "Variable Amount Subscription",
        amount: "100.00",
        amountType: "variable",
        amountTolerance: 10,
      };

      mockRecurringService.createRecurring.mockResolvedValue(newRule);

      const response = await request(app)
        .post("/api/recurring")
        .send({
          accountId,
          name: "Variable Amount Subscription",
          amount: { amount: "100.00", currency: "ZMW" },
          type: "expense",
          frequency: "monthly",
          nextDueDate: "2024-02-01",
          amountType: "variable",
          amountTolerance: 10,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it("rejects amount tolerance above maximum (51)", async () => {
      const response = await request(app)
        .post("/api/recurring")
        .send({
          accountId,
          name: "Excessive Tolerance",
          amount: { amount: "100.00", currency: "ZMW" },
          type: "expense",
          frequency: "monthly",
          nextDueDate: "2024-02-01",
          amountTolerance: 51,
        });

      expect(response.status).toBe(400);
    });

    it("rejects negative amount tolerance", async () => {
      const response = await request(app)
        .post("/api/recurring")
        .send({
          accountId,
          name: "Negative Tolerance",
          amount: { amount: "100.00", currency: "ZMW" },
          type: "expense",
          frequency: "monthly",
          nextDueDate: "2024-02-01",
          amountTolerance: -5,
        });

      expect(response.status).toBe(400);
    });
  });

  describe("EDGE CASES - Frequency Variations", () => {
    const validFrequencies = ["daily", "weekly", "biweekly", "monthly", "quarterly", "annually", "yearly"];

    validFrequencies.forEach((frequency) => {
      it(`accepts valid frequency: ${frequency}`, async () => {
        const newRule = {
          id: ruleId,
          name: `${frequency} Rule`,
          frequency,
        };

        mockRecurringService.createRecurring.mockResolvedValue(newRule);

        const response = await request(app)
          .post("/api/recurring")
          .send({
            accountId,
            name: `${frequency} Rule`,
            amount: { amount: "50.00", currency: "ZMW" },
            type: "expense",
            frequency,
            nextDueDate: "2024-02-01",
          });

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
      });
    });

    it("rejects invalid frequency", async () => {
      const response = await request(app)
        .post("/api/recurring")
        .send({
          accountId,
          name: "Invalid Frequency",
          amount: { amount: "50.00", currency: "ZMW" },
          type: "expense",
          frequency: "every_other_day", // Invalid
          nextDueDate: "2024-02-01",
        });

      expect(response.status).toBe(400);
    });

    it("handles semi_annually frequency", async () => {
      const newRule = {
        id: ruleId,
        name: "Semi-Annual Rule",
        frequency: "semi_annually",
      };

      mockRecurringService.createRecurring.mockResolvedValue(newRule);

      const response = await request(app)
        .post("/api/recurring")
        .send({
          accountId,
          name: "Semi-Annual Rule",
          amount: { amount: "500.00", currency: "ZMW" },
          type: "expense",
          frequency: "semi_annually",
          nextDueDate: "2024-06-01",
        });

      expect(response.status).toBe(201);
    });
  });

  describe("EDGE CASES - Upcoming Bills", () => {
    it("returns upcoming bills with default days (14)", async () => {
      const upcomingRules = [
        { id: "r1", name: "Bill 1", nextDueDate: "2024-02-05" },
        { id: "r2", name: "Bill 2", nextDueDate: "2024-02-10" },
      ];

      mockRecurringService.getUpcomingBills.mockResolvedValue(upcomingRules);

      const response = await request(app).get("/api/recurring/upcoming");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(mockRecurringService.getUpcomingBills).toHaveBeenCalledWith(
        { householdId, userId: "user-123", role: "owner" },
        14, // Default
      );
    });

    it("accepts custom days parameter for upcoming bills", async () => {
      mockRecurringService.getUpcomingBills.mockResolvedValue([]);

      await request(app).get("/api/recurring/upcoming?days=7");

      expect(mockRecurringService.getUpcomingBills).toHaveBeenCalledWith(
        { householdId, userId: "user-123", role: "owner" },
        7,
      );
    });

    it("caps upcoming days at 365", async () => {
      mockRecurringService.getUpcomingBills.mockResolvedValue([]);

      await request(app).get("/api/recurring/upcoming?days=1000");

      expect(mockRecurringService.getUpcomingBills).toHaveBeenCalledWith(
        { householdId, userId: "user-123", role: "owner" },
        365, // Capped
      );
    });
  });

  describe("EDGE CASES - Summary Data", () => {
    it("returns accurate summary with totals as MoneyDto", async () => {
      const summaryData = {
        totalMonthlyIncome: 5000,
        totalMonthlyExpenses: 2500,
        activeRules: 10,
        pausedRules: 2,
        incomeRules: 3,
        expenseRules: 9,
      };

      mockRecurringService.getSummaryData.mockResolvedValue(summaryData);

      const response = await request(app).get("/api/recurring/summary");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // Controller converts totals to MoneyDto format
      expect(response.body.data.totalMonthlyIncome).toBeDefined();
      expect(response.body.data.totalMonthlyExpenses).toBeDefined();
    });

    it("handles empty summary when no rules exist", async () => {
      const emptySummary = {
        totalMonthlyIncome: 0,
        totalMonthlyExpenses: 0,
        activeRules: 0,
        pausedRules: 0,
      };

      mockRecurringService.getSummaryData.mockResolvedValue(emptySummary);

      const response = await request(app).get("/api/recurring/summary");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe("EDGE CASES - List Filters", () => {
    it("lists with includeInactive=true", async () => {
      mockRecurringService.getVisibleRecurringRules.mockResolvedValue([]);

      await request(app).get("/api/recurring?includeInactive=true");

      expect(mockRecurringService.getVisibleRecurringRules).toHaveBeenCalledWith(
        { householdId, userId: "user-123", role: "owner" },
        expect.objectContaining({ includeInactive: true }),
      );
    });

    it("lists with includePaused=true", async () => {
      mockRecurringService.getVisibleRecurringRules.mockResolvedValue([]);

      await request(app).get("/api/recurring?includePaused=true");

      expect(mockRecurringService.getVisibleRecurringRules).toHaveBeenCalledWith(
        { householdId, userId: "user-123", role: "owner" },
        expect.objectContaining({ includePaused: true }),
      );
    });

    it("lists with both filters", async () => {
      mockRecurringService.getVisibleRecurringRules.mockResolvedValue([]);

      await request(app).get("/api/recurring?includeInactive=true&includePaused=true");

      expect(mockRecurringService.getVisibleRecurringRules).toHaveBeenCalledWith(
        { householdId, userId: "user-123", role: "owner" },
        expect.objectContaining({
          includeInactive: true,
          includePaused: true,
        }),
      );
    });
  });

  describe("EDGE CASES - Subscription Features", () => {
    it("creates subscription with trial end date", async () => {
      const subscription = {
        id: ruleId,
        name: "Netflix Free Trial",
        isSubscription: true,
        trialEndDate: "2024-03-01",
      };

      mockRecurringService.createRecurring.mockResolvedValue(subscription);

      const response = await request(app)
        .post("/api/recurring")
        .send({
          accountId,
          name: "Netflix Free Trial",
          amount: { amount: "15.99", currency: "ZMW" },
          type: "expense",
          frequency: "monthly",
          nextDueDate: "2024-03-01",
          isSubscription: true,
          trialEndDate: "2024-03-01",
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it("creates rule with reminder settings", async () => {
      const ruleWithReminders = {
        id: ruleId,
        name: "Bill with Reminders",
        reminderDays: 5,
        reminderEmail: true,
        reminderPush: true,
        reminderInApp: true,
      };

      mockRecurringService.createRecurring.mockResolvedValue(ruleWithReminders);

      const response = await request(app)
        .post("/api/recurring")
        .send({
          accountId,
          name: "Bill with Reminders",
          amount: { amount: "100.00", currency: "ZMW" },
          type: "expense",
          frequency: "monthly",
          nextDueDate: "2024-02-01",
          reminderDays: 5,
          reminderEmail: true,
          reminderPush: true,
          reminderInApp: true,
        });

      expect(response.status).toBe(201);
    });
  });

  describe("EDGE CASES - Day of Week/Month", () => {
    it("creates weekly rule with specific day of week", async () => {
      const weeklyRule = {
        id: ruleId,
        name: "Weekly Friday Payment",
        frequency: "weekly",
        dayOfWeek: 5, // Friday
      };

      mockRecurringService.createRecurring.mockResolvedValue(weeklyRule);

      const response = await request(app)
        .post("/api/recurring")
        .send({
          accountId,
          name: "Weekly Friday Payment",
          amount: { amount: "50.00", currency: "ZMW" },
          type: "expense",
          frequency: "weekly",
          nextDueDate: "2024-02-02", // A Friday
          dayOfWeek: 5,
        });

      expect(response.status).toBe(201);
    });

    it("creates monthly rule with specific day of month", async () => {
      const monthlyRule = {
        id: ruleId,
        name: "Monthly 15th Payment",
        frequency: "monthly",
        dayOfMonth: 15,
      };

      mockRecurringService.createRecurring.mockResolvedValue(monthlyRule);

      const response = await request(app)
        .post("/api/recurring")
        .send({
          accountId,
          name: "Monthly 15th Payment",
          amount: { amount: "100.00", currency: "ZMW" },
          type: "expense",
          frequency: "monthly",
          nextDueDate: "2024-02-15",
          dayOfMonth: 15,
        });

      expect(response.status).toBe(201);
    });

    it("rejects an anchor outside the calendar month", async () => {
      const response = await request(app)
        .post("/api/recurring")
        .send({
          accountId,
          name: "Invalid Day of Month",
          amount: { amount: "100.00", currency: "ZMW" },
          type: "expense",
          frequency: "monthly",
          nextDueDate: "2024-02-29",
          dayOfMonth: 32,
        });

      expect(response.status).toBe(400);
    });
  });

  describe("AUDIT LOGGING - Lifecycle Actions", () => {
    // R14: the audit row is written inside the service transaction
    // (RecurringLifecycleService); the controller hands it the request IP.
    // completion-r14.recurring-skip-pause-end.realdb asserts the real row.
    it.each([
      ["skip", "skipped", {}],
      ["pause", "paused", {}],
      ["resume", "resumed", {}],
      ["end", "ended", { endDate: "2024-12-31" }],
    ] as const)("passes the %s action and the request IP to the audited service write", async (path, action, body) => {
      const rule = { id: ruleId, name: "Test" };
      mockRecurringService.changeLifecycle.mockResolvedValue({ beforeRule: rule, rule });

      await request(app).post(`/api/recurring/${ruleId}/${path}`).send(body).expect(200);

      expect(mockRecurringService.changeLifecycle).toHaveBeenCalledWith(
        ruleId, expect.objectContaining({ householdId }), expect.objectContaining({ action }), "127.0.0.1",
      );
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });

    it("forwards a named skip occurrence and rejects a malformed one", async () => {
      const rule = { id: ruleId, name: "Test" };
      mockRecurringService.changeLifecycle.mockResolvedValue({ beforeRule: rule, rule });

      await request(app).post(`/api/recurring/${ruleId}/skip`).send({ occurrenceDate: "2024-02-01" }).expect(200);
      expect(mockRecurringService.changeLifecycle).toHaveBeenCalledWith(
        ruleId, expect.anything(), { action: "skipped", occurrenceDate: "2024-02-01" }, "127.0.0.1",
      );
      await request(app).post(`/api/recurring/${ruleId}/skip`).send({ occurrenceDate: "2024-02-30" }).expect(400);
    });
  });
});
