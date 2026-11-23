/**
 * Transactions Module - Integration Tests
 *
 * Tests CRUD operations, transfers, bulk operations, attachments,
 * privacy/visibility, and audit logging.
 *
 * Coverage targets: 80%+ for financial operations (per CLAUDE.md Rule 17)
 *
 * Uses mocked middleware pattern for reliable testing of all endpoints.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ============================================================================
// MOCKS (Hoisted)
// ============================================================================
const {
  mockTransactionService,
  mockTransactionGoalLinkService,
  mockBusinessAuditService,
  mockHouseholdRepository,
} = vi.hoisted(() => ({
  mockTransactionService: {
    getTransactions: vi.fn(),
    getTransactionsCount: vi.fn(),
    getTransactionById: vi.fn(),
    createTransaction: vi.fn(),
    updateTransaction: vi.fn(),
    deleteTransaction: vi.fn(),
    getTransactionSummary: vi.fn(),
    updateOwner: vi.fn(),
    markReviewed: vi.fn(),
    markUnreviewed: vi.fn(),
    validateTagIds: vi.fn().mockResolvedValue(true),
    addTagsToTransaction: vi.fn().mockResolvedValue(undefined),
    createTransfer: vi.fn(),
    updateTransfer: vi.fn(),
    bulkUpdateOwner: vi.fn(),
    bulkUpdateCategory: vi.fn(),
    bulkAddTags: vi.fn(),
    bulkReview: vi.fn(),
    bulkDelete: vi.fn(),
  },
  mockTransactionGoalLinkService: {
    getLinksForTransaction: vi.fn(),
    linkTransaction: vi.fn(),
    unlinkTransaction: vi.fn(),
  },
  mockBusinessAuditService: {
    log: vi.fn().mockResolvedValue(undefined),
    logCreate: vi.fn().mockResolvedValue(undefined),
    logUpdate: vi.fn().mockResolvedValue(undefined),
    logDelete: vi.fn().mockResolvedValue(undefined),
    getIpAddress: vi.fn().mockReturnValue("127.0.0.1"),
  },
  mockHouseholdRepository: {
    findPreferences: vi.fn().mockResolvedValue({ showPendingTransactions: true }),
  },
}));

// Mock Services
vi.mock("../../../services/TransactionService", () => ({
  transactionService: mockTransactionService,
}));

vi.mock("../../../services/TransactionGoalLinkService", () => ({
  transactionGoalLinkService: mockTransactionGoalLinkService,
}));

vi.mock("../../../services/goal/GoalViewerProgress", () => ({
  readGoalSourceVisibility: vi.fn(async (_actor: unknown, ids: string[]) => new Map(ids.map((id) => [
    id, { progressVisible: true, linkedAccountVisible: true, debtAccountVisible: true },
  ]))),
}));

vi.mock("../../../services/BusinessAuditService", () => ({
  businessAuditService: mockBusinessAuditService,
}));

vi.mock("../../../repositories/HouseholdRepository", () => ({
  householdRepository: mockHouseholdRepository,
}));

// Keep the response mapper real. The signed database suites exercise the
// custody projection; this controller suite supplies the authorized reread.
vi.mock("../transactions.helpers", async importOriginal => {
  const actual = await importOriginal<typeof import("../transactions.helpers")>();
  return { ...actual, mapVisibleTransactionMoney: async (id: string, actor: { householdId: string; userId: string }) =>
    actual.mapTransactionMoney(await mockTransactionService.getTransactionById(id, actor.householdId, actor.userId)) };
});

// bulk-category validates the category via this repository (real DB otherwise).
vi.mock("../../../repositories/CategoryRepository", () => ({
  categoryRepository: {
    findByIdAndHousehold: vi
      .fn()
      .mockResolvedValue({ id: "category", name: "Category" }),
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
  validateEntity: () => (req: any, res: any, next: any) => next(),
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
import transactionsRouter from "../transactions.routes";
import { errorHandler } from "../../../core/errors/errorHandler";

const app = express();
app.use(express.json());
app.use("/api/transactions", transactionsRouter);
app.use(errorHandler);

describe("Transactions Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // LIST & SUMMARY
  // =========================================================================

  describe("GET /api/transactions - List Transactions", () => {
    it("should return transactions with pagination", async () => {
      const mockTransactions = [
        {
          id: "00000000-0000-4000-8000-000000000018",
          name: "Grocery Store",
          amount: "50.00",
          currency: "ZMW",
          type: "expense",
          date: "2026-01-15",
          accountId: "00000000-0000-4000-8000-000000000012",
          categoryId: "00000000-0000-4000-8000-000000000014",
        },
        {
          id: "00000000-0000-4000-8000-000000000019",
          name: "Salary",
          amount: "5000.00",
          currency: "ZMW",
          type: "income",
          date: "2026-01-01",
          accountId: "00000000-0000-4000-8000-000000000012",
          categoryId: "00000000-0000-4000-8000-000000000015",
        },
      ];

      mockTransactionService.getTransactions.mockResolvedValue(mockTransactions);
      mockTransactionService.getTransactionsCount.mockResolvedValue(2);

      const res = await request(app)
        .get("/api/transactions")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.total).toBe(2);
    });

    it("should apply date filters", async () => {
      mockTransactionService.getTransactions.mockResolvedValue([]);
      mockTransactionService.getTransactionsCount.mockResolvedValue(0);

      await request(app)
        .get("/api/transactions?startDate=2026-01-01&endDate=2026-01-31")
        .expect(200);

      expect(mockTransactionService.getTransactions).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          startDate: "2026-01-01",
          endDate: "2026-01-31",
        })
      );
    });

    it("should filter by account", async () => {
      mockTransactionService.getTransactions.mockResolvedValue([]);
      mockTransactionService.getTransactionsCount.mockResolvedValue(0);

      await request(app)
        .get("/api/transactions?accountId=00000000-0000-4000-8000-000000000012")
        .expect(200);

      expect(mockTransactionService.getTransactions).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({ accountId: "00000000-0000-4000-8000-000000000012" })
      );
    });

    it("should filter by category", async () => {
      mockTransactionService.getTransactions.mockResolvedValue([]);
      mockTransactionService.getTransactionsCount.mockResolvedValue(0);

      await request(app)
        .get("/api/transactions?categoryId=00000000-0000-4000-8000-000000000014")
        .expect(200);

      expect(mockTransactionService.getTransactions).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({ categoryId: "00000000-0000-4000-8000-000000000014" })
      );
    });

    it("should filter by type (income/expense)", async () => {
      mockTransactionService.getTransactions.mockResolvedValue([]);
      mockTransactionService.getTransactionsCount.mockResolvedValue(0);

      await request(app)
        .get("/api/transactions?type=expense")
        .expect(200);

      expect(mockTransactionService.getTransactions).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({ type: "expense" })
      );
    });

    it("should filter by tags", async () => {
      mockTransactionService.getTransactions.mockResolvedValue([]);
      mockTransactionService.getTransactionsCount.mockResolvedValue(0);

      // The list endpoint reads the comma-separated `tags` query param.
      await request(app)
        .get("/api/transactions?tags=00000000-0000-4000-8000-000000000016,00000000-0000-4000-8000-000000000017")
        .expect(200);

      expect(mockTransactionService.validateTagIds).toHaveBeenCalledWith(
        ["00000000-0000-4000-8000-000000000016", "00000000-0000-4000-8000-000000000017"],
        "house-123"
      );
    });

    it("should support search query", async () => {
      mockTransactionService.getTransactions.mockResolvedValue([]);
      mockTransactionService.getTransactionsCount.mockResolvedValue(0);

      await request(app)
        .get("/api/transactions?search=grocery")
        .expect(200);

      expect(mockTransactionService.getTransactions).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({ search: "grocery" })
      );
    });

    it("should support pagination parameters", async () => {
      mockTransactionService.getTransactions.mockResolvedValue([]);
      mockTransactionService.getTransactionsCount.mockResolvedValue(100);

      const res = await request(app)
        .get("/api/transactions?limit=25&offset=50")
        .expect(200);

      expect(res.body.pagination.page).toBe(2);
      expect(res.body.pagination.hasNext).toBe(true);
      expect(res.body.pagination.hasPrev).toBe(true);
    });

    it("should sort by date descending by default", async () => {
      mockTransactionService.getTransactions.mockResolvedValue([]);
      mockTransactionService.getTransactionsCount.mockResolvedValue(0);

      await request(app)
        .get("/api/transactions")
        .expect(200);

      expect(mockTransactionService.getTransactions).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          sortBy: "date",
          sortOrder: "desc",
        })
      );
    });

    it("should support custom sorting", async () => {
      mockTransactionService.getTransactions.mockResolvedValue([]);
      mockTransactionService.getTransactionsCount.mockResolvedValue(0);

      await request(app)
        .get("/api/transactions?sortBy=amount&sortOrder=asc")
        .expect(200);

      expect(mockTransactionService.getTransactions).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({
          sortBy: "amount",
          sortOrder: "asc",
        })
      );
    });
  });

  describe("GET /api/transactions/summary - Transaction Summary", () => {
    it("should return income/expense summary", async () => {
      const mockSummary = {
        currency: "ZMW", largestIncome: "5000.00", largestExpense: "2000.00",
        totalIncome: "5000.00",
        totalExpenses: "2000.00",
        netFlow: "3000.00",
        transactionCount: 25,
      };

      mockTransactionService.getTransactionSummary.mockResolvedValue(mockSummary);

      const res = await request(app)
        .get("/api/transactions/summary?startDate=2026-01-01&endDate=2026-01-31")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.totalIncome).toBeDefined();
      expect(res.body.data.totalExpenses).toBeDefined();
      expect(res.body.data.netFlow).toBeDefined();
    });

    it("should require date range", async () => {
      const res = await request(app)
        .get("/api/transactions/summary")
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should reject invalid date format", async () => {
      const res = await request(app)
        .get("/api/transactions/summary?startDate=01-01-2026&endDate=01-31-2026")
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should reject impossible dates", async () => {
      const res = await request(app)
        .get("/api/transactions/summary?startDate=2026-02-30&endDate=2026-03-01")
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // CRUD OPERATIONS
  // =========================================================================

  describe("GET /api/transactions/:id - Get Transaction by ID", () => {
    it("should return transaction by id", async () => {
      const mockTransaction = {
        id: "00000000-0000-4000-8000-000000000018",
        name: "Test Transaction",
        amount: "100.00",
        currency: "ZMW",
        type: "expense",
        date: "2026-01-15",
        accountId: "00000000-0000-4000-8000-000000000012",
        categoryId: "00000000-0000-4000-8000-000000000014",
        householdId: "house-123",
      };

      mockTransactionService.getTransactionById.mockResolvedValue(mockTransaction);

      const res = await request(app)
        .get("/api/transactions/00000000-0000-4000-8000-000000000018")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe("00000000-0000-4000-8000-000000000018");
    });

    it("should return 404 for non-existent transaction", async () => {
      mockTransactionService.getTransactionById.mockRejectedValue(
        new Error("Transaction not found")
      );

      const res = await request(app)
        .get("/api/transactions/non-existent");

      expect([404, 500]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });
  });

  describe("POST /api/transactions - Create Transaction", () => {
    it("should create an expense transaction", async () => {
      const mockTransaction = {
        id: "00000000-0000-4000-8000-00000000000f",
        name: "Grocery Shopping",
        amount: "150.00",
        currency: "ZMW",
        type: "expense",
        date: "2026-01-20",
        accountId: "00000000-0000-4000-8000-000000000012",
        categoryId: "00000000-0000-4000-8000-000000000014",
      };

      mockTransactionService.getTransactionById.mockResolvedValue(mockTransaction);
      mockTransactionService.createTransaction.mockResolvedValue({
        transaction: mockTransaction,
        isDuplicate: false,
      });

      const res = await request(app)
        .post("/api/transactions")
        .send({
          accountId: "00000000-0000-4000-8000-000000000012",
          amount: { amount: "150.00", currency: "ZMW" },
          type: "expense",
          date: "2026-01-20",
          description: "Grocery Shopping",
          categoryId: "00000000-0000-4000-8000-000000000014",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe("00000000-0000-4000-8000-00000000000f");
      expect(res.body.isDuplicate).toBe(false);
      // P6a: the CREATE audit row is now written atomically at the
      // repository layer (inside the mocked transactionService here), so the
      // controller no longer calls businessAuditService directly — it only
      // forwards the request IP so the service/repo can audit with it. A
      // REAL-DB test proves the row itself gets written: see
      // server/services/transaction/__tests__/p6a-create-delete-audit.realdb.integration.test.ts
      expect(mockBusinessAuditService.logCreate).not.toHaveBeenCalled();
      expect(mockTransactionService.createTransaction).toHaveBeenCalledWith(
        expect.any(Object),
        "house-123",
        "user-123",
        undefined,
        expect.objectContaining({ ipAddress: "127.0.0.1" })
      );
    });

    it("should create an income transaction", async () => {
      const mockTransaction = {
        id: "00000000-0000-4000-8000-000000000006",
        name: "Salary",
        amount: "5000.00",
        currency: "ZMW",
        type: "income",
        date: "2026-01-01",
        accountId: "00000000-0000-4000-8000-000000000012",
        categoryId: "00000000-0000-4000-8000-000000000005",
      };

      mockTransactionService.getTransactionById.mockResolvedValue(mockTransaction);
      mockTransactionService.createTransaction.mockResolvedValue({
        transaction: mockTransaction,
        isDuplicate: false,
      });

      const res = await request(app)
        .post("/api/transactions")
        .send({
          accountId: "00000000-0000-4000-8000-000000000012",
          amount: { amount: "5000.00", currency: "ZMW" },
          type: "income",
          date: "2026-01-01",
          description: "Salary",
          categoryId: "00000000-0000-4000-8000-000000000005",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe("income");
    });

    it("should handle idempotency key for duplicate prevention", async () => {
      const mockTransaction = {
        id: "00000000-0000-4000-8000-000000000002",
        name: "Test",
        amount: "100.00",
        currency: "ZMW",
        type: "expense",
        date: "2026-01-15",
      };

      mockTransactionService.getTransactionById.mockResolvedValue(mockTransaction);
      mockTransactionService.createTransaction.mockResolvedValue({
        transaction: mockTransaction,
        isDuplicate: true,
      });

      const res = await request(app)
        .post("/api/transactions")
        .send({
          accountId: "00000000-0000-4000-8000-000000000012",
          amount: { amount: "100.00", currency: "ZMW" },
          type: "expense",
          date: "2026-01-15",
          description: "Test",
          idempotencyKey: "00000000-0000-4000-8000-0000000000a2",
        })
        .expect(200); // Returns 200 for duplicate, not 201

      expect(res.body.isDuplicate).toBe(true);
    });

    it("should reject negative amount", async () => {
      const res = await request(app)
        .post("/api/transactions")
        .send({
          accountId: "00000000-0000-4000-8000-000000000012",
          amount: { amount: "-100.00", currency: "ZMW" },
          type: "expense",
          date: "2026-01-15",
          description: "Invalid Amount",
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should reject invalid date", async () => {
      const res = await request(app)
        .post("/api/transactions")
        .send({
          accountId: "00000000-0000-4000-8000-000000000012",
          amount: { amount: "100.00", currency: "ZMW" },
          type: "expense",
          date: "2026-02-30", // Invalid date
          description: "Invalid Date",
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should reject invalid transaction type", async () => {
      const res = await request(app)
        .post("/api/transactions")
        .send({
          accountId: "00000000-0000-4000-8000-000000000012",
          amount: { amount: "100.00", currency: "ZMW" },
          type: "invalid_type",
          date: "2026-01-15",
          description: "Test",
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should handle split transactions", async () => {
      const mockTransaction = {
        id: "00000000-0000-4000-8000-00000000000b",
        name: "Split Transaction",
        amount: "100.00",
        currency: "ZMW",
        type: "expense",
        date: "2026-01-15",
        splits: [
          { amount: "60.00", categoryId: "00000000-0000-4000-8000-000000000014" },
          { amount: "40.00", categoryId: "00000000-0000-4000-8000-000000000015" },
        ],
      };

      mockTransactionService.getTransactionById.mockResolvedValue(mockTransaction);
      mockTransactionService.createTransaction.mockResolvedValue({
        transaction: mockTransaction,
        isDuplicate: false,
      });

      const res = await request(app)
        .post("/api/transactions")
        .send({
          accountId: "00000000-0000-4000-8000-000000000012",
          amount: { amount: "100.00", currency: "ZMW" },
          type: "expense",
          date: "2026-01-15",
          description: "Split Transaction",
          splits: [
            { amount: { amount: "60.00", currency: "ZMW" }, categoryId: "00000000-0000-4000-8000-000000000014" },
            { amount: { amount: "40.00", currency: "ZMW" }, categoryId: "00000000-0000-4000-8000-000000000015" },
          ],
        })
        .expect(201);

      expect(res.body.success).toBe(true);
    });
  });

  describe("PUT /api/transactions/:id - Update Transaction", () => {
    it("should update transaction amount", async () => {
      const existingTransaction = {
        id: "00000000-0000-4000-8000-000000000018",
        name: "Original",
        amount: "100.00",
        currency: "ZMW",
        type: "expense",
        date: "2026-01-15",
        categoryId: "00000000-0000-4000-8000-000000000014",
      };
      const updatedTransaction = {
        ...existingTransaction,
        amount: "150.00",
      };

      mockTransactionService.getTransactionById.mockResolvedValue(existingTransaction);
      mockTransactionService.updateTransaction.mockResolvedValue(updatedTransaction);

      const res = await request(app)
        .put("/api/transactions/00000000-0000-4000-8000-000000000018")
        .send({
          amount: { amount: "150.00", currency: "ZMW" },
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      // P8b: the UPDATE audit row is now written atomically at the service
      // layer (inside the mocked transactionService here), so the controller
      // no longer calls businessAuditService directly — it only forwards the
      // request IP into the service call. A REAL-DB test proves the row
      // itself gets written exactly once: see
      // server/services/transaction/__tests__/p8b-update-audit.realdb.integration.test.ts
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
      expect(mockTransactionService.updateTransaction).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000018",
        expect.any(Object),
        "house-123",
        "user-123",
        undefined,
        expect.objectContaining({ ipAddress: "127.0.0.1" })
      );
    });

    it("should update transaction category", async () => {
      const existingTransaction = {
        id: "00000000-0000-4000-8000-000000000018",
        name: "Test",
        amount: "100.00",
        currency: "ZMW",
        categoryId: "00000000-0000-4000-8000-000000000014",
      };
      const updatedTransaction = {
        ...existingTransaction,
        categoryId: "00000000-0000-4000-8000-000000000015",
      };

      mockTransactionService.getTransactionById.mockResolvedValue(existingTransaction);
      mockTransactionService.updateTransaction.mockResolvedValue(updatedTransaction);

      const res = await request(app)
        .put("/api/transactions/00000000-0000-4000-8000-000000000018")
        .send({ categoryId: "00000000-0000-4000-8000-000000000015" })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it("should support optimistic concurrency via updatedAt", async () => {
      const existingTransaction = {
        id: "00000000-0000-4000-8000-000000000018",
        name: "Test",
        amount: "100.00",
        updatedAt: "2026-01-15T10:00:00Z",
      };

      mockTransactionService.getTransactionById.mockResolvedValue(existingTransaction);
      mockTransactionService.updateTransaction.mockResolvedValue(existingTransaction);

      await request(app)
        .put("/api/transactions/00000000-0000-4000-8000-000000000018")
        .send({
          name: "Updated",
          updatedAt: "2026-01-15T10:00:00Z",
        })
        .expect(200);

      expect(mockTransactionService.updateTransaction).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000018",
        expect.any(Object),
        "house-123",
        "user-123",
        expect.any(Date),
        expect.objectContaining({ ipAddress: "127.0.0.1" })
      );
    });
  });

  describe("DELETE /api/transactions/:id - Delete Transaction", () => {
    it("should delete a transaction", async () => {
      const existingTransaction = {
        id: "00000000-0000-4000-8000-000000000018",
        name: "Delete Me",
        amount: "100.00",
        currency: "ZMW",
        type: "expense",
        date: "2026-01-15",
        accountId: "00000000-0000-4000-8000-000000000012",
        categoryId: "00000000-0000-4000-8000-000000000014",
      };

      mockTransactionService.getTransactionById.mockResolvedValue(existingTransaction);
      mockTransactionService.deleteTransaction.mockResolvedValue(undefined);

      const res = await request(app)
        .delete("/api/transactions/00000000-0000-4000-8000-000000000018")
        .expect(200);

      expect(res.body.success).toBe(true);
      // P6a: the DELETE audit row is now written atomically at the
      // repository layer (inside the mocked transactionService here), so the
      // controller no longer calls businessAuditService directly — it only
      // forwards the request IP. A REAL-DB test proves the row itself gets
      // written: see
      // server/services/transaction/__tests__/p6a-create-delete-audit.realdb.integration.test.ts
      expect(mockBusinessAuditService.logDelete).not.toHaveBeenCalled();
      expect(mockTransactionService.deleteTransaction).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000018",
        "house-123",
        "user-123",
        expect.objectContaining({ ipAddress: "127.0.0.1" })
      );
    });
  });

  // =========================================================================
  // TRANSFERS
  // =========================================================================

  describe("POST /api/transactions/transfer - Create Transfer", () => {
    it("should create a transfer between accounts", async () => {
      const mockResult = {
        outflow: {
          id: "00000000-0000-4000-8000-00000000000c",
          name: "Transfer Out",
          amount: "500.00",
          currency: "ZMW",
          type: "expense",
          accountId: "00000000-0000-4000-8000-000000000012",
        },
        inflow: {
          id: "00000000-0000-4000-8000-000000000011",
          name: "Transfer In",
          amount: "500.00",
          currency: "ZMW",
          type: "income",
          accountId: "00000000-0000-4000-8000-000000000013",
        },
        isDuplicate: false,
      };

      mockTransactionService.createTransfer.mockResolvedValue(mockResult);

      const res = await request(app)
        .post("/api/transactions/transfer")
        .send({
          fromAccountId: "00000000-0000-4000-8000-000000000012",
          toAccountId: "00000000-0000-4000-8000-000000000013",
          amount: { amount: "500.00", currency: "ZMW" },
          date: "2026-01-15",
          description: "Savings transfer",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
    });

    it("should reject transfer to same account", async () => {
      const res = await request(app)
        .post("/api/transactions/transfer")
        .send({
          fromAccountId: "00000000-0000-4000-8000-000000000012",
          toAccountId: "00000000-0000-4000-8000-000000000012", // Same account
          amount: { amount: "500.00", currency: "ZMW" },
          date: "2026-01-15",
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // OWNER & REVIEW
  // =========================================================================

  describe("PUT /api/transactions/:id/owner - Update Owner", () => {
    it("should update transaction owner", async () => {
      const mockTransaction = {
        id: "00000000-0000-4000-8000-000000000018",
        name: "Test",
        ownerUserId: "00000000-0000-4000-8000-0000000000a1",
      };

      mockTransactionService.updateOwner.mockResolvedValue(mockTransaction);

      const res = await request(app)
        .put("/api/transactions/00000000-0000-4000-8000-000000000018/owner")
        .send({ ownerUserId: "00000000-0000-4000-8000-0000000000a1" })
        .expect(200);

      expect(res.body.success).toBe(true);
      // P8b: updateOwner routes through transactionService.updateTransaction,
      // which writes the UPDATE audit row at the service layer — the
      // controller no longer audits separately.
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
      expect(mockTransactionService.updateOwner).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000018",
        "00000000-0000-4000-8000-0000000000a1",
        "house-123",
        "user-123",
        expect.objectContaining({ ipAddress: "127.0.0.1" })
      );
    });

    it("should allow clearing owner (set to null)", async () => {
      const mockTransaction = {
        id: "00000000-0000-4000-8000-000000000018",
        name: "Test",
        ownerUserId: null,
      };

      mockTransactionService.updateOwner.mockResolvedValue(mockTransaction);

      const res = await request(app)
        .put("/api/transactions/00000000-0000-4000-8000-000000000018/owner")
        .send({ ownerUserId: null })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it("should reject invalid UUID for owner", async () => {
      const res = await request(app)
        .put("/api/transactions/00000000-0000-4000-8000-000000000018/owner")
        .send({ ownerUserId: "not-a-uuid" })
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  describe("PUT /api/transactions/:id/review - Mark Reviewed", () => {
    it("should mark transaction as reviewed", async () => {
      const mockTransaction = {
        id: "00000000-0000-4000-8000-000000000018",
        name: "Test",
        reviewed: true,
        reviewedAt: "2026-01-20T10:00:00Z",
      };

      mockTransactionService.markReviewed.mockResolvedValue(mockTransaction);

      const res = await request(app)
        .put("/api/transactions/00000000-0000-4000-8000-000000000018/review")
        .send({ reviewed: true })
        .expect(200);

      expect(res.body.success).toBe(true);
      // P8b: markReviewed/markUnreviewed route through
      // transactionService.updateTransaction, which writes the UPDATE audit
      // row at the service layer — the controller no longer audits separately.
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
      expect(mockTransactionService.markReviewed).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000018",
        "house-123",
        "user-123",
        expect.objectContaining({ ipAddress: "127.0.0.1" })
      );
    });

    it("should mark transaction as unreviewed", async () => {
      const mockTransaction = {
        id: "00000000-0000-4000-8000-000000000018",
        name: "Test",
        reviewed: false,
        reviewedAt: null,
      };

      mockTransactionService.markUnreviewed.mockResolvedValue(mockTransaction);

      const res = await request(app)
        .put("/api/transactions/00000000-0000-4000-8000-000000000018/review")
        .send({ reviewed: false })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
      expect(mockTransactionService.markUnreviewed).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000018",
        "house-123",
        "user-123",
        expect.objectContaining({ ipAddress: "127.0.0.1" })
      );
    });

    it("should reject non-boolean reviewed value", async () => {
      const res = await request(app)
        .put("/api/transactions/00000000-0000-4000-8000-000000000018/review")
        .send({ reviewed: "yes" })
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // GOAL LINKS
  // =========================================================================

  describe("GET /api/transactions/:id/goals - Get Goal Links", () => {
    it("should return linked goals for transaction", async () => {
      const mockLinks = [
        {
          id: "link-1",
          transactionId: "00000000-0000-4000-8000-000000000018",
          goalId: "00000000-0000-4000-8000-000000000010",
          amount: "50.00",
          sourceAmount: "50.00",
          sourceCurrency: "ZMW",
          appliedDelta: "50.00",
          linkType: "contribution",
          goal: { id: "00000000-0000-4000-8000-000000000010", name: "Synthetic goal", currency: "ZMW" },
        },
      ];

      mockTransactionGoalLinkService.getLinksForTransaction.mockResolvedValue(mockLinks);

      const res = await request(app)
        .get("/api/transactions/00000000-0000-4000-8000-000000000018/goals")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data[0]).toMatchObject({
        amount: { amount: "50.00", currency: "ZMW" }, appliedDelta: { amount: "50.00", currency: "ZMW" },
      });
      expect(mockTransactionGoalLinkService.getLinksForTransaction).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000018",
        { householdId: "house-123", userId: "user-123", role: "admin" },
      );
    });

    it("should return empty array when no goals linked", async () => {
      mockTransactionGoalLinkService.getLinksForTransaction.mockResolvedValue([]);

      const res = await request(app)
        .get("/api/transactions/00000000-0000-4000-8000-000000000018/goals")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
      expect(mockTransactionGoalLinkService.getLinksForTransaction).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000018",
        { householdId: "house-123", userId: "user-123", role: "admin" },
      );
    });
  });

  // =========================================================================
  // BULK OPERATIONS
  // =========================================================================

  describe("PUT /api/transactions/bulk-owner - Bulk Update Owner", () => {
    it("should update owner for multiple transactions", async () => {
      const visibleRows = [
        { id: "00000000-0000-4000-8000-000000000018", name: "T", amount: "100.00", currency: "ZMW", type: "expense", date: "2026-01-15" },
        { id: "00000000-0000-4000-8000-000000000019", name: "T", amount: "100.00", currency: "ZMW", type: "expense", date: "2026-01-15" },
      ];
      mockTransactionService.bulkUpdateOwner.mockResolvedValue(visibleRows.map(({ id }) => ({ id })));
      mockTransactionService.getTransactionById.mockImplementation(async (id: string) => visibleRows.find(row => row.id === id));

      const res = await request(app)
        .put("/api/transactions/bulk-owner")
        .send({
          transactionIds: visibleRows.map(row => row.id),
          ownerUserId: "00000000-0000-4000-8000-0000000000a1",
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(visibleRows.map(row => ({
        ...row, amount: { amount: row.amount, currency: row.currency },
      })));
      for (const row of visibleRows) expect(mockTransactionService.getTransactionById)
        .toHaveBeenCalledWith(row.id, "house-123", "user-123");
    });
  });

  describe("PUT /api/transactions/bulk-category - Bulk Update Category", () => {
    it("should update category for multiple transactions", async () => {
      mockTransactionService.bulkUpdateCategory.mockResolvedValue({
        updated: 3,
        failed: 0,
      });

      const res = await request(app)
        .put("/api/transactions/bulk-category")
        .send({
          transactionIds: ["00000000-0000-4000-8000-000000000018", "00000000-0000-4000-8000-000000000019", "00000000-0000-4000-8000-00000000001a"],
          categoryId: "00000000-0000-4000-8000-00000000000e",
        })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  describe("PUT /api/transactions/bulk-tags - Bulk Add Tags", () => {
    it("should add tags to multiple transactions", async () => {
      mockTransactionService.bulkAddTags.mockResolvedValue({
        updated: 4,
        failed: 0,
      });

      const res = await request(app)
        .put("/api/transactions/bulk-tags")
        .send({
          transactionIds: ["00000000-0000-4000-8000-000000000018", "00000000-0000-4000-8000-000000000019", "00000000-0000-4000-8000-00000000001a", "00000000-0000-4000-8000-00000000001b"],
          tagIds: ["00000000-0000-4000-8000-000000000016", "00000000-0000-4000-8000-000000000017"],
        })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  describe("PUT /api/transactions/bulk-review - Bulk Mark Reviewed", () => {
    it("should mark multiple transactions as reviewed", async () => {
      mockTransactionService.bulkReview.mockResolvedValue({
        updated: 10,
        failed: 0,
      });

      const res = await request(app)
        .put("/api/transactions/bulk-review")
        .send({
          transactionIds: ["00000000-0000-4000-8000-000000000018", "00000000-0000-4000-8000-000000000019"],
          reviewed: true,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  describe("DELETE /api/transactions/bulk - Bulk Delete", () => {
    it("should delete multiple transactions", async () => {
      mockTransactionService.bulkDelete.mockResolvedValue({
        deleted: 3,
        failed: 0,
      });

      const res = await request(app)
        .delete("/api/transactions/bulk")
        .send({
          transactionIds: ["00000000-0000-4000-8000-000000000018", "00000000-0000-4000-8000-000000000019", "00000000-0000-4000-8000-00000000001a"],
        })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  // =========================================================================
  // AUDIT LOGGING VERIFICATION
  // =========================================================================

  describe("Audit Logging", () => {
    it("does not double-audit CREATE at the controller (audit moved to service/repo layer, P6a)", async () => {
      const mockTransaction = {
        id: "00000000-0000-4000-8000-000000000008",
        name: "Audit Test",
        amount: "100.00",
        type: "expense",
      };
      mockTransactionService.getTransactionById.mockResolvedValue(mockTransaction);
      mockTransactionService.createTransaction.mockResolvedValue({
        transaction: mockTransaction,
        isDuplicate: false,
      });

      await request(app)
        .post("/api/transactions")
        .send({
          accountId: "00000000-0000-4000-8000-000000000012",
          amount: { amount: "100.00", currency: "ZMW" },
          type: "expense",
          date: "2026-01-15",
          description: "Audit Test",
        })
        .expect(201);

      // The controller must NOT audit directly anymore — a single row is
      // written atomically at the repository layer instead (proven for real
      // Postgres by p6a-create-delete-audit.realdb.integration.test.ts,
      // including the "exactly one row over real HTTP" assertion).
      expect(mockBusinessAuditService.logCreate).not.toHaveBeenCalled();
    });

    it("does not double-audit UPDATE at the controller (audit moved to service layer, P8b)", async () => {
      const existingTransaction = { id: "00000000-0000-4000-8000-000000000018", name: "Original", amount: "100.00", categoryId: "00000000-0000-4000-8000-000000000014", date: "2026-01-15" };
      const updatedTransaction = { ...existingTransaction, name: "Updated" };
      mockTransactionService.getTransactionById.mockResolvedValue(existingTransaction);
      mockTransactionService.updateTransaction.mockResolvedValue(updatedTransaction);

      await request(app)
        .put("/api/transactions/00000000-0000-4000-8000-000000000018")
        .send({ description: "Updated" })
        .expect(200);

      // The controller must NOT audit directly anymore — a single row is
      // written atomically at the service layer instead (proven for real
      // Postgres by p8b-update-audit.realdb.integration.test.ts, including
      // the "exactly one row over real HTTP" assertion).
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });

    it("does not double-audit DELETE at the controller (audit moved to service/repo layer, P6a)", async () => {
      const existingTransaction = {
        id: "00000000-0000-4000-8000-000000000018",
        name: "Delete Me",
        amount: "100.00",
        categoryId: "00000000-0000-4000-8000-000000000014",
        date: "2026-01-15",
        accountId: "00000000-0000-4000-8000-000000000012",
      };
      mockTransactionService.getTransactionById.mockResolvedValue(existingTransaction);
      mockTransactionService.deleteTransaction.mockResolvedValue(undefined);

      await request(app)
        .delete("/api/transactions/00000000-0000-4000-8000-000000000018")
        .expect(200);

      // The controller must NOT audit directly anymore — a single row is
      // written atomically at the repository layer instead (proven for real
      // Postgres by p6a-create-delete-audit.realdb.integration.test.ts,
      // including the "exactly one row over real HTTP" assertion).
      expect(mockBusinessAuditService.logDelete).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // PRIVACY & VISIBILITY
  // =========================================================================

  describe("Privacy Tests", () => {
    it("should not return other users' private transactions", async () => {
      // Service should filter out private transactions from other users
      const visibleTransactions = [
        {
          id: "00000000-0000-4000-8000-000000000007",
          name: "Public Transaction",
          isPrivate: false,
        },
        {
          id: "00000000-0000-4000-8000-000000000001",
          name: "My Private Transaction",
          isPrivate: true,
          ownerUserId: "user-123", // Current user
        },
        // Note: Other users' private transactions should NOT be in this list
      ];

      mockTransactionService.getTransactions.mockResolvedValue(visibleTransactions);
      mockTransactionService.getTransactionsCount.mockResolvedValue(2);

      const res = await request(app)
        .get("/api/transactions")
        .expect(200);

      expect(res.body.success).toBe(true);
      // Service was called with userId for visibility filtering
      expect(mockTransactionService.getTransactions).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.any(Object)
      );
    });

    it("should respect pending transaction visibility preference", async () => {
      mockHouseholdRepository.findPreferences.mockResolvedValue({
        showPendingTransactions: false,
      });
      mockTransactionService.getTransactions.mockResolvedValue([]);
      mockTransactionService.getTransactionsCount.mockResolvedValue(0);

      await request(app)
        .get("/api/transactions")
        .expect(200);

      expect(mockTransactionService.getTransactions).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({ includePending: false })
      );
    });
  });

  // =========================================================================
  // EDGE CASES
  // =========================================================================

  describe("Edge Cases", () => {
    it("should handle very large amounts within DB limits", async () => {
      const mockTransaction = {
        id: "00000000-0000-4000-8000-000000000009",
        name: "Large Transaction",
        amount: "9999999999999.99", // Max for DECIMAL(15,2)
        currency: "ZMW",
        type: "income",
      };

      mockTransactionService.getTransactionById.mockResolvedValue(mockTransaction);
      mockTransactionService.createTransaction.mockResolvedValue({
        transaction: mockTransaction,
        isDuplicate: false,
      });

      const res = await request(app)
        .post("/api/transactions")
        .send({
          accountId: "00000000-0000-4000-8000-000000000012",
          amount: { amount: "9999999999999.99", currency: "ZMW" },
          type: "income",
          date: "2026-01-15",
          description: "Large Transaction",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
    });

    it("should handle minimum valid amount", async () => {
      const mockTransaction = {
        id: "00000000-0000-4000-8000-00000000000a",
        name: "Small Transaction",
        amount: "0.01",
        currency: "ZMW",
        type: "expense",
      };

      mockTransactionService.getTransactionById.mockResolvedValue(mockTransaction);
      mockTransactionService.createTransaction.mockResolvedValue({
        transaction: mockTransaction,
        isDuplicate: false,
      });

      const res = await request(app)
        .post("/api/transactions")
        .send({
          accountId: "00000000-0000-4000-8000-000000000012",
          amount: { amount: "0.01", currency: "ZMW" },
          type: "expense",
          date: "2026-01-15",
          description: "Small Transaction",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
    });

    it("should reject zero amount", async () => {
      const res = await request(app)
        .post("/api/transactions")
        .send({
          accountId: "00000000-0000-4000-8000-000000000012",
          amount: { amount: "0.00", currency: "ZMW" },
          type: "expense",
          date: "2026-01-15",
          description: "Zero Amount",
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should handle special characters in description", async () => {
      const mockTransaction = {
        id: "00000000-0000-4000-8000-000000000003",
        name: "Test & <script>alert('xss')</script>",
        amount: "100.00",
        currency: "ZMW",
        type: "expense",
      };

      mockTransactionService.getTransactionById.mockResolvedValue(mockTransaction);
      mockTransactionService.createTransaction.mockResolvedValue({
        transaction: mockTransaction,
        isDuplicate: false,
      });

      const res = await request(app)
        .post("/api/transactions")
        .send({
          accountId: "00000000-0000-4000-8000-000000000012",
          amount: { amount: "100.00", currency: "ZMW" },
          type: "expense",
          date: "2026-01-15",
          description: "Test & <script>alert('xss')</script>",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
    });

    it("should handle unicode characters in description", async () => {
      const mockTransaction = {
        id: "00000000-0000-4000-8000-000000000004",
        name: "购物 at Store 🛒",
        amount: "100.00",
        currency: "ZMW",
        type: "expense",
      };

      mockTransactionService.getTransactionById.mockResolvedValue(mockTransaction);
      mockTransactionService.createTransaction.mockResolvedValue({
        transaction: mockTransaction,
        isDuplicate: false,
      });

      const res = await request(app)
        .post("/api/transactions")
        .send({
          accountId: "00000000-0000-4000-8000-000000000012",
          amount: { amount: "100.00", currency: "ZMW" },
          type: "expense",
          date: "2026-01-15",
          description: "购物 at Store 🛒",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
    });

    it("should validate leap year dates correctly", async () => {
      // Valid leap year date
      const mockTransaction = {
        id: "00000000-0000-4000-8000-00000000000d",
        name: "Leap Year",
        amount: "100.00",
        date: "2024-02-29",
      };

      mockTransactionService.getTransactionById.mockResolvedValue(mockTransaction);
      mockTransactionService.createTransaction.mockResolvedValue({
        transaction: mockTransaction,
        isDuplicate: false,
      });

      const res = await request(app)
        .post("/api/transactions")
        .send({
          accountId: "00000000-0000-4000-8000-000000000012",
          amount: { amount: "100.00", currency: "ZMW" },
          type: "expense",
          date: "2024-02-29", // 2024 is a leap year
          description: "Leap Year",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
    });

    it("should reject non-leap year Feb 29", async () => {
      const res = await request(app)
        .post("/api/transactions")
        .send({
          accountId: "00000000-0000-4000-8000-000000000012",
          amount: { amount: "100.00", currency: "ZMW" },
          type: "expense",
          date: "2025-02-29", // 2025 is not a leap year
          description: "Invalid Date",
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });
});
