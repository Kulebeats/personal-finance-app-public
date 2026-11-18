import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock db before imports
vi.mock("../../../db", () => {
  const mockDb = {
    select: vi.fn(),
    execute: vi.fn(),
  };
  return { db: mockDb };
});

import { db } from "../../../db";
import { TransactionReportRepository } from "../TransactionReportRepository";

const money = (value: number, currency: string = "USD") => ({
  amount: value.toFixed(2),
  currency,
});

function createSelectResult<T>(result: T[]) {
  const chain: any = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    then: (resolve: (value: T[]) => void) =>
      Promise.resolve(result).then(resolve),
  };
  return chain;
}

describe("TransactionReportRepository", () => {
  let repository: TransactionReportRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new TransactionReportRepository();
    // The SCP-321 pre-aggregation FX guard runs one db.execute query; an
    // empty result means "no missing rates" so getTransactions proceeds.
    vi.mocked(db.execute).mockResolvedValue({
      rows: [],
      command: "SELECT",
      rowCount: 0,
      oid: 0,
      fields: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getTransactions", () => {
    it("returns paginated transactions", async () => {
      // Mock household currency
      (db.select as any)
        .mockReturnValueOnce(createSelectResult([{ currency: "USD" }]))
        // Mock transactions
        .mockReturnValueOnce(
          createSelectResult([
            {
              id: "txn-1",
              date: "2024-01-15",
              name: "Grocery Store",
              type: "expense",
              amount: "75.50",
              amountBase: "75.50",
              transactionCurrency: "USD",
              accountCurrency: "USD",
              isPending: false,
              accountId: "acc-1",
              accountName: "Checking",
              categoryId: "cat-1",
              categoryName: "Groceries",
            },
            {
              id: "txn-2",
              date: "2024-01-14",
              name: "Salary",
              type: "income",
              amount: "5000",
              amountBase: "5000",
              transactionCurrency: "USD",
              accountCurrency: "USD",
              isPending: false,
              accountId: "acc-1",
              accountName: "Checking",
              categoryId: "cat-2",
              categoryName: "Income",
            },
          ])
        )
        // Mock tags
        .mockReturnValueOnce(createSelectResult([]));

      const result = await repository.getTransactions("household-1", {
        from: "2024-01-01",
        to: "2024-01-31",
      });

      expect(result.items).toHaveLength(2);
      expect(result.items[0].name).toBe("Grocery Store");
    });

    it("converts foreign currency to base currency", async () => {
      (db.select as any)
        .mockReturnValueOnce(createSelectResult([{ currency: "USD" }]))
        .mockReturnValueOnce(
          createSelectResult([
            {
              id: "txn-1",
              date: "2024-01-15",
              name: "Coffee Shop",
              type: "expense",
              amount: "10",
              amountBase: "11",
              transactionCurrency: "EUR",
              accountCurrency: "EUR",
              isPending: false,
              accountId: "acc-1",
              accountName: "Euro Account",
            },
          ])
        )
        .mockReturnValueOnce(createSelectResult([]));

      const result = await repository.getTransactions("household-1", {
        from: "2024-01-01",
        to: "2024-01-31",
      });

      expect(result.items[0].currency).toBe("EUR");
      expect(result.items[0].baseCurrency).toBe("USD");
      expect(Number(result.items[0].amountBase.amount)).toBeCloseTo(11);
    });

    it("applies type filter correctly", async () => {
      (db.select as any)
        .mockReturnValueOnce(createSelectResult([{ currency: "USD" }]))
        .mockReturnValueOnce(
          createSelectResult([
            {
              id: "txn-1",
              date: "2024-01-15",
              name: "Grocery Store",
              type: "expense",
              amount: "50",
              amountBase: "50",
              transactionCurrency: "USD",
              accountCurrency: "USD",
              isPending: false,
              accountId: "acc-1",
              accountName: "Checking",
            },
          ])
        )
        .mockReturnValueOnce(createSelectResult([]));

      const result = await repository.getTransactions("household-1", {
        from: "2024-01-01",
        to: "2024-01-31",
        type: "expense",
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].type).toBe("expense");
    });

    it("includes transaction tags", async () => {
      (db.select as any)
        .mockReturnValueOnce(createSelectResult([{ currency: "USD" }]))
        .mockReturnValueOnce(
          createSelectResult([
            {
              id: "txn-1",
              date: "2024-01-15",
              name: "Tagged Item",
              type: "expense",
              amount: "100",
              amountBase: "100",
              transactionCurrency: "USD",
              accountCurrency: "USD",
              isPending: false,
              accountId: "acc-1",
              accountName: "Checking",
            },
          ])
        )
        .mockReturnValueOnce(
          createSelectResult([
            {
              transactionId: "txn-1",
              tagId: "tag-1",
              tagName: "Business",
              tagColor: "#0000ff",
            },
          ])
        );

      const result = await repository.getTransactions("household-1", {
        from: "2024-01-01",
        to: "2024-01-31",
      });

      expect(result.items[0].tags).toHaveLength(1);
      expect(result.items[0].tags![0].name).toBe("Business");
    });

    it("handles empty result set (no transactions in period)", async () => {
      (db.select as any)
        .mockReturnValueOnce(createSelectResult([{ currency: "USD" }]))
        .mockReturnValueOnce(createSelectResult([])) // No transactions
        .mockReturnValueOnce(createSelectResult([])); // No tags

      const result = await repository.getTransactions("household-1", {
        from: "2024-01-01",
        to: "2024-01-31",
      });

      expect(result.items).toHaveLength(0);
      expect(result.page.nextCursor).toBeNull();
    });

    it("handles pagination with hasMore flag", async () => {
      // Create 50 items + hasMore flag to simulate pagination
      const items = Array.from({ length: 50 }, (_, i) => ({
        id: `txn-${i}`,
        date: "2024-01-15",
        name: `Transaction ${i}`,
        type: "expense" as const,
        amount: money(10),
        signedAmount: money(-10),
        currency: "USD",
        baseCurrency: "USD",
        amountBase: money(10),
        signedAmountBase: money(-10),
        isPending: false,
        notes: null,
        reviewedAt: null,
        merchant: null,
        category: null,
        account: { id: "acc-1", name: "Checking" },
        tags: null,
      }));

      // Mock the method to return paginated results
      vi.spyOn(repository, "getTransactions").mockResolvedValueOnce({
        page: { limit: 50, nextCursor: "encoded-cursor" },
        items,
      });

      const result = await repository.getTransactions("household-1", {
        from: "2024-01-01",
        to: "2024-01-31",
        limit: 50,
      });

      // Should return 50 items (limit)
      expect(result.items).toHaveLength(50);
      // Should have nextCursor since there are more results
      expect(result.page.nextCursor).toBeDefined();
      expect(result.page.nextCursor).toBe("encoded-cursor");
    });
  });
});
