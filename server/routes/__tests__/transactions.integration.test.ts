import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ============================================================================
// MOCKS (Hoisted)
// ============================================================================
const {
  mockTransactionRepository,
  mockAccountRepository,
  mockRuleService,
  mockRecurringService,
  mockNotificationService,
  mockOutboxEventService,
  mockMerchantRecognition,
  mockBusinessAuditService,
  mockHouseholdRepository,
} = vi.hoisted(() => ({
  mockTransactionRepository: {
    create: vi.fn(),
    findByIdWithVisibility: vi.fn(),
    findByIdempotencyKey: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    findByHouseholdWithVisibility: vi.fn(),
  },
  mockAccountRepository: {
    findByIdWithVisibility: vi.fn(),
    findById: vi.fn(),
  },
  mockHouseholdRepository: {
    findPreferences: vi
      .fn()
      .mockResolvedValue({ showPendingTransactions: true }),
    findById: vi.fn().mockResolvedValue({ id: "house-123", currency: "ZMW" }),
    findMember: vi
      .fn()
      .mockResolvedValue({ userId: "user-123", role: "member" }),
  },
  mockRuleService: {
    applyRules: vi.fn(),
  },
  mockRecurringService: {
    autoLinkNewTransaction: vi.fn(),
  },
  mockNotificationService: {
    triggerLargeTransaction: vi.fn().mockResolvedValue(undefined),
  },
  mockOutboxEventService: {
    publish: vi.fn().mockResolvedValue(undefined),
  },
  mockMerchantRecognition: {
    resolveMerchantMatch: vi.fn(),
    ensureMerchantAlias: vi.fn(),
  },
  mockBusinessAuditService: {
    logCreate: vi.fn().mockResolvedValue(undefined),
    logUpdate: vi.fn().mockResolvedValue(undefined),
    logDelete: vi.fn().mockResolvedValue(undefined),
    getIpAddress: vi.fn().mockReturnValue("127.0.0.1"),
  },
}));

// Mock Dependencies
vi.mock("../../repositories/TransactionRepository", () => ({
  transactionRepository: mockTransactionRepository,
}));

// Keep the unit test hermetic: the service imports this module for atomic
// transfer-pair deletion; the non-transfer paths under test never call it.
vi.mock("../../repositories/TransactionTransferRepository", () => ({
  transactionTransferRepository: {
    createTransfer: vi.fn(),
    findTransferPair: vi.fn(),
    softDeleteTransferPair: vi.fn(),
  },
}));

vi.mock("../../repositories/AccountRepository", () => ({
  accountRepository: mockAccountRepository,
}));

vi.mock("../../repositories/HouseholdRepository", () => ({
  householdRepository: mockHouseholdRepository,
}));

vi.mock("../../repositories/CategoryRepository", () => ({
  categoryRepository: {
    findByIdAndHousehold: vi
      .fn()
      .mockResolvedValue({ id: "123e4567-e89b-12d3-a456-426614174212", householdId: "house-123" }),
  },
}));

vi.mock("../../services/RuleService", () => ({
  ruleService: mockRuleService,
}));

vi.mock("../../services/RecurringService", () => ({
  recurringService: mockRecurringService,
}));

vi.mock("../../services/NotificationService", () => ({
  notificationService: mockNotificationService,
}));

vi.mock("../../core/events", () => ({
  outboxEventService: mockOutboxEventService,
  EventTypes: {
    TRANSACTION_CREATED: "TRANSACTION_CREATED",
    TRANSACTION_UPDATED: "TRANSACTION_UPDATED",
    TRANSACTION_DELETED: "TRANSACTION_DELETED",
  },
}));

vi.mock("../../services/merchantRecognition", () => mockMerchantRecognition);

vi.mock("../../services/CacheInvalidation", () => ({
  invalidateOnChange: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/BusinessAuditService", () => ({
  businessAuditService: mockBusinessAuditService,
}));

vi.mock("../../utils/withTransaction", () => ({
  withTransaction: async (fn: () => Promise<unknown>) => fn(),
}));

