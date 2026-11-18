import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Account Service Tests
 *
 * Tests for AccountService business logic including:
 * - Privacy enforcement
 * - Balance adjustment via transactions
 * - Validation rules
 */

// Mock repositories
vi.mock("../../repositories/AccountRepository", () => ({
  accountRepository: {
    findByHouseholdWithVisibility: vi.fn(),
    findByIdWithVisibility: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    archive: vi.fn(),
    unarchive: vi.fn(),
    getNextDisplayOrder: vi.fn().mockResolvedValue(0),
    getBalancesForNetWorth: vi.fn(),
  },
}));

// Mock HouseholdRepository for getNetWorthSummary multi-currency support
vi.mock("../../repositories/HouseholdRepository", () => ({
  householdRepository: {
    findById: vi
      .fn()
      .mockResolvedValue({ id: "test-household-123", currency: "ZMW" }),
  },
}));

// Mock TransactionRepository — adjustBalance routes through the locked
// transaction-create path (account FOR UPDATE + overdraft guard).
vi.mock("../../repositories/TransactionRepository", () => ({
  transactionRepository: {
    create: vi.fn().mockResolvedValue({
      transaction: { id: "adjustment-txn-1" },
      account: { id: "acc-1", balance: "150.00" },
    }),
  },
}));

// Mock FX rates for multi-currency support
vi.mock("../../core/calculations", () => ({
  getLatestFxRates: vi.fn().mockResolvedValue(new Map()),
}));

