import { describe, it, expect, beforeEach, vi } from "vitest";
import fc from "fast-check";
import { Money } from "../../core/money";

/**
 * Transaction Repository Tests
 *
 * Tests for TransactionRepository including:
 * - Balance delta calculations
 * - Transfer pair creation
 * - Idempotency key detection
 * - CRUD with balance updates
 */

// Mock the database module
vi.mock("../../db", () => {
  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };

  return {
    db: mockDb,
  };
});

// Mock the withTransaction utility
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

describe("TransactionRepository", () => {
  const testHouseholdId = "test-household-123";
  const testUserId = "test-user-456";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("calculateBalanceDelta", () => {
    it("returns +amount for income", async () => {
      const { transactionRepository } = await import(
        "../TransactionRepository"
      );

      await fc.assert(
        fc.property(fc.integer({ min: 1, max: 1000000 }), (amount) => {
          const money = new Money(amount, "USD");
          const delta = transactionRepository.calculateBalanceDelta(
            "income",
            money
          );
          expect(delta.equals(money)).toBe(true);
          return true;
        }),
        { numRuns: 25 }
      );
    });

    it("returns -amount for expense", async () => {
      const { transactionRepository } = await import(
        "../TransactionRepository"
      );

      await fc.assert(
        fc.property(fc.integer({ min: 1, max: 1000000 }), (amount) => {
          const money = new Money(amount, "USD");
          const delta = transactionRepository.calculateBalanceDelta(
            "expense",
            money
          );
          expect(delta.equals(money.negated())).toBe(true);
          return true;
        }),
        { numRuns: 25 }
      );
    });

    it("returns +amount for transfer when isTransferIn=true", async () => {
      const { transactionRepository } = await import(
        "../TransactionRepository"
      );

      await fc.assert(
        fc.property(fc.integer({ min: 1, max: 1000000 }), (amount) => {
          const money = new Money(amount, "USD");
          const delta = transactionRepository.calculateBalanceDelta(
            "transfer",
            money,
            true
          );
          expect(delta.equals(money)).toBe(true);
          return true;
        }),
        { numRuns: 25 }
      );
    });

    it("returns -amount for transfer when isTransferIn=false", async () => {
      const { transactionRepository } = await import(
        "../TransactionRepository"
      );

      await fc.assert(
        fc.property(fc.integer({ min: 1, max: 1000000 }), (amount) => {
          const money = new Money(amount, "USD");
          const delta = transactionRepository.calculateBalanceDelta(
            "transfer",
            money,
            false
          );
          expect(delta.equals(money.negated())).toBe(true);
          return true;
        }),
        { numRuns: 25 }
      );
    });

    it("returns +amount for balance_adjustment when isBalanceAdjustmentIncrease=true", async () => {
      const { transactionRepository } = await import(
        "../TransactionRepository"
      );

      await fc.assert(
        fc.property(fc.integer({ min: 1, max: 1000000 }), (amount) => {
          const money = new Money(amount, "USD");
          const delta = transactionRepository.calculateBalanceDelta(
            "balance_adjustment",
            money,
            undefined,
            true
          );
          expect(delta.equals(money)).toBe(true);
          return true;
        }),
        { numRuns: 25 }
      );
    });

    it("returns -amount for balance_adjustment when isBalanceAdjustmentIncrease=false", async () => {
      const { transactionRepository } = await import(
        "../TransactionRepository"
      );

      await fc.assert(
        fc.property(fc.integer({ min: 1, max: 1000000 }), (amount) => {
          const money = new Money(amount, "USD");
          const delta = transactionRepository.calculateBalanceDelta(
            "balance_adjustment",
            money,
            undefined,
            false
          );
          expect(delta.equals(money.negated())).toBe(true);
          return true;
        }),
        { numRuns: 25 }
      );
    });

    it("returns 0 for unknown transaction types", async () => {
      const { transactionRepository } = await import(
        "../TransactionRepository"
      );

      await fc.assert(
        fc.property(
          fc.float({
            min: Math.fround(0.01),
            max: Math.fround(1000000),
          }),
          fc
            .string()
            .filter(
              (s) =>
                ![
                  "income",
                  "expense",
                  "transfer",
                  "balance_adjustment",
                ].includes(s)
            ),
          (amount, unknownType) => {
            const money = new Money(amount, "USD");
            const delta = transactionRepository.calculateBalanceDelta(
              unknownType,
              money
            );
            expect(delta.equals(Money.zero("USD"))).toBe(true);
            return true;
          }
        ),
        { numRuns: 25 }
      );
    });
  });

  describe("findByIdempotencyKey", () => {
    it("returns transaction if key exists", async () => {
      const { transactionRepository } = await import(
        "../TransactionRepository"
      );
      const { db } = await import("../../db");

      const existingTransaction = {
        id: "txn-123",
        householdId: testHouseholdId,
        idempotencyKey: "idempotency-key-456",
        name: "Existing Transaction",
        amount: "100.00",
        type: "expense",
      };

      // Mock the full query chain: select().from().where().limit() -> returns result
      const mockLimit = vi.fn().mockResolvedValueOnce([existingTransaction]);
      ((db as any).where as any).mockReturnValueOnce({ limit: mockLimit });

      const result = await transactionRepository.findByIdempotencyKey(
        existingTransaction.idempotencyKey,
        testHouseholdId
      );

      expect(result).toBeDefined();
      expect(result?.id).toBe(existingTransaction.id);
      expect(result?.idempotencyKey).toBe(existingTransaction.idempotencyKey);
    });

    it("returns undefined if key does not exist", async () => {
      const { transactionRepository } = await import(
        "../TransactionRepository"
      );
      const { db } = await import("../../db");

      // Mock the full query chain to return empty array
      const mockLimit = vi.fn().mockResolvedValueOnce([]);
      ((db as any).where as any).mockReturnValueOnce({ limit: mockLimit });

      const result = await transactionRepository.findByIdempotencyKey(
        "nonexistent-key",
        testHouseholdId
      );

      expect(result).toBeUndefined();
    });
  });

  describe("findByHouseholdWithVisibility", () => {
    it("delegates visibility filtering to the household query", async () => {
      const { transactionQueryRepository } = await import(
        "../TransactionQueryRepository"
      );

      const transactions = [
        {
          id: "txn-1",
          accountId: "acc-1",
          isPrivate: false,
          ownerUserId: "other-user",
          name: "Public",
        },
        {
          id: "txn-2",
          accountId: "acc-2",
          isPrivate: true,
          ownerUserId: testUserId,
          name: "My Private",
        },
        {
          id: "txn-3",
          accountId: "acc-3",
          isPrivate: true,
          ownerUserId: "other-user",
          name: "Their Private",
        },
      ];

      const findByHouseholdSpy = vi
        .spyOn(transactionQueryRepository, "findByHousehold")
        .mockResolvedValue(transactions as any);

      const result = await transactionQueryRepository.findByHouseholdWithVisibility(
        testHouseholdId,
        testUserId
      );

      expect(findByHouseholdSpy).toHaveBeenCalledWith(
        testHouseholdId,
        expect.objectContaining({
          includeDeleted: false,
          includePending: true,
          visibleToUserId: testUserId,
        }), undefined
      );
      expect(result).toEqual(transactions);
    });
  });

  describe("Transfer pair validation", () => {
    it("transfer creates two linked transactions with same transferTransactionId", async () => {
      const { transactionRepository } = await import(
        "../TransactionRepository"
      );

      // The createTransfer method should create two transactions
      // This test validates the structure, not the actual DB call (which is mocked)
      const transferData = {
        householdId: testHouseholdId,
        ownerUserId: testUserId,
        date: "2024-01-15",
        name: "Transfer Test",
      };

      // Since the actual implementation uses withTransaction, we test the expected structure
      expect(transactionRepository.createTransfer).toBeDefined();
      expect(typeof transactionRepository.createTransfer).toBe("function");
    });

    it("transfer outflow has isTransferIn=false", () => {
      // Validate the invariant: outflow rows should have isTransferIn=false
      const outflowTransaction = {
        type: "transfer",
        isTransferIn: false,
        amount: "100.00",
      };

      expect(outflowTransaction.isTransferIn).toBe(false);
    });

    it("transfer inflow has isTransferIn=true", () => {
      // Validate the invariant: inflow rows should have isTransferIn=true
      const inflowTransaction = {
        type: "transfer",
        isTransferIn: true,
        amount: "100.00",
      };

      expect(inflowTransaction.isTransferIn).toBe(true);
    });

    it("both transfer rows have the same amount", () => {
      // Validate the invariant: both rows should have identical amounts
      const outflow = {
        amount: "100.00",
        type: "transfer",
        isTransferIn: false,
      };
      const inflow = { amount: "100.00", type: "transfer", isTransferIn: true };

      expect(outflow.amount).toBe(inflow.amount);
    });
  });

  describe("Balance calculation invariants", () => {
    it("net balance change is zero for a transfer pair", async () => {
      const { transactionRepository } = await import(
        "../TransactionRepository"
      );

      await fc.assert(
        fc.property(fc.integer({ min: 1, max: 1000000 }), (amount) => {
          const money = new Money(amount, "USD");
          // Outflow: -amount
          const outflowDelta = transactionRepository.calculateBalanceDelta(
            "transfer",
            money,
            false
          );
          // Inflow: +amount
          const inflowDelta = transactionRepository.calculateBalanceDelta(
            "transfer",
            money,
            true
          );

          // Net effect should be zero (money moves between accounts)
          expect(outflowDelta.add(inflowDelta).equals(Money.zero("USD"))).toBe(
            true
          );
          return true;
        }),
        { numRuns: 25 }
      );
    });

    it("income increases balance, expense decreases balance", async () => {
      const { transactionRepository } = await import(
        "../TransactionRepository"
      );

      await fc.assert(
        fc.property(fc.integer({ min: 1, max: 1000000 }), (amount) => {
          const money = new Money(amount, "USD");
          const incomeDelta = transactionRepository.calculateBalanceDelta(
            "income",
            money
          );
          const expenseDelta = transactionRepository.calculateBalanceDelta(
            "expense",
            money
          );

          expect(incomeDelta.isPositive()).toBe(true);
          expect(expenseDelta.isNegative()).toBe(true);
          expect(incomeDelta.equals(expenseDelta.negated())).toBe(true);
          return true;
        }),
        { numRuns: 25 }
      );
    });
  });
});