// Mock Middleware
vi.mock("../../middleware/householdGuard", () => ({
  householdGuard: (req: any, res: any, next: any) => {
    req.householdContext = {
      householdId: "house-123",
      userId: "user-123",
      role: "admin",
    };
    req.user = { id: "user-123" };
    next();
  },
}));

vi.mock("../../middleware/validateEntity", () => ({
  requireRole: () => (req: any, res: any, next: any) => next(),
  validateEntity: () => (req: any, res: any, next: any) => next(),
}));

// Import Routes (this will use the mocks)
import transactionsRouter from "../../modules/transactions/transactions.routes";
import { ValidationError, NotFoundError, AuthorizationError } from "../../utils/errorHandler";

const app = express();
app.use(express.json());
// Mock rawBody needed for some middlewares potentially, though usually json() handles it
app.use((req: any, res, next) => {
  req.rawBody = Buffer.from(JSON.stringify(req.body));
  next();
});
app.use("/api/transactions", transactionsRouter);

// Error handler for tests
app.use((err: any, req: any, res: any, next: any) => {
  if (err instanceof ValidationError) {
    return res.status(400).json({ success: false, error: err.message });
  }
  if (err instanceof NotFoundError) {
    return res.status(404).json({ success: false, error: err.message });
  }
  if (err instanceof AuthorizationError) {
    return res.status(403).json({ success: false, error: err.message });
  }
  return res.status(500).json({ success: false, error: err.message || "Internal Server Error" });
});

