import { describe, it, expect } from "vitest";
import {
  createTransactionSchema,
  summaryQuerySchema,
} from "../transactions.validation";

const UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("transactions.validation date existence checks", () => {
  it("rejects impossible calendar dates on create", () => {
    const result = createTransactionSchema.safeParse({
      accountId: UUID,
      amount: { amount: "10.00", currency: "USD" },
      type: "expense",
      date: "2025-02-30",
      description: "Impossible date",
      categoryId: UUID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes("Invalid date value"),
        ),
      ).toBe(true);
    }
  });

  it("rejects impossible calendar dates on summary queries", () => {
    const result = summaryQuerySchema.safeParse({
      startDate: "2025-02-30",
      endDate: "2025-03-01",
    });

    expect(result.success).toBe(false);
  });
});

describe("DATA-SPLIT-001: prevent double-counting of split transactions", () => {
  it("clears categoryId when splits are provided to prevent double-counting", () => {
    const result = createTransactionSchema.safeParse({
      accountId: UUID,
      amount: { amount: "100.00", currency: "USD" },
      type: "expense",
      date: "2025-01-15",
      description: "Split transaction",
      categoryId: UUID, // This should be cleared when splits are present
      splits: [
        {
          amount: { amount: "60.00", currency: "USD" },
          categoryId: UUID,
        },
        {
          amount: { amount: "40.00", currency: "USD" },
          categoryId: UUID,
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // categoryId should not be present in output when splits exist
      expect(result.data).not.toHaveProperty("categoryId");
      expect(result.data.splits).toHaveLength(2);
    }
  });

  it("preserves categoryId when no splits are provided", () => {
    const result = createTransactionSchema.safeParse({
      accountId: UUID,
      amount: { amount: "100.00", currency: "USD" },
      type: "expense",
      date: "2025-01-15",
      description: "Regular transaction",
      categoryId: UUID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // categoryId should be present when no splits
      expect(result.data.categoryId).toBe(UUID);
    }
  });
});