// Mock withTransaction
vi.mock("../../utils/withTransaction", () => ({
  withTransaction: vi.fn(async (callback: any) => {
    const mockTx = {
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi
        .fn()
        .mockResolvedValue([{ id: "test-id", balance: "100.00" }]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
    };
    return callback(mockTx);
  }),
}));

// Mock logger
vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock audit service for account archive/create/update unit tests
vi.mock("../BusinessAuditService", () => ({
  businessAuditService: {
    logCreate: vi.fn().mockResolvedValue(undefined),
    logUpdate: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("AccountService", () => {
  const testHouseholdId = "test-household-123";
  const testUserId = "test-user-456";

  beforeEach(() => {
    vi.clearAllMocks();
    // Don't reset modules - it breaks the mock setup
  });

  describe("getAccounts", () => {
    it("calls repository with correct parameters", async () => {
      const { accountService } = await import("../AccountService");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      const mockAccounts = [
        { id: "acc-1", name: "Account 1", type: "checking" },
        { id: "acc-2", name: "Account 2", type: "savings" },
      ];
      vi.spyOn(
        accountRepository,
        "findByHouseholdWithVisibility",
      ).mockResolvedValue(mockAccounts as any);

      const result = await accountService.getAccounts(
        testHouseholdId,
        testUserId,
      );

      expect(
        accountRepository.findByHouseholdWithVisibility,
      ).toHaveBeenCalledWith(testHouseholdId, testUserId, undefined);
      expect(result).toEqual(mockAccounts);
    });

    it("passes options to repository", async () => {
      const { accountService } = await import("../AccountService");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      vi.spyOn(
        accountRepository,
        "findByHouseholdWithVisibility",
      ).mockResolvedValue([] as any);

      await accountService.getAccounts(testHouseholdId, testUserId, {
        includeArchived: true,
        includeHidden: true,
      });

      expect(
        accountRepository.findByHouseholdWithVisibility,
      ).toHaveBeenCalledWith(testHouseholdId, testUserId, {
        includeArchived: true,
        includeHidden: true,
      });
    });
  });

  describe("getAccountById", () => {
    it("throws NotFoundError when account does not exist", async () => {
      const { accountService } = await import("../AccountService");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      (accountRepository.findByIdWithVisibility as any).mockResolvedValue(
        undefined,
      );

      await expect(
        accountService.getAccountById(
          "nonexistent-id",
          testHouseholdId,
          testUserId,
        ),
      ).rejects.toThrow("Account not found");
    });

    it("returns account when it exists", async () => {
      const { accountService } = await import("../AccountService");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      const mockAccount = { id: "acc-1", name: "Account 1", type: "checking" };
      (accountRepository.findByIdWithVisibility as any).mockResolvedValue(
        mockAccount,
      );

      const result = await accountService.getAccountById(
        "acc-1",
        testHouseholdId,
        testUserId,
      );

      expect(result).toEqual(mockAccount);
    });
  });

  describe("createAccount", () => {
    it("sets isAsset=true for asset account types", async () => {
      const { accountService } = await import("../AccountService");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      const newAccount = {
        id: "new-acc",
        name: "Checking Account",
        type: "checking",
        isAsset: true,
      };
      (accountRepository.create as any).mockResolvedValue(newAccount);

      const result = await accountService.createAccount(
        { name: "Checking Account", type: "checking" as any },
        testHouseholdId,
        testUserId,
      );

      expect(accountRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          isAsset: true,
          type: "checking",
        }),
      );
      expect(result.type).toBe("checking");
    });

    it("sets isAsset=false for liability account types", async () => {
      const { accountService } = await import("../AccountService");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      const newAccount = {
        id: "new-acc",
        name: "Credit Card",
        type: "credit",
        isAsset: false,
      };
      (accountRepository.create as any).mockResolvedValue(newAccount);

      await accountService.createAccount(
        { name: "Credit Card", type: "credit" as any },
        testHouseholdId,
        testUserId,
      );

      expect(accountRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          isAsset: false,
          type: "credit",
        }),
      );
    });

    it("throws ValidationError for invalid account type", async () => {
      const { accountService } = await import("../AccountService");

      await expect(
        accountService.createAccount(
          { name: "Invalid", type: "invalid_type" as any },
          testHouseholdId,
          testUserId,
        ),
      ).rejects.toThrow("Invalid account type");
    });
  });

  describe("updateAccount", () => {
    it("throws AuthorizationError when modifying private account owned by another user", async () => {
      const { accountService } = await import("../AccountService");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      const privateAccount = {
        id: "acc-1",
        name: "Private Account",
        isPrivate: true,
        ownerUserId: "other-user", // Different from testUserId
      };
      (accountRepository.findByIdWithVisibility as any).mockResolvedValue(
        privateAccount,
      );

      await expect(
        accountService.updateAccount(
          "acc-1",
          { name: "New Name" },
          testHouseholdId,
          testUserId,
        ),
      ).rejects.toThrow("Cannot modify private account owned by another user");
    });

    it("throws ValidationError when trying to directly modify balance", async () => {
      const { accountService } = await import("../AccountService");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      const account = {
        id: "acc-1",
        name: "Account",
        isPrivate: false,
        ownerUserId: testUserId,
      };
      (accountRepository.findByIdWithVisibility as any).mockResolvedValue(
        account,
      );

      await expect(
        accountService.updateAccount(
          "acc-1",
          { balance: "1000.00" } as any,
          testHouseholdId,
          testUserId,
        ),
      ).rejects.toThrow("Cannot directly modify balance");
    });

    it("throws ConflictError when optimistic concurrency fails", async () => {
      const { accountService } = await import("../AccountService");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      const account = {
        id: "acc-1",
        name: "Account",
        isPrivate: false,
        ownerUserId: testUserId,
      };
      (accountRepository.findByIdWithVisibility as any).mockResolvedValue(
        account,
      );
      (accountRepository.update as any).mockResolvedValue({
        account: undefined,
        conflict: true,
      });

      await expect(
        accountService.updateAccount(
          "acc-1",
          { name: "New Name" },
          testHouseholdId,
          testUserId,
          new Date("2024-01-01"),
        ),
      ).rejects.toThrow("Account was modified by another user");
    });
  });

  describe("getNetWorthSummary", () => {
    it("correctly calculates net worth from assets and liabilities", async () => {
      const { accountService } = await import("../AccountService");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      const balances = [
        {
          id: "1",
          balance: "10000.00",
          isAsset: true,
          type: "checking",
          currency: "ZMW",
        }, // Asset
        {
          id: "2",
          balance: "5000.00",
          isAsset: true,
          type: "savings",
          currency: "ZMW",
        }, // Asset
        {
          id: "3",
          balance: "2000.00",
          isAsset: false,
          type: "credit",
          currency: "ZMW",
        }, // Liability
      ];
      (accountRepository.getBalancesForNetWorth as any).mockResolvedValue(
        balances,
      );

      const result = await accountService.getNetWorthSummary(
        testHouseholdId,
        testUserId,
      );

      expect(result.totalAssets).toBe(15000);
      expect(result.totalLiabilities).toBe(2000);
      expect(result.netWorth).toBe(13000);
      expect(result.currency).toBe("ZMW");
    });

    it("handles empty accounts list", async () => {
      const { accountService } = await import("../AccountService");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      (accountRepository.getBalancesForNetWorth as any).mockResolvedValue([]);

      const result = await accountService.getNetWorthSummary(
        testHouseholdId,
        testUserId,
      );

      expect(result.totalAssets).toBe(0);
      expect(result.totalLiabilities).toBe(0);
      expect(result.netWorth).toBe(0);
      expect(result.currency).toBe("ZMW");
    });
  });

  // ============================================================================
  // TODO-021: Missing tests for critical operations
  // ============================================================================

  describe("adjustBalance", () => {
    it("increases balance correctly", async () => {
      const { accountService } = await import("../AccountService");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      const mockAccount = {
        id: "acc-1",
        name: "Test Account",
        balance: "100.00",
        type: "checking",
        isPrivate: false,
        ownerUserId: testUserId,
      };
      vi.spyOn(accountRepository, "findByIdWithVisibility").mockResolvedValue(
        mockAccount as any,
      );

      const result = await accountService.adjustBalance(
        "acc-1",
        "50.00", true,
        testHouseholdId,
        testUserId,
      );

      expect(result).toBeDefined();
      // Routed through the locked transaction-create path
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");
      expect(transactionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "acc-1",
          amount: "50.00",
          type: "balance_adjustment",
          isBalanceAdjustmentIncrease: true,
        }),
      );
    });

    it("decreases balance correctly", async () => {
      const { accountService } = await import("../AccountService");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      const mockAccount = {
        id: "acc-1",
        name: "Test Account",
        balance: "100.00",
        type: "checking",
        isPrivate: false,
        ownerUserId: testUserId,
      };
      vi.spyOn(accountRepository, "findByIdWithVisibility").mockResolvedValue(
        mockAccount as any,
      );

      const result = await accountService.adjustBalance(
        "acc-1",
        "30.00", false,
        testHouseholdId,
        testUserId,
      );

      expect(result).toBeDefined();
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");
      expect(transactionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "acc-1",
          amount: "30.00",
          type: "balance_adjustment",
          isBalanceAdjustmentIncrease: false,
        }),
      );
    });

    it("throws NotFoundError for non-existent account", async () => {
      const { accountService } = await import("../AccountService");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      vi.spyOn(accountRepository, "findByIdWithVisibility").mockResolvedValue(undefined);

      await expect(
        accountService.adjustBalance(
          "non-existent",
          "50.00", true,
          testHouseholdId,
          testUserId,
        ),
      ).rejects.toThrow("Account not found");
    });
  });

  describe("archiveAccount", () => {
    it("archives an account successfully", async () => {
      const { accountService } = await import("../AccountService");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");
      const { businessAuditService } = await import("../BusinessAuditService");

      const mockAccount = {
        id: "acc-1",
        name: "Test Account",
        isArchived: true,
        isPrivate: false,
        ownerUserId: testUserId,
      };
      vi.spyOn(accountRepository, "findByIdWithVisibility").mockResolvedValue({
        ...mockAccount,
        isArchived: false,
      } as any);
      vi.spyOn(accountRepository, "archive").mockResolvedValue(
        { account: mockAccount } as any,
      );

      const result = await accountService.archiveAccount(
        "acc-1",
        testHouseholdId,
        testUserId,
      );

      expect(result.isArchived).toBe(true);
      expect(accountRepository.archive).toHaveBeenCalledWith(
        "acc-1",
        testHouseholdId,
        { userId: testUserId },
      );
      expect(businessAuditService.logUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          householdId: testHouseholdId,
          userId: testUserId,
          entityType: "account",
          entityId: "acc-1",
          oldValue: { isArchived: false },
          newValue: { isArchived: true },
        }),
      );
    });

    it("throws NotFoundError for non-existent account", async () => {
      const { accountService } = await import("../AccountService");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      vi.spyOn(accountRepository, "findByIdWithVisibility").mockResolvedValue(undefined);

      await expect(
        accountService.archiveAccount(
          "non-existent",
          testHouseholdId,
          testUserId,
        ),
      ).rejects.toThrow("Account not found");
    });
  });

  describe("unarchiveAccount", () => {
    it("unarchives an account successfully", async () => {
      const { accountService } = await import("../AccountService");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");
      const { businessAuditService } = await import("../BusinessAuditService");

      const mockAccount = {
        id: "acc-1",
        name: "Test Account",
        isArchived: false,
        isPrivate: false,
        ownerUserId: testUserId,
      };
      vi.spyOn(accountRepository, "findByIdWithVisibility").mockResolvedValue({
        ...mockAccount,
        isArchived: true,
      } as any);
      vi.spyOn(accountRepository, "unarchive").mockResolvedValue(
        { account: mockAccount } as any,
      );

      const result = await accountService.unarchiveAccount(
        "acc-1",
        testHouseholdId,
        testUserId,
      );

      expect(result.isArchived).toBe(false);
      expect(accountRepository.unarchive).toHaveBeenCalledWith(
        "acc-1",
        testHouseholdId,
        { userId: testUserId },
      );
      expect(businessAuditService.logUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          householdId: testHouseholdId,
          userId: testUserId,
          entityType: "account",
          entityId: "acc-1",
          oldValue: { isArchived: true },
          newValue: { isArchived: false },
        }),
      );
    });

    it("throws error when non-owner tries to unarchive private account", async () => {
      const { accountService } = await import("../AccountService");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      const mockAccount = {
        id: "acc-1",
        name: "Test Account",
        isArchived: true,
        isPrivate: true,
        ownerUserId: "other-user-789",
      };
      vi.spyOn(accountRepository, "findByIdWithVisibility").mockResolvedValue(
        mockAccount as any,
      );

      await expect(
        accountService.unarchiveAccount("acc-1", testHouseholdId, testUserId),
      ).rejects.toThrow("Only the owner can unarchive a private account");
    });
  });
});
