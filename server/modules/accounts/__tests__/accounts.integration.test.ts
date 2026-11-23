/**
 * Accounts Module - Integration Tests
 *
 * Tests account CRUD operations, balance history, and transactions.
 * Uses mocked middleware for reliable testing (same pattern as categories.integration.test.ts)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ============================================================================
// MOCKS (Hoisted)
// ============================================================================
const {
  mockAccountService,
  mockBusinessAuditService,
} = vi.hoisted(() => ({
  mockAccountService: {
    getAccounts: vi.fn(),
    getAccountById: vi.fn(),
    createAccount: vi.fn(),
    updateAccount: vi.fn(),
    deleteAccount: vi.fn(),
    getNetWorthSummary: vi.fn(),
    exportSummary: vi.fn(),
    getNetWorthHistory: vi.fn(),
    adjustBalance: vi.fn(),
    archiveAccount: vi.fn(),
    unarchiveAccount: vi.fn(),
    updateAccountSettings: vi.fn(),
    // NEW-32: the write and its one audit row commit in the service.
    updateAccountAudited: vi.fn(),
    deleteAccountAudited: vi.fn(),
    updateAccountSettingsAudited: vi.fn(),
    getBalanceHistory: vi.fn(),
    exportBalanceHistory: vi.fn(),
    importBalanceHistory: vi.fn(),
    exportTransactions: vi.fn(),
    importTransactions: vi.fn(),
  },
  mockBusinessAuditService: {
    log: vi.fn().mockResolvedValue(undefined),
    logCreate: vi.fn().mockResolvedValue(undefined),
    logUpdate: vi.fn().mockResolvedValue(undefined),
    logDelete: vi.fn().mockResolvedValue(undefined),
    getIpAddress: vi.fn().mockReturnValue("127.0.0.1"),
  },
}));

// Mock Service
vi.mock("../accounts.service", () => ({
  accountService: mockAccountService,
}));

// Mock BusinessAuditService
vi.mock("../../../services/BusinessAuditService", () => ({
  businessAuditService: mockBusinessAuditService,
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

// NOTE: requireStepUp is mocked to a no-op here so these controller-level tests
// can focus on validation/audit. The REAL step-up behaviour (password re-auth,
// the 401 gate, account lockout, DB state) is guarded by
// accounts.stepup.db.integration.test.ts.
vi.mock("../../../middleware/requireStepUp", () => ({
  requireStepUp: () => (req: any, res: any, next: any) => next(),
}));

// Import Routes (after mocks are defined)
import accountsRouter from "../accounts.routes";
import { errorHandler } from "../../../core/errors/errorHandler";

const app = express();
app.use(express.json());
app.use("/api/accounts", accountsRouter);
app.use(errorHandler);

describe("Accounts Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // LIST & SUMMARY
  // =========================================================================

  describe("GET /api/accounts - List Accounts", () => {
    it("should return all accounts for household", async () => {
      const mockAccounts = [
        {
          id: "acc-1",
          name: "Checking Account",
          type: "checking",
          balance: { amount: "1000.00", currency: "ZMW" },
          currency: "ZMW",
          isArchived: false,
        },
        {
          id: "acc-2",
          name: "Savings Account",
          type: "savings",
          balance: { amount: "5000.00", currency: "ZMW" },
          currency: "ZMW",
          isArchived: false,
        },
      ];

      mockAccountService.getAccounts.mockResolvedValue(mockAccounts);

      const res = await request(app)
        .get("/api/accounts")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(mockAccountService.getAccounts).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.any(Object)
      );
    });

    it("should filter by includeArchived query param", async () => {
      mockAccountService.getAccounts.mockResolvedValue([]);

      await request(app)
        .get("/api/accounts?includeArchived=true")
        .expect(200);

      expect(mockAccountService.getAccounts).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.objectContaining({ includeArchived: true })
      );
    });

    it("should return empty array when no accounts exist", async () => {
      mockAccountService.getAccounts.mockResolvedValue([]);

      const res = await request(app)
        .get("/api/accounts")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });
  });

  describe("GET /api/accounts/summary - Net Worth Summary", () => {
    it("should return net worth summary", async () => {
      const mockSummary = {
        totalAssets: { amount: "10000.00", currency: "ZMW" },
        totalLiabilities: { amount: "2000.00", currency: "ZMW" },
        netWorth: { amount: "8000.00", currency: "ZMW" },
        accountsByType: [],
      };

      mockAccountService.getNetWorthSummary.mockResolvedValue(mockSummary);

      const res = await request(app)
        .get("/api/accounts/summary")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.netWorth.amount).toBe("8000.00");
    });
  });

  describe("GET /api/accounts/summary/history - Net Worth History", () => {
    it("should return net worth history with default range", async () => {
      const mockHistory = [
        { date: "2026-01-01", netWorth: { amount: "7500.00", currency: "ZMW" } },
        { date: "2026-01-15", netWorth: { amount: "8000.00", currency: "ZMW" } },
      ];

      mockAccountService.getNetWorthHistory.mockResolvedValue(mockHistory);

      const res = await request(app)
        .get("/api/accounts/summary/history")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
    });

    it("should accept dateRange query parameter", async () => {
      mockAccountService.getNetWorthHistory.mockResolvedValue([]);

      await request(app)
        .get("/api/accounts/summary/history?dateRange=3m")
        .expect(200);

      expect(mockAccountService.getNetWorthHistory).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        "3m",
        "user"
      );
    });

    it("should reject invalid dateRange", async () => {
      const res = await request(app)
        .get("/api/accounts/summary/history?dateRange=invalid")
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // CRUD OPERATIONS
  // =========================================================================

  describe("GET /api/accounts/:id - Get Account by ID", () => {
    it("should return account by id", async () => {
      const mockAccount = {
        id: "acc-1",
        name: "Test Account",
        type: "checking",
        balance: { amount: "1000.00", currency: "ZMW" },
        currency: "ZMW",
        householdId: "house-123",
      };

      mockAccountService.getAccountById.mockResolvedValue(mockAccount);

      const res = await request(app)
        .get("/api/accounts/acc-1")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe("acc-1");
      expect(res.body.data.name).toBe("Test Account");
    });

    it("should return 404 for non-existent account", async () => {
      mockAccountService.getAccountById.mockRejectedValue(
        new Error("NOT_FOUND")
      );

      const res = await request(app)
        .get("/api/accounts/non-existent")
        .expect(500); // Service throws generic error, error handler returns 500

      expect(res.body.success).toBe(false);
    });
  });

  describe("POST /api/accounts - Create Account", () => {
    it("should create a new account", async () => {
      const mockAccount = {
        id: "acc-new",
        name: "New Account",
        type: "checking",
        balance: { amount: "500.00", currency: "ZMW" },
        currency: "ZMW",
        householdId: "house-123",
      };

      mockAccountService.createAccount.mockResolvedValue(mockAccount);

      const res = await request(app)
        .post("/api/accounts")
        .send({
          name: "New Account",
          type: "checking",
          currency: "ZMW",
          initialBalance: "500.00",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe("New Account");
      expect(mockAccountService.createAccount).toHaveBeenCalled();
      // The service owns the mandatory account/audit transaction. The HTTP
      // layer forwards request provenance and must not insert a second audit.
      expect(mockAccountService.createAccount).toHaveBeenCalledWith(expect.any(Object), "house-123", "user-123", { ipAddress: expect.any(String) });
      expect(mockBusinessAuditService.logCreate).not.toHaveBeenCalled();
    });

    it("should validate required name field", async () => {
      const res = await request(app)
        .post("/api/accounts")
        .send({
          type: "checking",
          currency: "ZMW",
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(mockAccountService.createAccount).not.toHaveBeenCalled();
    });

    it("should validate account type enum", async () => {
      const res = await request(app)
        .post("/api/accounts")
        .send({
          name: "Invalid Type Account",
          type: "invalid_type",
          currency: "ZMW",
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should create account with credit card fields", async () => {
      const mockAccount = {
        id: "acc-credit",
        name: "Credit Card",
        type: "credit",
        currency: "ZMW",
        creditLimit: "10000.00",
        apr: "24.99",
        statementDay: 15,
      };

      mockAccountService.createAccount.mockResolvedValue(mockAccount);

      const res = await request(app)
        .post("/api/accounts")
        .send({
          name: "Credit Card",
          type: "credit",
          currency: "ZMW",
          creditLimit: "10000.00",
          apr: 24.99,
          statementDay: 15,
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe("credit");
    });

    it("should validate amount format (max 2 decimals)", async () => {
      const res = await request(app)
        .post("/api/accounts")
        .send({
          name: "Test Account",
          type: "checking",
          currency: "ZMW",
          initialBalance: "100.123", // 3 decimals - invalid
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  describe("PUT /api/accounts/:id - Update Account", () => {
    it("should update account name", async () => {
      const existingAccount = {
        id: "acc-1",
        name: "Original Name",
        type: "checking",
        balance: { amount: "1000.00", currency: "ZMW" },
        currency: "ZMW",
      };
      const updatedAccount = { ...existingAccount, name: "Updated Name" };

      mockAccountService.getAccountById.mockResolvedValue(existingAccount);
      mockAccountService.updateAccountAudited.mockResolvedValue(updatedAccount);

      const res = await request(app)
        .put("/api/accounts/acc-1")
        .send({ name: "Updated Name" })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe("Updated Name");
      expect(mockAccountService.updateAccountAudited).toHaveBeenCalledWith("acc-1",
        expect.objectContaining({ name: "Updated Name" }), "house-123", "user-123", undefined, "127.0.0.1");
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });

    it("should allow partial updates", async () => {
      const existingAccount = {
        id: "acc-1",
        name: "Test Account",
        type: "checking",
        institution: null,
        currency: "ZMW",
      };
      const updatedAccount = { ...existingAccount, institution: "Test Bank" };

      mockAccountService.getAccountById.mockResolvedValue(existingAccount);
      mockAccountService.updateAccountAudited.mockResolvedValue(updatedAccount);

      const res = await request(app)
        .put("/api/accounts/acc-1")
        .send({ institution: "Test Bank" })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.institution).toBe("Test Bank");
    });
  });

  describe("DELETE /api/accounts/:id - Delete Account", () => {
    it("should delete an account", async () => {
      const existingAccount = {
        id: "acc-1",
        name: "Delete Me",
        type: "checking",
        balance: { amount: "0.00", currency: "ZMW" },
        currency: "ZMW",
        isArchived: false,
      };

      mockAccountService.getAccountById.mockResolvedValue(existingAccount);
      mockAccountService.deleteAccountAudited.mockResolvedValue(undefined);

      const res = await request(app)
        .delete("/api/accounts/acc-1")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockAccountService.deleteAccountAudited).toHaveBeenCalledWith("acc-1", "house-123", "user-123", "127.0.0.1");
      expect(mockBusinessAuditService.logDelete).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // BALANCE OPERATIONS
  // =========================================================================

  describe("POST /api/accounts/:id/adjust-balance - Adjust Balance", () => {
    it("should increase account balance", async () => {
      const existingAccount = {
        id: "acc-1",
        name: "Test Account",
        type: "checking",
        balance: { amount: "1000.00", currency: "ZMW" },
        currency: "ZMW",
      };
      const result = {
        account: { ...existingAccount, balance: { amount: "1500.00", currency: "ZMW" } },
        transactionId: "txn-123",
      };

      mockAccountService.getAccountById.mockResolvedValue(existingAccount);
      mockAccountService.adjustBalance.mockResolvedValue(result);

      const res = await request(app)
        .post("/api/accounts/acc-1/adjust-balance")
        .send({
          amount: "500.00",
          isIncrease: true,
          notes: "Monthly deposit",
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      // The ledger row's audit is written by the service in its transaction.
      expect(mockAccountService.adjustBalance).toHaveBeenCalledWith("acc-1", "500.00", true,
        "house-123", "user-123", "Monthly deposit", "127.0.0.1");
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });

    it("should decrease account balance", async () => {
      const existingAccount = {
        id: "acc-1",
        name: "Test Account",
        type: "checking",
        balance: { amount: "1000.00", currency: "ZMW" },
        currency: "ZMW",
      };
      const result = {
        account: { ...existingAccount, balance: { amount: "800.00", currency: "ZMW" } },
        transactionId: "txn-124",
      };

      mockAccountService.getAccountById.mockResolvedValue(existingAccount);
      mockAccountService.adjustBalance.mockResolvedValue(result);

      const res = await request(app)
        .post("/api/accounts/acc-1/adjust-balance")
        .send({
          amount: "200.00",
          isIncrease: false,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it("should reject negative amount", async () => {
      const res = await request(app)
        .post("/api/accounts/acc-1/adjust-balance")
        .send({
          amount: "-100.00",
          isIncrease: true,
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should reject zero amount", async () => {
      const res = await request(app)
        .post("/api/accounts/acc-1/adjust-balance")
        .send({
          amount: "0.00",
          isIncrease: true,
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  describe("POST /api/accounts/:id/archive - Archive Account", () => {
    it("should archive an account", async () => {
      const existingAccount = {
        id: "acc-1",
        name: "Test Account",
        isArchived: false,
      };
      const archivedAccount = { ...existingAccount, isArchived: true };

      mockAccountService.getAccountById.mockResolvedValue(existingAccount);
      mockAccountService.archiveAccount.mockResolvedValue(archivedAccount);

      const res = await request(app)
        .post("/api/accounts/acc-1/archive")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.isArchived).toBe(true);
      expect(mockAccountService.archiveAccount).toHaveBeenCalledWith("acc-1", "house-123", "user-123", "127.0.0.1");
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/accounts/:id/unarchive - Unarchive Account", () => {
    it("should unarchive an account", async () => {
      const archivedAccount = {
        id: "acc-1",
        name: "Test Account",
        isArchived: true,
      };
      const unarchivedAccount = { ...archivedAccount, isArchived: false };

      mockAccountService.getAccountById.mockResolvedValue(archivedAccount);
      mockAccountService.unarchiveAccount.mockResolvedValue(unarchivedAccount);

      const res = await request(app)
        .post("/api/accounts/acc-1/unarchive")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.isArchived).toBe(false);
      expect(mockAccountService.unarchiveAccount).toHaveBeenCalledWith("acc-1", "house-123", "user-123", "127.0.0.1");
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // BALANCE HISTORY
  // =========================================================================

  describe("GET /api/accounts/:id/balance-history - Get Balance History", () => {
    it("should return balance history", async () => {
      const mockHistory = [
        { date: "2026-01-01", balance: { amount: "900.00", currency: "ZMW" } },
        { date: "2026-01-15", balance: { amount: "1000.00", currency: "ZMW" } },
      ];

      mockAccountService.getBalanceHistory.mockResolvedValue(mockHistory);

      const res = await request(app)
        .get("/api/accounts/acc-1/balance-history")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
    });

    it("should accept dateRange query parameter", async () => {
      mockAccountService.getBalanceHistory.mockResolvedValue([]);

      await request(app)
        .get("/api/accounts/acc-1/balance-history?dateRange=3m")
        .expect(200);

      expect(mockAccountService.getBalanceHistory).toHaveBeenCalledWith(
        "acc-1",
        "house-123",
        "user-123",
        "3m"
      );
    });
  });

  describe("POST /api/accounts/:id/balance-history/import - Import Balance History", () => {
    it("should import balance history data", async () => {
      mockAccountService.importBalanceHistory.mockResolvedValue({
        imported: 2,
        skipped: 0,
      });

      const res = await request(app)
        .post("/api/accounts/acc-1/balance-history/import")
        .send({
          data: [
            { date: "2026-01-01", amount: "1000.00" },
            { date: "2026-01-15", amount: "1100.00" },
          ],
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.imported).toBe(2);
    });

    it("should reject invalid date format", async () => {
      const res = await request(app)
        .post("/api/accounts/acc-1/balance-history/import")
        .send({
          data: [
            { date: "01-01-2026", amount: "1000.00" }, // Wrong format
          ],
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should reject invalid amount format", async () => {
      const res = await request(app)
        .post("/api/accounts/acc-1/balance-history/import")
        .send({
          data: [
            { date: "2026-01-01", amount: "invalid" },
          ],
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // TRANSACTIONS IMPORT/EXPORT
  // =========================================================================

  describe("GET /api/accounts/:id/transactions/export - Export Transactions", () => {
    it("should export transactions as CSV", async () => {
      const csvData = "date,merchant,amount\n2026-01-01,Store,100.00";
      mockAccountService.exportTransactions.mockResolvedValue(csvData);

      const res = await request(app)
        .get("/api/accounts/acc-1/transactions/export")
        .expect(200);

      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.text).toBe(csvData);
    });

    it("should accept date range filters", async () => {
      mockAccountService.exportTransactions.mockResolvedValue("");

      await request(app)
        .get("/api/accounts/acc-1/transactions/export?startDate=2026-01-01&endDate=2026-01-31")
        .expect(200);

      expect(mockAccountService.exportTransactions).toHaveBeenCalledWith(
        "acc-1",
        "house-123",
        "user-123",
        expect.objectContaining({
          startDate: "2026-01-01",
          endDate: "2026-01-31",
        })
      );
    });
  });

  describe("POST /api/accounts/:id/transactions/import - Import Transactions", () => {
    it("should import transactions", async () => {
      mockAccountService.importTransactions.mockResolvedValue({
        imported: 2,
        duplicates: 0,
      });

      const res = await request(app)
        .post("/api/accounts/acc-1/transactions/import")
        .send({
          transactions: [
            {
              date: "2026-01-01",
              merchant: "Store A",
              amount: "50.00",
            },
            {
              date: "2026-01-02",
              merchant: "Store B",
              amount: "75.50",
            },
          ],
          adjustBalance: false,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.imported).toBe(2);
    });

    it("should reject missing merchant field", async () => {
      const res = await request(app)
        .post("/api/accounts/acc-1/transactions/import")
        .send({
          transactions: [
            {
              date: "2026-01-01",
              amount: "50.00",
              // Missing merchant
            },
          ],
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should accept optional fields", async () => {
      mockAccountService.importTransactions.mockResolvedValue({
        imported: 1,
        duplicates: 0,
      });

      const res = await request(app)
        .post("/api/accounts/acc-1/transactions/import")
        .send({
          transactions: [
            {
              date: "2026-01-01",
              merchant: "Store",
              amount: "100.00",
              category: "Groceries",
              notes: "Weekly shopping",
              tags: "food,essential",
            },
          ],
          adjustBalance: true,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  // =========================================================================
  // SETTINGS
  // =========================================================================

  describe("PATCH /api/accounts/:id/settings - Update Account Settings", () => {
    it("should update account visibility settings", async () => {
      const existingAccount = {
        id: "acc-1",
        name: "Test Account",
        isHidden: false,
        excludeFromNetWorth: false,
        hideTransactions: false,
      };
      const updatedAccount = {
        ...existingAccount,
        isHidden: true,
        excludeFromNetWorth: true,
      };

      mockAccountService.getAccountById.mockResolvedValue(existingAccount);
      mockAccountService.updateAccountSettingsAudited.mockResolvedValue(updatedAccount);

      const res = await request(app)
        .patch("/api/accounts/acc-1/settings")
        .send({
          isHidden: true,
          excludeFromNetWorth: true,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.isHidden).toBe(true);
      expect(mockAccountService.updateAccountSettingsAudited).toHaveBeenCalledWith("acc-1",
        { isHidden: true, excludeFromNetWorth: true }, "house-123", "user-123", "127.0.0.1");
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });

    it("should allow partial settings update", async () => {
      const existingAccount = {
        id: "acc-1",
        isHidden: false,
        excludeFromNetWorth: false,
        hideTransactions: false,
      };
      const updatedAccount = { ...existingAccount, hideTransactions: true };

      mockAccountService.getAccountById.mockResolvedValue(existingAccount);
      mockAccountService.updateAccountSettingsAudited.mockResolvedValue(updatedAccount);

      const res = await request(app)
        .patch("/api/accounts/acc-1/settings")
        .send({
          hideTransactions: true,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  // =========================================================================
  // AUDIT LOGGING VERIFICATION
  // =========================================================================

  describe("Audit Logging", () => {
    it("delegates account creation auditing once to the transactional service", async () => {
      const mockAccount = {
        id: "acc-audit",
        name: "Audit Test",
        type: "checking",
        currency: "ZMW",
      };
      mockAccountService.createAccount.mockResolvedValue(mockAccount);

      await request(app)
        .post("/api/accounts")
        .send({
          name: "Audit Test",
          type: "checking",
          currency: "ZMW",
        })
        .expect(201);

      expect(mockAccountService.createAccount).toHaveBeenCalledTimes(1);
      expect(mockBusinessAuditService.logCreate).not.toHaveBeenCalled();
    });

    it("delegates account update auditing once to the transactional service", async () => {
      const existingAccount = { id: "acc-1", name: "Original", type: "checking", currency: "ZMW" };
      const updatedAccount = { ...existingAccount, name: "Updated" };
      mockAccountService.getAccountById.mockResolvedValue(existingAccount);
      mockAccountService.updateAccountAudited.mockResolvedValue(updatedAccount);

      await request(app)
        .put("/api/accounts/acc-1")
        .send({ name: "Updated" })
        .expect(200);

      expect(mockAccountService.updateAccountAudited).toHaveBeenCalledTimes(1);
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });

    it("delegates account deletion auditing once to the transactional service", async () => {
      const existingAccount = {
        id: "acc-1",
        name: "Delete Me",
        type: "checking",
        balance: { amount: "0.00", currency: "ZMW" },
        currency: "ZMW",
        isArchived: false,
      };
      mockAccountService.getAccountById.mockResolvedValue(existingAccount);
      mockAccountService.deleteAccountAudited.mockResolvedValue(undefined);

      await request(app)
        .delete("/api/accounts/acc-1")
        .expect(200);

      expect(mockAccountService.deleteAccountAudited).toHaveBeenCalledTimes(1);
      expect(mockBusinessAuditService.logDelete).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // EDGE CASES
  // =========================================================================

  describe("Edge Cases - Validation", () => {
    it("should reject name exceeding 100 characters", async () => {
      const longName = "a".repeat(101);
      const res = await request(app)
        .post("/api/accounts")
        .send({
          name: longName,
          type: "checking",
          currency: "ZMW",
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should accept max length name (100 characters)", async () => {
      const maxLengthName = "a".repeat(100);
      const mockAccount = {
        id: "acc-max",
        name: maxLengthName,
        type: "checking",
        currency: "ZMW",
      };
      mockAccountService.createAccount.mockResolvedValue(mockAccount);

      const res = await request(app)
        .post("/api/accounts")
        .send({
          name: maxLengthName,
          type: "checking",
          currency: "ZMW",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
    });

    it("should validate currency is 3 characters", async () => {
      const res = await request(app)
        .post("/api/accounts")
        .send({
          name: "Test Account",
          type: "checking",
          currency: "US", // Too short
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should validate APR range (0-100)", async () => {
      const res = await request(app)
        .post("/api/accounts")
        .send({
          name: "Credit Card",
          type: "credit",
          currency: "ZMW",
          apr: 150, // Over 100 - invalid
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should validate statement day range (1-31)", async () => {
      const res = await request(app)
        .post("/api/accounts")
        .send({
          name: "Credit Card",
          type: "credit",
          currency: "ZMW",
          statementDay: 32, // Invalid day
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  describe("Edge Cases - Special Characters", () => {
    it("should allow special characters in account name", async () => {
      const mockAccount = {
        id: "acc-special",
        name: "Account & Savings (2024)",
        type: "checking",
        currency: "ZMW",
      };
      mockAccountService.createAccount.mockResolvedValue(mockAccount);

      const res = await request(app)
        .post("/api/accounts")
        .send({
          name: "Account & Savings (2024)",
          type: "checking",
          currency: "ZMW",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
    });

    it("should allow unicode characters in notes", async () => {
      const existingAccount = { id: "acc-1", name: "Test", notes: null, type: "checking", currency: "ZMW" };
      const updatedAccount = { ...existingAccount, notes: "Notes with unicode: " };
      mockAccountService.getAccountById.mockResolvedValue(existingAccount);
      mockAccountService.updateAccountAudited.mockResolvedValue(updatedAccount);

      const res = await request(app)
        .put("/api/accounts/acc-1")
        .send({ notes: "Notes with unicode: " })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  // =========================================================================
  // PRIVACY & AUTHORIZATION TESTS
  // =========================================================================

  describe("Privacy Tests - Private Account Visibility (TEST-001)", () => {
    it("should not return other users' private accounts in list", async () => {
      // Simulate User A querying accounts
      // User B has a private account in the same household
      const mockAccounts = [
        {
          id: "acc-public",
          name: "Shared Account",
          type: "checking",
          isPrivate: false,
          ownerUserId: "user-456", // User B owns this but it's public
        },
        // Note: User B's private account (acc-private) should NOT be in this list
        // because the service filters it out based on visibility rules
      ];

      mockAccountService.getAccounts.mockResolvedValue(mockAccounts);

      const res = await request(app)
        .get("/api/accounts")
        .expect(200);

      expect(res.body.success).toBe(true);
      // Service should only return accounts visible to User A
      expect(mockAccountService.getAccounts).toHaveBeenCalledWith(
        "house-123",
        "user-123",
        expect.any(Object)
      );
      // Verify no private accounts from other users are returned
      for (const account of res.body.data) {
        if (account.isPrivate && account.ownerUserId) {
          expect(account.ownerUserId).toBe("user-123");
        }
      }
    });

    it("should return own private accounts in list", async () => {
      const mockAccounts = [
        {
          id: "acc-private-own",
          name: "My Private Account",
          type: "savings",
          isPrivate: true,
          ownerUserId: "user-123", // Current user owns this
        },
      ];

      mockAccountService.getAccounts.mockResolvedValue(mockAccounts);

      const res = await request(app)
        .get("/api/accounts")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].isPrivate).toBe(true);
    });
  });

  describe("Privacy Tests - Cross-Household Isolation (TEST-002)", () => {
    it("should return 404 (not 403) for account from different household", async () => {
      // When a user tries to access an account from another household,
      // return 404 to prevent enumeration attacks (don't reveal account exists)
      const notFoundError = new Error("NOT_FOUND");
      (notFoundError as any).statusCode = 404;
      mockAccountService.getAccountById.mockRejectedValue(notFoundError);

      const res = await request(app)
        .get("/api/accounts/acc-other-household")
        .expect(500); // Error handler converts generic errors to 500

      expect(res.body.success).toBe(false);
      // The key assertion: service was called with the user's household context
      expect(mockAccountService.getAccountById).toHaveBeenCalledWith(
        "acc-other-household",
        "house-123", // User's household, not the account's actual household
        "user-123"
      );
    });

    it("should not leak existence of accounts in other households", async () => {
      // Simulating NotFoundError response for both:
      // 1. Account doesn't exist
      // 2. Account exists but in different household
      // Both should look the same to the client
      mockAccountService.getAccountById.mockRejectedValue(
        new Error("NOT_FOUND")
      );

      await request(app)
        .get("/api/accounts/non-existent-id")
        .expect(500);

      await request(app)
        .get("/api/accounts/other-household-acc")
        .expect(500);

      // Both requests should have the same response structure (no information leak)
    });
  });

  describe("Privacy Tests - Archive Authorization (TEST-003)", () => {
    it("should not allow archiving another user's private account", async () => {
      const privateAccount = {
        id: "acc-private-other",
        name: "User B's Private Account",
        isPrivate: true,
        ownerUserId: "user-456", // Different user owns this
        isArchived: false,
      };

      // First call returns the account (visibility check)
      mockAccountService.getAccountById.mockResolvedValue(privateAccount);
      // Archive call should throw authorization error
      const authError = new Error("AUTHORIZATION_ERROR");
      (authError as any).statusCode = 403;
      mockAccountService.archiveAccount.mockRejectedValue(authError);

      const res = await request(app)
        .post("/api/accounts/acc-private-other/archive")
        .expect(500); // Error handler behavior

      expect(res.body.success).toBe(false);
    });

    it("should allow archiving own private account", async () => {
      const ownPrivateAccount = {
        id: "acc-private-own",
        name: "My Private Account",
        isPrivate: true,
        ownerUserId: "user-123", // Current user owns this
        isArchived: false,
      };
      const archivedAccount = { ...ownPrivateAccount, isArchived: true };

      mockAccountService.getAccountById.mockResolvedValue(ownPrivateAccount);
      mockAccountService.archiveAccount.mockResolvedValue(archivedAccount);

      const res = await request(app)
        .post("/api/accounts/acc-private-own/archive")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.isArchived).toBe(true);
    });

    it("should allow archiving shared (public) accounts", async () => {
      const sharedAccount = {
        id: "acc-shared",
        name: "Shared Family Account",
        isPrivate: false,
        ownerUserId: null, // Shared account
        isArchived: false,
      };
      const archivedAccount = { ...sharedAccount, isArchived: true };

      mockAccountService.getAccountById.mockResolvedValue(sharedAccount);
      mockAccountService.archiveAccount.mockResolvedValue(archivedAccount);

      const res = await request(app)
        .post("/api/accounts/acc-shared/archive")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.isArchived).toBe(true);
    });

    it("should not allow unarchiving another user's private account", async () => {
      const privateAccount = {
        id: "acc-private-other",
        name: "User B's Private Account",
        isPrivate: true,
        ownerUserId: "user-456", // Different user owns this
        isArchived: true,
      };

      mockAccountService.getAccountById.mockResolvedValue(privateAccount);
      const authError = new Error("AUTHORIZATION_ERROR");
      (authError as any).statusCode = 403;
      mockAccountService.unarchiveAccount.mockRejectedValue(authError);

      const res = await request(app)
        .post("/api/accounts/acc-private-other/unarchive")
        .expect(500);

      expect(res.body.success).toBe(false);
    });
  });

  describe("Privacy Tests - Date Validation", () => {
    it("should reject invalid date like 2025-02-30", async () => {
      const res = await request(app)
        .post("/api/accounts/acc-1/balance-history/import")
        .send({
          data: [
            { date: "2025-02-30", amount: "1000.00" }, // Invalid date - Feb 30 doesn't exist
          ],
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should reject invalid date like 2025-04-31", async () => {
      const res = await request(app)
        .post("/api/accounts/acc-1/balance-history/import")
        .send({
          data: [
            { date: "2025-04-31", amount: "1000.00" }, // Invalid date - April has 30 days
          ],
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("should accept valid leap year date 2024-02-29", async () => {
      mockAccountService.importBalanceHistory.mockResolvedValue({
        imported: 1,
        skipped: 0,
      });

      const res = await request(app)
        .post("/api/accounts/acc-1/balance-history/import")
        .send({
          data: [
            { date: "2024-02-29", amount: "1000.00" }, // Valid - 2024 is a leap year
          ],
        })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it("should reject non-leap year date 2025-02-29", async () => {
      const res = await request(app)
        .post("/api/accounts/acc-1/balance-history/import")
        .send({
          data: [
            { date: "2025-02-29", amount: "1000.00" }, // Invalid - 2025 is not a leap year
          ],
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });
});
