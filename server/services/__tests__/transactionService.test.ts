import type { Transaction } from "@shared/schema";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readPreparedTransfer, TransferCreateRequest } from "../TransferCreateRequest";

vi.mock("../../repositories/TransferReplay", async importOriginal => ({
  ...await importOriginal<typeof import("../../repositories/TransferReplay")>(),
  transferQuoteAccounts: vi.fn(async (householdId: string, userId: string, from: string, to: string) => {
    const { accountRepository } = await import("../../repositories/AccountRepository");
    return { from: await accountRepository.findByIdWithVisibility(from, householdId, userId),
      to: await accountRepository.findByIdWithVisibility(to, householdId, userId) };
  }),
}));

vi.mock("../transaction/idempotentReplay", () => ({
  readVisibleIdempotentReplay: vi.fn(async (transaction: unknown) => transaction),
}));

/**
 * Transaction Service Tests
 *
 * Tests for TransactionService business logic including:
 * - Idempotency handling
 * - Transfer validation
 * - Privacy enforcement
 */

vi.mock("../../repositories/TransactionSummaryInputs", async importOriginal => ({
  ...await importOriginal<typeof import("../../repositories/TransactionSummaryInputs")>(),
  readTransactionSummaryInputs: vi.fn(),
}));
// Mock repositories
vi.mock("../../repositories/TransactionRepository", () => ({
  transactionRepository: {
    findByHouseholdWithVisibility: vi.fn(),
    findByIdWithVisibility: vi.fn(),
    findByIdempotencyKey: vi.fn(),
    create: vi.fn(),
    createTransfer: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    findTransferPair: vi.fn(),
  },
}));

vi.mock("../../repositories/TransactionTransferRepository", () => ({
  transactionTransferRepository: {
    createTransfer: vi.fn(),
    findTransferPair: vi.fn(),
    softDeleteTransferPair: vi.fn(),
  },
}));

vi.mock("../../repositories/AccountRepository", () => ({
  accountRepository: {
    findByIdWithVisibility: vi.fn(),
  },
}));

vi.mock("../../repositories/MerchantRepository", () => ({
  merchantRepository: {
    findByIdAndHousehold: vi.fn(),
    findByNameOrAlias: vi.fn(),
    search: vi.fn(),
    getAliases: vi.fn(),
  },
}));

// Mock householdRepository for FX conversion and base currency lookups
vi.mock("../../repositories/HouseholdRepository", () => ({
  householdRepository: {
    findById: vi
      .fn()
      .mockResolvedValue({ id: "test-household-123", currency: "ZMW" }),
    findPreferences: vi
      .fn()
      .mockResolvedValue({ showPendingTransactions: true }),
  },
}));

vi.mock("../../core/calculations", () => ({
  getLatestFxRates: vi.fn().mockResolvedValue(new Map<string, number>()),
}));

vi.mock("../RuleService", () => ({
  ruleService: {
    applyRules: vi.fn(async (transaction: any) => transaction),
  },
}));