describe("Transactions Integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();

    mockHouseholdRepository.findPreferences.mockResolvedValue({
      showPendingTransactions: true,
    });
    mockHouseholdRepository.findById.mockResolvedValue({
      id: "house-123",
      currency: "ZMW",
    });
  });

  describe("POST /api/transactions", () => {
    it("should create transaction and emit event", async () => {
      const mockResult = {
        id: "123e4567-e89b-12d3-a456-426614174003",
        amount: "100.00",
        type: "expense",
        accountId: "123e4567-e89b-12d3-a456-426614174001",
      };

      // Setup Mocks
      mockAccountRepository.findByIdWithVisibility.mockResolvedValue({
        id: "123e4567-e89b-12d3-a456-426614174001",
        currency: "ZMW", // Required for currency enforcement
      });
      mockMerchantRecognition.resolveMerchantMatch.mockResolvedValue({});
      mockTransactionRepository.create.mockResolvedValue({
        transaction: mockResult,
      });
      mockRuleService.applyRules.mockResolvedValue(mockResult);

      const res = await request(app)
        .post("/api/transactions")
        .send({
          amount: { amount: "100.00", currency: "ZMW" },
          date: "2024-01-01",
          description: "Test Expense Description", // REQUIRED by schema
          name: "Test Expense Name", // used by service
          accountId: "123e4567-e89b-12d3-a456-426614174001", // Valid UUID
          type: "expense",
          categoryId: "123e4567-e89b-12d3-a456-426614174002", // Valid UUID
        });

      if (res.status !== 200) {
        console.error("Test Failed Body:", JSON.stringify(res.body, null, 2));
      }

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      // Verify Event Published
      expect(mockOutboxEventService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "TRANSACTION_CREATED",
          aggregateId: "123e4567-e89b-12d3-a456-426614174003",
        })
      );

      // P6a: the CREATE audit row is now written atomically at the
      // repository layer (inside transactionRepository.create's `audit`
      // option), not by the controller calling businessAuditService
      // directly — mockTransactionRepository.create is mocked wholesale
      // here, so verify the service wired the audit context through to it
      // instead. The real row is proven for real Postgres by
      // p6a-create-delete-audit.realdb.integration.test.ts.
      expect(mockBusinessAuditService.logCreate).not.toHaveBeenCalled();
      expect(mockTransactionRepository.create).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          audit: expect.objectContaining({
            userId: "user-123",
            householdId: "house-123",
          }),
        })
      );
    });

    it("should fail validation for invalid type", async () => {
      mockAccountRepository.findByIdWithVisibility.mockResolvedValue({
        id: "123e4567-e89b-12d3-a456-426614174001",
        currency: "ZMW",
      });

      const res = await request(app)
        .post("/api/transactions")
        .send({
          amount: { amount: "100.00", currency: "ZMW" },
          date: "2024-01-01",
          description: "Test Invalid",
          accountId: "123e4567-e89b-12d3-a456-426614174001",
          type: "INVALID_TYPE",
        });

      expect(res.status).not.toBe(200);
    });
  });

  describe("PUT /api/transactions/:id", () => {
    it("should update transaction and emit event", async () => {
      const txnId = "123e4567-e89b-12d3-a456-426614174003";
      const mockTxn = {
        id: txnId,
        amount: "100.00",
        type: "expense",
        accountId: "123e4567-e89b-12d3-a456-426614174001",
        ownerUserId: "user-123",
      };

      mockTransactionRepository.findByIdWithVisibility.mockResolvedValue(
        mockTxn
      );
      mockTransactionRepository.update.mockResolvedValue({
        transaction: mockTxn,
      });
      mockMerchantRecognition.resolveMerchantMatch.mockResolvedValue({});
      // Mock for currency validation on update
      mockAccountRepository.findById.mockResolvedValue({
        id: "123e4567-e89b-12d3-a456-426614174001",
        currency: "ZMW",
      });

      const res = await request(app)
        .put(`/api/transactions/${txnId}`)
        .send({
          amount: { amount: "150.00", currency: "ZMW" },
          description: "Updated Description",
        });

      expect(res.status).toBe(200);

      expect(mockOutboxEventService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "TRANSACTION_UPDATED",
          aggregateId: txnId,
        })
      );

      // P8b: the UPDATE audit row is now written once at the SERVICE layer
      // (transactionService.updateTransaction), not by the controller — so
      // controller-bypassing callers stay audited and updates no longer write
      // two rows. The controller only forwards ipAddress/metadata, so this
      // controller-level mock must never be called directly. The real audit
      // behaviour is covered against real Postgres in
      // server/services/transaction/__tests__/p8b-update-audit.realdb.integration.test.ts
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /api/transactions/:id", () => {
    it("should soft delete transaction and emit event", async () => {
      const txnId = "123e4567-e89b-12d3-a456-426614174003";
      const mockTxn = {
        id: txnId,
        ownerUserId: "user-123",
      };

      mockTransactionRepository.findByIdWithVisibility.mockResolvedValue(
        mockTxn
      );
      mockTransactionRepository.softDelete.mockResolvedValue(true);

      const res = await request(app).delete(`/api/transactions/${txnId}`);

      expect(res.status).toBe(200);

      expect(mockOutboxEventService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "TRANSACTION_DELETED",
          aggregateId: txnId,
        })
      );

      // P6a: the DELETE audit row is now written atomically at the
      // repository layer (inside transactionRepository.softDelete's `audit`
      // option), not by the controller calling businessAuditService
      // directly — mockTransactionRepository.softDelete is mocked wholesale
      // here, so verify the service wired the audit context through to it
      // instead. The real row is proven for real Postgres by
      // p6a-create-delete-audit.realdb.integration.test.ts.
      expect(mockBusinessAuditService.logDelete).not.toHaveBeenCalled();
      expect(mockTransactionRepository.softDelete).toHaveBeenCalledWith(
        txnId,
        "house-123",
        expect.objectContaining({
          audit: expect.objectContaining({ userId: "user-123" }),
        })
      );
    });
  });

  describe("Currency Enforcement (T-10 Fix)", () => {
    it("should reject transaction with currency not matching account", async () => {
      // Account is ZMW, but transaction tries to use USD
      mockAccountRepository.findByIdWithVisibility.mockResolvedValue({
        id: "123e4567-e89b-12d3-a456-426614174001",
        currency: "ZMW",
      });

      const res = await request(app)
        .post("/api/transactions")
        .send({
          amount: { amount: "100.00", currency: "USD" }, // Mismatched currency
          date: "2024-01-01",
          name: "Test Expense",
          accountId: "123e4567-e89b-12d3-a456-426614174001",
          type: "expense",
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("currency");
    });

    it("should accept transaction with currency matching account", async () => {
      const mockResult = {
        id: "123e4567-e89b-12d3-a456-426614174003",
        amount: "100.00",
        type: "expense",
        accountId: "123e4567-e89b-12d3-a456-426614174001",
        currency: "ZMW",
      };

      mockAccountRepository.findByIdWithVisibility.mockResolvedValue({
        id: "123e4567-e89b-12d3-a456-426614174001",
        currency: "ZMW",
      });
      mockMerchantRecognition.resolveMerchantMatch.mockResolvedValue({});
      mockTransactionRepository.create.mockResolvedValue({
        transaction: mockResult,
      });
      mockRuleService.applyRules.mockResolvedValue(mockResult);

      const res = await request(app)
        .post("/api/transactions")
        .send({
          amount: { amount: "100.00", currency: "ZMW" }, // Matching currency
          date: "2024-01-01",
          name: "Test Expense",
          accountId: "123e4567-e89b-12d3-a456-426614174001",
          type: "expense",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });

  describe("GET /api/transactions/summary", () => {
    it("forwards tagIds to the summary service", async () => {
      const tagId = "123e4567-e89b-12d3-a456-426614174111";
      const { transactionService } = await import(
        "../../services/TransactionService"
      );

      const validateSpy = vi
        .spyOn(transactionService, "validateTagIds")
        .mockResolvedValue(undefined);
      const summarySpy = vi
        .spyOn(transactionService, "getTransactionSummary")
        .mockResolvedValue({
          totalIncome: 100,
          totalExpenses: 40,
          netFlow: 60,
          transactionCount: 3,
          currency: "ZMW",
        });

      const res = await request(app).get(
        `/api/transactions/summary?startDate=2024-01-01&endDate=2024-01-31&tags=${tagId}`,
      );

      expect(res.status).toBe(200);
      expect(validateSpy).toHaveBeenCalledWith([tagId], "house-123");
      expect(summarySpy).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        "2024-01-01",
        "2024-01-31",
        expect.objectContaining({ tagIds: [tagId] }),
      );
    });
  });

  describe("Bulk operations authorization and private visibility", () => {
    const privateTxnId = "123e4567-e89b-12d3-a456-426614174211";
    const categoryId = "123e4567-e89b-12d3-a456-426614174212";
    const ownerUserId = "123e4567-e89b-12d3-a456-426614174213";
    const accountId = "123e4567-e89b-12d3-a456-426614174214";

    beforeEach(() => {
      mockTransactionRepository.findByIdWithVisibility.mockResolvedValue({
        id: privateTxnId,
        accountId,
        type: "expense",
        name: "Private txn",
        merchantId: null,
        isPrivate: true,
        ownerUserId: "other-user",
      });
      mockTransactionRepository.update.mockResolvedValue({
        transaction: null,
        conflict: false,
      });
    });

    it("does not bulk-categorize private transactions owned by another user", async () => {
      const res = await request(app)
        .put("/api/transactions/bulk-category")
        .send({ transactionIds: [privateTxnId], categoryId });

      expect(res.status).toBe(200);
      expect(res.body.data.successCount).toBe(0);
      expect(mockTransactionRepository.update).not.toHaveBeenCalled();
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });

    it("does not bulk-review private transactions owned by another user", async () => {
      const res = await request(app)
        .put("/api/transactions/bulk-review")
        .send({ transactionIds: [privateTxnId], reviewed: true });

      expect(res.status).toBe(200);
      expect(res.body.data.successCount).toBe(0);
      expect(mockTransactionRepository.update).not.toHaveBeenCalled();
    });

    it("rejects bulk ownership changes on private transactions owned by another user", async () => {
      const res = await request(app)
        .put("/api/transactions/bulk-owner")
        .send({ transactionIds: [privateTxnId], ownerUserId });

      expect(res.status).toBe(403);
      expect(mockTransactionRepository.update).not.toHaveBeenCalled();
    });
  });
});
