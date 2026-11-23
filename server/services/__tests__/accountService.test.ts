import { describe, it, expect, beforeEach, vi } from "vitest";
import { createAccountSummarySqlFixture, type SummaryAccountInput } from "./accountSummarySql.fixture";
import { PgDialect } from "drizzle-orm/pg-core";
import { providerFxQuotes } from "@shared/schema";
const summaryDb = vi.hoisted(() => ({ transaction: vi.fn(), execute: vi.fn() }));
vi.mock("../../db", () => ({ db: summaryDb }));
vi.mock("../../repositories/AccountCreationGrant", () => ({ lockAccountCreationGrant: vi.fn(), lockAccountHousehold: vi.fn() }));
// adjustBalance dates its ledger row on the household calendar (FIN-13).
vi.mock("../householdCalendarToday", () => ({ householdToday: vi.fn(async () => "2026-10-06") }));

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
    lockForAudit: vi.fn(),
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
        expect.any(Object),
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
        expect.any(Object),
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

      const balances: SummaryAccountInput[] = [
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
      const fixture = createAccountSummarySqlFixture(balances);
      summaryDb.transaction.mockImplementation(fixture.transaction);
      summaryDb.execute.mockImplementation(fixture.publication);

      const result = await accountService.getNetWorthSummary(
        testHouseholdId,
        testUserId,
      );

      expect(result.totalAssets).toBe(15000);
      expect(result.totalLiabilities).toBe(2000);
      expect(result.netWorth).toBe(13000);
      expect(result.currency).toBe("ZMW");
      expect(summaryDb.transaction).toHaveBeenCalledOnce();
      expect(fixture.publication).toHaveBeenCalledOnce();
    });

    it("handles empty accounts list", async () => {
      const { accountService } = await import("../AccountService");
      const fixture = createAccountSummarySqlFixture([]);
      summaryDb.transaction.mockImplementation(fixture.transaction);
      summaryDb.execute.mockImplementation(fixture.publication);

      const result = await accountService.getNetWorthSummary(
        testHouseholdId,
        testUserId,
      );

      expect(result.totalAssets).toBe(0);
      expect(result.totalLiabilities).toBe(0);
      expect(result.netWorth).toBe(0);
      expect(result.currency).toBe("ZMW");
    });

    it("keeps mixed-currency cash inputs on the first and final transaction-bound dated quote selection", async () => {
      const { accountService } = await import("../AccountService");
      const fixture = createAccountSummarySqlFixture([
        { id: "asset-usd", balance: "10.00", isAsset: true, type: "checking", currency: "USD" },
        { id: "liability-usd", balance: "2.00", isAsset: false, type: "credit", currency: "USD" },
      ], "ZMW", [{ fromCurrency: "USD", rate: "20.00" }]);
      summaryDb.transaction.mockImplementation(fixture.transaction);
      summaryDb.execute.mockImplementation(fixture.publication);
      const result = await accountService.getNetWorthSummary(testHouseholdId, testUserId);
      expect(result).toMatchObject({ totalAssets: 200, totalLiabilities: 40, netWorth: 160, currency: "ZMW" });
      expect(fixture.tx.selectDistinctOn).toHaveBeenCalledOnce();
      const predicates = fixture.tx.selectDistinctOn.mock.results.map(selection => {
        expect(selection.value.from).toHaveBeenCalledWith(providerFxQuotes);
        const query = selection.value.from.mock.results[0].value;
        expect(query.where).toHaveBeenCalledOnce();
        expect(query.orderBy).toHaveBeenCalledOnce();
        return new PgDialect().sqlToQuery(query.where.mock.calls[0][0]);
      });
      // First assembly and publication proof use the same pair, UTC day and
      // instant; the second selection is necessary even if the amount is stable.
      expect(predicates[0].params.slice(0, 4)).toEqual(["USD", "ZMW", result.valuationDate, result.valuationDate]);
      expect(predicates[0].sql).toMatch(/"effective_date" =/);
      expect(predicates[0].sql).toMatch(/"quoted_at" <=/);
      expect(fixture.publication).toHaveBeenCalledOnce();
      const final = new PgDialect().sqlToQuery(fixture.publication.mock.calls[0][0]);
      expect(final.sql).toContain('"provider_fx_quotes"');
      expect(final.sql).toMatch(/q\.quoted_at\s*<=/);
      expect(final.params).toContain(result.valuationDate);
      expect(final.params).toContain(predicates[0].params[4]);
      const input = final.params.find(value => typeof value === "string" && value.startsWith('{"currency":'));
      expect(JSON.parse(String(input))).toMatchObject({ currency: "ZMW", accounts: [
        expect.objectContaining({ id: "asset-usd", balance: "10.00", currency: "USD" }),
        expect.objectContaining({ id: "liability-usd", balance: "2.00", currency: "USD" }),
      ], quotes: [expect.objectContaining({ from: "USD", to: "ZMW", rate: "20.00", effectiveDate: result.valuationDate })] });
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
          date: "2026-10-06",
        }),
        { audit: expect.objectContaining({ userId: testUserId, householdId: testHouseholdId }) },
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
          date: "2026-10-06",
        }),
        { audit: expect.objectContaining({ userId: testUserId, householdId: testHouseholdId }) },
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
      // The pre-transaction visibility read is stale (it says archived); the
      // audit's before-state must come from the locked read instead.
      vi.spyOn(accountRepository, "findByIdWithVisibility").mockResolvedValue(
        mockAccount as any,
      );
      vi.spyOn(accountRepository, "lockForAudit").mockResolvedValue({
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
      expect(accountRepository.lockForAudit).toHaveBeenCalledWith(expect.anything(), "acc-1", testHouseholdId);
      expect(accountRepository.archive).toHaveBeenCalledWith(
        "acc-1",
        testHouseholdId,
        { userId: testUserId },
        expect.anything(), // the write's transaction, shared with its audit row
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
      vi.spyOn(accountRepository, "lockForAudit").mockResolvedValue({
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
        expect.anything(), // the write's transaction, shared with its audit row
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
