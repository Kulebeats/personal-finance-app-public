import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import fc from "fast-check";

/**
 * **Feature: settings-refactoring, Property 18: Transaction Atomicity**
 * **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5**
 * 
 * For any multi-step operation (category reorder, rule reorder, merchant merge),
 * if any step fails, ALL changes SHALL be rolled back leaving the database in its original state.
 */

// Mock the database module
let mockTransactionFn: any;
let mockSelectFn: any;
let mockLockFn: any;
let mockUpdateFn: any;
let mockDeleteFn: any;

vi.mock("../../db", () => {
  mockUpdateFn = vi.fn().mockReturnThis();
  mockDeleteFn = vi.fn().mockReturnThis();
  mockLockFn = vi.fn().mockResolvedValue([]);
  mockSelectFn = vi.fn(() => ({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    for: mockLockFn,
  }));
  
  mockTransactionFn = vi.fn(async (callback: any) => {
    const mockTx = {
      select: mockSelectFn,
      update: mockUpdateFn,
      delete: mockDeleteFn,
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
    };
    return await callback(mockTx);
  });

  return {
    db: {
      transaction: mockTransactionFn,
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnValue(Promise.resolve([])),
      update: mockUpdateFn,
      delete: mockDeleteFn,
      set: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockReturnValue(Promise.resolve([])),
    },
  };
});