// Mock logger
vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("TransactionService", () => {
  const testHouseholdId = "test-household-123";
  const testUserId = "test-user-456";

  beforeEach(async () => {
    vi.clearAllMocks();
    const { accountRepository } = await import("../../repositories/AccountRepository");
    vi.mocked(accountRepository.findByIdWithVisibility).mockReset();

    const { merchantRepository } =
      await import("../../repositories/MerchantRepository");
    (merchantRepository.findByIdAndHousehold as any).mockResolvedValue(
      undefined,
    );
    (merchantRepository.findByNameOrAlias as any).mockResolvedValue(undefined);
    (merchantRepository.search as any).mockResolvedValue([]);
    (merchantRepository.getAliases as any).mockResolvedValue([]);
  });

  describe("createTransaction", () => {
    it("returns existing transaction if idempotency key matches", async () => {
      const { transactionService } = await import("../TransactionService");
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");
      const { readVisibleIdempotentReplay } = await import("../transaction/idempotentReplay");

      const existingTxn = {
        id: "existing-txn",
        name: "Existing Transaction",
        amount: "100.00",
        type: "expense",
        idempotencyKey: "key-123",
      };
      (transactionRepository.findByIdempotencyKey as any).mockResolvedValue(
        existingTxn,
      );

      const result = await transactionService.createTransaction(
        {
          accountId: "acc-1",
          date: "2024-01-15",
          name: "New Transaction",
          amount: "100.00",
          type: "expense",
        },
        testHouseholdId,
        testUserId,
        "key-123",
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.transaction.id).toBe(existingTxn.id);
      expect(readVisibleIdempotentReplay).toHaveBeenCalledWith(existingTxn, testHouseholdId, testUserId, undefined, undefined, expect.stringMatching(/^v1:[0-9a-f]{64}$/), undefined);
    });

    it("creates new transaction when no idempotency key exists", async () => {
      const { transactionService } = await import("../TransactionService");
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      (transactionRepository.findByIdempotencyKey as any).mockResolvedValue(
        undefined,
      );
      (accountRepository.findByIdWithVisibility as any).mockResolvedValue({
        id: "acc-1",
        name: "Account",
      });

      const newTxn = {
        id: "new-txn",
        name: "New Transaction",
        amount: "100.00",
        type: "expense",
      };
      (transactionRepository.create as any).mockResolvedValue({
        transaction: newTxn,
      });

      const result = await transactionService.createTransaction(
        {
          accountId: "acc-1",
          date: "2024-01-15",
          name: "New Transaction",
          amount: "100.00",
          type: "expense",
        },
        testHouseholdId,
        testUserId,
        "new-key",
      );

      expect(result.isDuplicate).toBe(false);
      expect(transactionRepository.create).toHaveBeenCalled();
    });

    it("throws ValidationError when type is 'transfer'", async () => {
      const { transactionService } = await import("../TransactionService");
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      (transactionRepository.findByIdempotencyKey as any).mockResolvedValue(
        undefined,
      );
      (accountRepository.findByIdWithVisibility as any).mockResolvedValue({
        id: "acc-1",
      });

      await expect(
        transactionService.createTransaction(
          {
            accountId: "acc-1",
            date: "2024-01-15",
            name: "Transfer",
            amount: "100.00",
            type: "transfer" as any,
          },
          testHouseholdId,
          testUserId,
        ),
      ).rejects.toThrow(
        "Use POST /api/transactions/transfer to create transfers",
      );
    });

    it("throws NotFoundError when account does not exist", async () => {
      const { transactionService } = await import("../TransactionService");
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      (transactionRepository.findByIdempotencyKey as any).mockResolvedValue(
        undefined,
      );
      (accountRepository.findByIdWithVisibility as any).mockResolvedValue(
        undefined,
      );

      await expect(
        transactionService.createTransaction(
          {
            accountId: "nonexistent-acc",
            date: "2024-01-15",
            name: "Transaction",
            amount: "100.00",
            type: "expense",
          },
          testHouseholdId,
          testUserId,
        ),
      ).rejects.toThrow("Account not found");
    });
  });

  describe("createTransfer", () => {
    it("throws ValidationError when from and to accounts are the same", async () => {
      const { transactionService } = await import("../TransactionService");
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");

      (transactionRepository.findByIdempotencyKey as any).mockResolvedValue(
        undefined,
      );

      await expect(
        transactionService.createTransfer(
          "acc-1",
          "acc-1", // Same as source
          "100",
          testHouseholdId,
          testUserId,
        ),
      ).rejects.toThrow("Cannot transfer to the same account");
    });

    it("throws NotFoundError when source account does not exist", async () => {
      const { transactionService } = await import("../TransactionService");
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      (transactionRepository.findByIdempotencyKey as any).mockResolvedValue(
        undefined,
      );
      (accountRepository.findByIdWithVisibility as any).mockResolvedValue(
        undefined,
      );

      await expect(
        transactionService.createTransfer(
          "nonexistent-acc",
          "acc-2",
          "100",
          testHouseholdId,
          testUserId,
        ),
      ).rejects.toThrow("Source account not found");
    });

    it("throws NotFoundError when destination account does not exist", async () => {
      const { transactionService } = await import("../TransactionService");
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      (transactionRepository.findByIdempotencyKey as any).mockResolvedValue(
        undefined,
      );
      // First call: source account exists
      (accountRepository.findByIdWithVisibility as any)
        .mockResolvedValueOnce({ id: "acc-1" })
        .mockResolvedValueOnce(undefined); // Second call: destination doesn't exist

      await expect(
        transactionService.createTransfer(
          "acc-1",
          "nonexistent-acc",
          "100",
          testHouseholdId,
          testUserId,
        ),
      ).rejects.toThrow("Destination account not found");
    });

    it("throws ValidationError when amount is not positive", async () => {
      const { transactionService } = await import("../TransactionService");
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      (transactionRepository.findByIdempotencyKey as any).mockResolvedValue(
        undefined,
      );
      // Mock accounts for first assertion
      (accountRepository.findByIdWithVisibility as any)
        .mockResolvedValueOnce({ id: "acc-1" })
        .mockResolvedValueOnce({ id: "acc-2" });

      await expect(
        transactionService.createTransfer(
          "acc-1",
          "acc-2",
          "0",
          testHouseholdId,
          testUserId,
        ),
      ).rejects.toThrow("Amount must be positive");

      // Mock accounts for second assertion
      (accountRepository.findByIdWithVisibility as any)
        .mockResolvedValueOnce({ id: "acc-1" })
        .mockResolvedValueOnce({ id: "acc-2" });

      await expect(
        transactionService.createTransfer(
          "acc-1",
          "acc-2",
          "-100",
          testHouseholdId,
          testUserId,
        ),
      ).rejects.toThrow("Amount must be positive");
    });

    it("creates transfer with correct structure", async () => {
      const { transactionService } = await import("../TransactionService");
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      (transactionRepository.findByIdempotencyKey as any).mockResolvedValue(
        undefined,
      );
      (accountRepository.findByIdWithVisibility as any)
        .mockResolvedValueOnce({
          id: "acc-1",
          name: "From Account",
          currency: "ZMW",
        })
        .mockResolvedValueOnce({
          id: "acc-2",
          name: "To Account",
          currency: "ZMW",
        });

      const transferResult = {
        outflow: {
          id: "txn-1",
          type: "transfer",
          isTransferIn: false,
          accountId: "acc-1",
        },
        inflow: {
          id: "txn-2",
          type: "transfer",
          isTransferIn: true,
          accountId: "acc-2",
        },
        isDuplicate: false,
      };
      (transactionRepository.createTransfer as any).mockResolvedValue(
        transferResult,
      );

      const result = await transactionService.createTransfer(
        "acc-1",
        "acc-2",
        "100",
        testHouseholdId,
        testUserId,
      );

      expect(result.outflow.isTransferIn).toBe(false);
      expect(result.inflow.isTransferIn).toBe(true);
      expect(result.isDuplicate).toBe(false);
    });
  });

  describe("createTransfer - Cross-Currency (T-10 Fix)", () => {
    it("throws ValidationError when cross-currency transfer lacks fxRate", async () => {
      const { transactionService } = await import("../TransactionService");
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      (transactionRepository.findByIdempotencyKey as any).mockResolvedValue(
        undefined,
      );
      // USD account and ZMW account (different currencies)
      (accountRepository.findByIdWithVisibility as any)
        .mockResolvedValueOnce({
          id: "acc-1",
          name: "USD Account",
          currency: "USD",
        })
        .mockResolvedValueOnce({
          id: "acc-2",
          name: "ZMW Account",
          currency: "ZMW",
        });

      await expect(
        transactionService.createTransfer(
          "acc-1",
          "acc-2",
          "100",
          testHouseholdId,
          testUserId,
          // No fxRate provided
        ),
      ).rejects.toThrow("FX rate is required for cross-currency transfers");
    });

    it("throws ValidationError when fxRate is invalid (zero)", async () => {
      const { transactionService } = await import("../TransactionService");
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      (transactionRepository.findByIdempotencyKey as any).mockResolvedValue(
        undefined,
      );
      (accountRepository.findByIdWithVisibility as any)
        .mockResolvedValueOnce({
          id: "acc-1",
          name: "USD Account",
          currency: "USD",
        })
        .mockResolvedValueOnce({
          id: "acc-2",
          name: "ZMW Account",
          currency: "ZMW",
        });

      await expect(
        transactionService.createTransfer(
          "acc-1",
          "acc-2",
          "100",
          testHouseholdId,
          testUserId,
          { fxRate: "0" },
        ),
      ).rejects.toThrow("FX rate must be a positive number");
    });

    it("throws ValidationError when fxRate is negative", async () => {
      const { transactionService } = await import("../TransactionService");
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      (transactionRepository.findByIdempotencyKey as any).mockResolvedValue(
        undefined,
      );
      (accountRepository.findByIdWithVisibility as any)
        .mockResolvedValueOnce({
          id: "acc-1",
          name: "USD Account",
          currency: "USD",
        })
        .mockResolvedValueOnce({
          id: "acc-2",
          name: "ZMW Account",
          currency: "ZMW",
        });

      await expect(
        transactionService.createTransfer(
          "acc-1",
          "acc-2",
          "100",
          testHouseholdId,
          testUserId,
          { fxRate: "-25.5" },
        ),
      ).rejects.toThrow("FX rate must be a positive number");
    });

    it("creates cross-currency transfer with valid fxRate", async () => {
      const { transactionService } = await import("../TransactionService");
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      (transactionRepository.findByIdempotencyKey as any).mockResolvedValue(
        undefined,
      );
      (accountRepository.findByIdWithVisibility as any)
        .mockResolvedValueOnce({
          id: "acc-1",
          name: "USD Account",
          currency: "USD",
        })
        .mockResolvedValueOnce({
          id: "acc-2",
          name: "ZMW Account",
          currency: "ZMW",
        });

      const transferResult = {
        outflow: {
          id: "txn-1",
          type: "transfer",
          isTransferIn: false,
          accountId: "acc-1",
          fxRate: "25.50",
          fxBaseCurrency: "USD",
          fxQuoteCurrency: "ZMW",
        },
        inflow: {
          id: "txn-2",
          type: "transfer",
          isTransferIn: true,
          accountId: "acc-2",
          fxRate: "25.50",
          fxBaseCurrency: "USD",
          fxQuoteCurrency: "ZMW",
        },
        isDuplicate: false,
      };
      (transactionRepository.createTransfer as any).mockResolvedValue(
        transferResult,
      );

      const result = await transactionService.createTransfer(
        "acc-1",
        "acc-2",
        "100",
        testHouseholdId,
        testUserId,
        { fxRate: "25.50", fxSource: "manual" },
      );

      expect(result.isDuplicate).toBe(false);
      expect(transactionRepository.createTransfer).toHaveBeenCalledWith(
        "acc-1",
        "acc-2",
        "100.00", // Money string format
        expect.any(TransferCreateRequest),
      );
      expect(readPreparedTransfer(vi.mocked(transactionRepository.createTransfer).mock.lastCall![3] as TransferCreateRequest).posting)
        .toMatchObject({
          fxRate: "25.50",
          fxBaseCurrency: "USD",
          fxQuoteCurrency: "ZMW",
          fxSource: "manual",
          convertedAmount: "2550.00", // 100 * 25.50
        });
    });

    it("converts to base currency when neither side is base", async () => {
      const { transactionService } = await import("../TransactionService");
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");
      const { getLatestFxRates } = await import("../../core/calculations");

      (transactionRepository.findByIdempotencyKey as any).mockResolvedValue(
        undefined,
      );
      (accountRepository.findByIdWithVisibility as any)
        .mockResolvedValueOnce({
          id: "acc-1",
          name: "USD Account",
          currency: "USD",
        })
        .mockResolvedValueOnce({
          id: "acc-2",
          name: "EUR Account",
          currency: "EUR",
        });

      // Provide USD->ZMW and EUR->ZMW rates; base currency is ZMW
      (getLatestFxRates as any).mockResolvedValue(
        new Map<string, number>([
          ["USD", 20],
          ["EUR", 25],
        ]),
      );

      const transferResult = {
        outflow: { id: "txn-1", type: "transfer", isTransferIn: false },
        inflow: { id: "txn-2", type: "transfer", isTransferIn: true },
        isDuplicate: false,
      };
      (transactionRepository.createTransfer as any).mockResolvedValue(
        transferResult,
      );

      await transactionService.createTransfer(
        "acc-1",
        "acc-2",
        "100",
        testHouseholdId,
        testUserId,
        { fxRate: "0.9", fxSource: "manual" },
      );

      expect(transactionRepository.createTransfer).toHaveBeenCalledWith(
        "acc-1",
        "acc-2",
        "100.00",
        expect.any(TransferCreateRequest),
      );
      expect(readPreparedTransfer(vi.mocked(transactionRepository.createTransfer).mock.lastCall![3] as TransferCreateRequest).posting)
        .toMatchObject({
          fxRate: "0.9",
          convertedAmount: "2000.00", // 100 USD * 20 USD->ZMW
        });
    });

    it("does not require fxRate for same-currency transfer", async () => {
      const { transactionService } = await import("../TransactionService");
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      (transactionRepository.findByIdempotencyKey as any).mockResolvedValue(
        undefined,
      );
      // Both accounts are ZMW
      (accountRepository.findByIdWithVisibility as any)
        .mockResolvedValueOnce({
          id: "acc-1",
          name: "ZMW Account 1",
          currency: "ZMW",
        })
        .mockResolvedValueOnce({
          id: "acc-2",
          name: "ZMW Account 2",
          currency: "ZMW",
        });

      const transferResult = {
        outflow: { id: "txn-1", type: "transfer", isTransferIn: false },
        inflow: { id: "txn-2", type: "transfer", isTransferIn: true },
        isDuplicate: false,
      };
      (transactionRepository.createTransfer as any).mockResolvedValue(
        transferResult,
      );

      // Should NOT throw even without fxRate
      const result = await transactionService.createTransfer(
        "acc-1",
        "acc-2",
        "100",
        testHouseholdId,
        testUserId,
      );

      expect(result.isDuplicate).toBe(false);
    });
  });

  describe("createTransaction - Currency Enforcement", () => {
    it("throws ValidationError when transaction currency mismatches account currency", async () => {
      const { transactionService } = await import("../TransactionService");
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      (transactionRepository.findByIdempotencyKey as any).mockResolvedValue(
        undefined,
      );
      // Account is ZMW
      (accountRepository.findByIdWithVisibility as any).mockResolvedValue({
        id: "acc-1",
        name: "ZMW Account",
        currency: "ZMW",
      });

      await expect(
        transactionService.createTransaction(
          {
            accountId: "acc-1",
            date: "2024-01-15",
            name: "USD Transaction",
            amount: "100.00",
            type: "expense",
            currency: "USD", // Mismatched!
          },
          testHouseholdId,
          testUserId,
        ),
      ).rejects.toThrow("Transaction currency must match account currency");
    });

    it("accepts transaction with matching currency", async () => {
      const { transactionService } = await import("../TransactionService");
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      (transactionRepository.findByIdempotencyKey as any).mockResolvedValue(
        undefined,
      );
      (accountRepository.findByIdWithVisibility as any).mockResolvedValue({
        id: "acc-1",
        name: "ZMW Account",
        currency: "ZMW",
      });

      const newTxn = {
        id: "new-txn",
        name: "ZMW Transaction",
        amount: "100.00",
        type: "expense",
        currency: "ZMW",
      };
      (transactionRepository.create as any).mockResolvedValue({
        transaction: newTxn,
      });

      const result = await transactionService.createTransaction(
        {
          accountId: "acc-1",
          date: "2024-01-15",
          name: "ZMW Transaction",
          amount: "100.00",
          type: "expense",
          currency: "ZMW", // Matches account
        },
        testHouseholdId,
        testUserId,
      );

      expect(result.isDuplicate).toBe(false);
    });

    it("defaults to account currency when no currency specified", async () => {
      const { transactionService } = await import("../TransactionService");
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");
      const { accountRepository } =
        await import("../../repositories/AccountRepository");

      (transactionRepository.findByIdempotencyKey as any).mockResolvedValue(
        undefined,
      );
      (accountRepository.findByIdWithVisibility as any).mockResolvedValue({
        id: "acc-1",
        name: "USD Account",
        currency: "USD",
      });

      const newTxn = {
        id: "new-txn",
        name: "Transaction",
        amount: "100.00",
        type: "expense",
        currency: "USD",
      };
      (transactionRepository.create as any).mockResolvedValue({
        transaction: newTxn,
      });

      await transactionService.createTransaction(
        {
          accountId: "acc-1",
          date: "2024-01-15",
          name: "Transaction",
          amount: "100.00",
          type: "expense",
          // No currency specified
        },
        testHouseholdId,
        testUserId,
      );

      // Should pass account currency to repository. Second arg is the P6a
      // audit option (Rule 9: CREATE is now audited atomically at the
      // repository layer instead of only by the controller).
      expect(transactionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: "USD", // Defaulted to account currency
        }),
        expect.objectContaining({
          audit: expect.objectContaining({
            userId: testUserId,
            householdId: testHouseholdId,
          }),
        }),
      );
    });
  });

  describe("updateTransaction", () => {
    it("throws AuthorizationError when modifying private transaction owned by another user", async () => {
      const { transactionService } = await import("../TransactionService");
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");

      const privateTxn = {
        id: "txn-1",
        isPrivate: true,
        ownerUserId: "other-user",
        type: "expense",
      };
      (transactionRepository.findByIdWithVisibility as any).mockResolvedValue(
        privateTxn,
      );

      await expect(
        transactionService.updateTransaction(
          "txn-1",
          { name: "New Name" },
          testHouseholdId,
          testUserId,
        ),
      ).rejects.toThrow(
        "Cannot modify private transaction owned by another user",
      );
    });

    it("throws ValidationError when changing type to/from transfer", async () => {
      const { transactionService } = await import("../TransactionService");
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");

      const txn = {
        id: "txn-1",
        isPrivate: false,
        ownerUserId: testUserId,
        type: "expense",
      };
      (transactionRepository.findByIdWithVisibility as any).mockResolvedValue(
        txn,
      );

      await expect(
        transactionService.updateTransaction(
          "txn-1",
          { type: "transfer" } as any,
          testHouseholdId,
          testUserId,
        ),
      ).rejects.toThrow("Cannot change transaction type to/from transfer");
    });

    it("blocks an amount-only edit on a transfer leg (pair desync guard)", async () => {
      const { transactionService } = await import("../TransactionService");
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");

      // No data.type supplied, so the type guard above does not fire; the
      // material-field guard must still reject the single-leg amount change.
      const transferLeg = {
        id: "txn-1",
        isPrivate: false,
        ownerUserId: testUserId,
        type: "transfer",
        amount: "100.00",
        accountId: "acct-1",
        date: "2026-07-01",
        currency: "ZMW",
      } as unknown as import("@shared/schema").Transaction;
      vi.mocked(transactionRepository.findByIdWithVisibility).mockResolvedValue(
        transferLeg,
      );

      await expect(
        transactionService.updateTransaction(
          "txn-1",
          { amount: "150.00" },
          testHouseholdId,
          testUserId,
        ),
      ).rejects.toThrow(
        "Transfer legs cannot be modified through the generic transaction update",
      );
    });

    it("blocks moving a transfer leg to a different account", async () => {
      const { transactionService } = await import("../TransactionService");
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");

      const transferLeg = {
        id: "txn-1",
        isPrivate: false,
        ownerUserId: testUserId,
        type: "transfer",
        amount: "100.00",
        accountId: "acct-1",
        date: "2026-07-01",
        currency: "ZMW",
      } as unknown as import("@shared/schema").Transaction;
      vi.mocked(transactionRepository.findByIdWithVisibility).mockResolvedValue(
        transferLeg,
      );

      await expect(
        transactionService.updateTransaction(
          "txn-1",
          { accountId: "acct-2" },
          testHouseholdId,
          testUserId,
        ),
      ).rejects.toThrow(
        "Transfer legs cannot be modified through the generic transaction update",
      );
    });

    it("blocks changing the date or currency of a transfer leg", async () => {
      const { transactionService } = await import("../TransactionService");
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");

      const transferLeg = {
        id: "txn-1",
        isPrivate: false,
        ownerUserId: testUserId,
        type: "transfer",
        amount: "100.00",
        accountId: "acct-1",
        date: "2026-07-01",
        currency: "ZMW",
      } as unknown as import("@shared/schema").Transaction;
      vi.mocked(transactionRepository.findByIdWithVisibility).mockResolvedValue(
        transferLeg,
      );

      await expect(
        transactionService.updateTransaction(
          "txn-1",
          { date: "2026-07-02" },
          testHouseholdId,
          testUserId,
        ),
      ).rejects.toThrow(
        "Transfer legs cannot be modified through the generic transaction update",
      );

      vi.mocked(transactionRepository.findByIdWithVisibility).mockResolvedValue(
        transferLeg,
      );

      await expect(
        transactionService.updateTransaction(
          "txn-1",
          { currency: "USD" },
          testHouseholdId,
          testUserId,
        ),
      ).rejects.toThrow(
        "Transfer legs cannot be modified through the generic transaction update",
      );
    });
  });

  describe("deleteTransaction", () => {
    const transferTxn = {
      id: "txn-1",
      type: "transfer",
      transferTransactionId: "transfer-pair-id",
      isPrivate: false,
      ownerUserId: testUserId,
    } as unknown as import("@shared/schema").Transaction;

    it("deletes both transfer legs atomically when deleting one side", async () => {
      const { transactionService } = await import("../TransactionService");
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");
      const { transactionTransferRepository } = await import(
        "../../repositories/TransactionTransferRepository"
      );

      vi.mocked(
        transactionRepository.findByIdWithVisibility,
      ).mockResolvedValue(transferTxn);
      vi.mocked(
        transactionTransferRepository.softDeleteTransferPair,
      ).mockResolvedValue(2);

      await transactionService.deleteTransaction(
        "txn-1",
        testHouseholdId,
        testUserId,
      );

      // Both legs are deleted in ONE atomic repository call (pair + accounts
      // locked in a single transaction), not two sequential softDeletes.
      // Third arg is the P6a audit option (Rule 9: DELETE is now audited
      // atomically at the repository layer instead of only by the controller).
      expect(
        transactionTransferRepository.softDeleteTransferPair,
      ).toHaveBeenCalledWith(
        "transfer-pair-id",
        testHouseholdId,
        expect.objectContaining({
          audit: expect.objectContaining({
            userId: testUserId,
            entityId: "txn-1",
          }),
        }),
      );
      expect(transactionRepository.softDelete).not.toHaveBeenCalled();
    });

    it("throws NotFoundError when the transfer pair is already deleted", async () => {
      const { transactionService } = await import("../TransactionService");
      const { transactionRepository } =
        await import("../../repositories/TransactionRepository");
      const { transactionTransferRepository } = await import(
        "../../repositories/TransactionTransferRepository"
      );

      vi.mocked(
        transactionRepository.findByIdWithVisibility,
      ).mockResolvedValue(transferTxn);
      vi.mocked(
        transactionTransferRepository.softDeleteTransferPair,
      ).mockResolvedValue(0);

      await expect(
        transactionService.deleteTransaction(
          "txn-1",
          testHouseholdId,
          testUserId,
        ),
      ).rejects.toThrow("Transaction not found");
    });
  });

  describe("getTransactionSummary", () => {
    it("correctly calculates income and expense totals", async () => {
      const { transactionService } = await import("../TransactionService");
      const transactions = [
        {
          id: "1",
          type: "income",
          amount: "1000.00",
          isExcludedFromReports: false,
        },
        {
          id: "2",
          type: "income",
          amount: "500.00",
          isExcludedFromReports: false,
        },
        {
          id: "3",
          type: "expense",
          amount: "300.00",
          isExcludedFromReports: false,
        },
        {
          id: "4",
          type: "expense",
          amount: "200.00",
          isExcludedFromReports: false,
        },
        {
          id: "5",
          type: "transfer",
          amount: "100.00",
          isExcludedFromReports: false,
        }, // Should be excluded
        {
          id: "6",
          type: "expense",
          amount: "50.00",
          isExcludedFromReports: true,
        }, // Excluded from reports
      ];
      const { readTransactionSummaryInputs } = await import("../../repositories/TransactionSummaryInputs");
      vi.mocked(readTransactionSummaryInputs).mockResolvedValue({
        currency: "ZMW",
        rows: transactions.map(row => ({ ...row, currency: "ZMW", date: "2024-01-15" })) as Transaction[],
      });
      const result = await transactionService.getTransactionSummary(
        testHouseholdId,
        testUserId,
        "2024-01-01",
        "2024-01-31",
      );

      expect(result.totalIncome).toBe("1500.00");
      expect(result.totalExpenses).toBe("500.00");
      expect(result.netFlow).toBe("1000.00");
      expect(result.transactionCount).toBe(6);
    });
  });
});