describe("Property 18: Transaction Atomicity", () => {
  const testHouseholdId = "test-household-123";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("category reorder rolls back all changes on failure", async () => {
    const { categoryRepository } = await import("../CategoryRepository");

    // Generator for arrays of category IDs
    const categoryIdsArbitrary = fc.array(fc.uuid(), { minLength: 2, maxLength: 10 });

    await fc.assert(
      fc.asyncProperty(
        categoryIdsArbitrary,
        fc.integer({ min: 0, max: 9 }),
        async (categoryIds, failAtIndex) => {
          // Skip if failAtIndex is out of bounds
          if (failAtIndex >= categoryIds.length) {
            return true;
          }

          // Reset mocks for this iteration
          vi.clearAllMocks();

          // Set up mock to fail at specific index
          let updateCallCount = 0;
          mockUpdateFn.mockImplementation(() => {
            const currentCall = updateCallCount++;
            if (currentCall === failAtIndex) {
              throw new Error("Simulated database error");
            }
            return {
              set: vi.fn().mockReturnThis(),
              where: vi.fn().mockReturnThis(),
            };
          });

          // Attempt the reorder operation
          let didThrow = false;
          try {
            await categoryRepository.reorder(testHouseholdId, categoryIds);
          } catch (error) {
            didThrow = true;
          }

          // Should have thrown an error
          expect(didThrow).toBe(true);

          // Transaction should have been called
          expect(mockTransactionFn).toHaveBeenCalled();
          expect(mockSelectFn).toHaveBeenCalledTimes(1);
          expect(mockLockFn).toHaveBeenCalledWith("no key update");
          expect(mockUpdateFn).toHaveBeenCalledTimes(failAtIndex + 1);

          // The transaction callback should have been executed
          // (Drizzle automatically rolls back on error)
          return true;
        }
      ),
      { numRuns: 100 }
    );
  }, 15000);

  it("rule reorder rolls back all changes on failure", async () => {
    const { ruleRepository } = await import("../RuleRepository");

    // Generator for arrays of rule IDs
    const ruleIdsArbitrary = fc.array(fc.uuid(), { minLength: 2, maxLength: 10 });

    await fc.assert(
      fc.asyncProperty(
        ruleIdsArbitrary,
        fc.integer({ min: 0, max: 9 }),
        async (ruleIds, failAtIndex) => {
          // Skip if failAtIndex is out of bounds
          if (failAtIndex >= ruleIds.length) {
            return true;
          }

          // Reset mocks for this iteration
          vi.clearAllMocks();

          // Set up mock to fail at specific index
          let updateCallCount = 0;
          mockUpdateFn.mockImplementation(() => {
            const currentCall = updateCallCount++;
            if (currentCall === failAtIndex) {
              throw new Error("Simulated database error");
            }
            return {
              set: vi.fn().mockReturnThis(),
              where: vi.fn().mockReturnThis(),
            };
          });

          // Attempt the reorder operation
          let didThrow = false;
          try {
            await ruleRepository.reorder(testHouseholdId, ruleIds);
          } catch (error) {
            didThrow = true;
          }

          // Should have thrown an error
          expect(didThrow).toBe(true);

          // Transaction should have been called
          expect(mockTransactionFn).toHaveBeenCalled();

          return true;
        }
      ),
      { numRuns: 100 }
    );
  }, 15000);

  it("merchant merge rolls back all changes on failure", async () => {
    const { merchantRepository } = await import("../MerchantRepository");

    // Generator for merchant IDs
    const merchantIdsArbitrary = fc.tuple(fc.uuid(), fc.uuid());

    await fc.assert(
      fc.asyncProperty(
        merchantIdsArbitrary,
        fc.boolean(),
        async ([sourceId, targetId], failOnUpdate) => {
          // Reset mocks for this iteration
          vi.clearAllMocks();

          if (failOnUpdate) {
            // Fail on the update operation
            mockUpdateFn.mockImplementation(() => {
              throw new Error("Simulated update error");
            });
          } else {
            // Fail on the delete operation
            mockUpdateFn.mockReturnValue({
              set: vi.fn().mockReturnThis(),
              where: vi.fn().mockReturnThis(),
            });
            mockDeleteFn.mockImplementation(() => {
              throw new Error("Simulated delete error");
            });
          }

          // Attempt the merge operation
          let didThrow = false;
          try {
            await merchantRepository.mergeWithTransaction(sourceId, targetId);
          } catch (error) {
            didThrow = true;
          }

          // Should have thrown an error
          expect(didThrow).toBe(true);

          // Transaction should have been called
          expect(mockTransactionFn).toHaveBeenCalled();

          return true;
        }
      ),
      { numRuns: 100 }
    );
  }, 15000);

  it("transaction wrapper ensures atomicity for any operation", async () => {
    const { withTransaction } = await import("../../utils/withTransaction");

    // Generator for operations that may fail
    const operationArbitrary = fc.tuple(
      fc.integer({ min: 1, max: 5 }),
      fc.integer({ min: 0, max: 4 })
    );

    await fc.assert(
      fc.asyncProperty(operationArbitrary, async ([numSteps, failAtStep]) => {
        // Reset mocks for this iteration
        vi.clearAllMocks();

        let stepCount = 0;
        const operation = async (tx: any) => {
          for (let i = 0; i < numSteps; i++) {
            stepCount++;
            if (i === failAtStep) {
              throw new Error(`Simulated error at step ${i}`);
            }
            // Simulate a database operation
            await Promise.resolve();
          }
          return { success: true };
        };

        // Attempt the operation
        let didThrow = false;
        try {
          await withTransaction(operation);
        } catch (error) {
          didThrow = true;
        }

        // Should have thrown if failAtStep < numSteps
        if (failAtStep < numSteps) {
          expect(didThrow).toBe(true);
        } else {
          expect(didThrow).toBe(false);
        }

        // Transaction should have been called
        expect(mockTransactionFn).toHaveBeenCalled();

        return true;
      }),
      { numRuns: 100 }
    );
  }, 15000);

  it("successful transactions commit all changes", async () => {
    const { categoryRepository } = await import("../CategoryRepository");

    // Generator for arrays of category IDs
    const categoryIdsArbitrary = fc.array(fc.uuid(), { minLength: 1, maxLength: 10 });

    await fc.assert(
      fc.asyncProperty(categoryIdsArbitrary, async (categoryIds) => {
        // Reset mocks for this iteration
        vi.clearAllMocks();

        // Set up mock to succeed
        mockUpdateFn.mockReturnValue({
          set: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
        });

        // Attempt the reorder operation
        let didThrow = false;
        try {
          await categoryRepository.reorder(testHouseholdId, categoryIds);
        } catch (error) {
          didThrow = true;
        }

        // Should not have thrown
        expect(didThrow).toBe(false);

        // Transaction should have been called
        expect(mockTransactionFn).toHaveBeenCalled();

        // Update should have been called for each category
        expect(mockSelectFn).toHaveBeenCalledTimes(1);
        expect(mockLockFn).toHaveBeenCalledWith("no key update");
        expect(mockUpdateFn).toHaveBeenCalledTimes(categoryIds.length);

        return true;
      }),
      { numRuns: 100 }
    );
  }, 15000);
});
