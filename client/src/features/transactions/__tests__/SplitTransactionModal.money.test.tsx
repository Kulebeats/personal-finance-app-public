/**
 * SCP-326 regression tests: client money paths must keep decimal precision.
 *
 * Covers two of the three paths the audit (§4) flagged for float antipatterns:
 *  1. SplitTransactionModal builds persisted split MoneyDto amounts.
 *  2. budgetGroupUtils.calculateBudgetTotals aggregates group totals.
 *
 * The classic float-drift probe (0.1 + 0.2 !== 0.3 in IEEE-754) is used to prove
 * the math now runs through Decimal-backed helpers (Money/sumMoneyDto/sumMoneyValues)
 * rather than parseFloat/Number/.toFixed.
 */

import { DollarSign } from "lucide-react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SplitTransactionModal } from "../components/SplitTransactionModal";
import type { TransactionWithDetails } from "../types";
import { calculateBudgetTotals } from "@/features/budget/hooks/budgetGroupUtils";
import type { BudgetGroup, BudgetCategory } from "@/features/budget/types";
import { multiplyMoneyDto, sumMoneyDto } from "@/lib/money";

// useCategories is a TanStack Query hook; stub it so the modal renders without a provider.
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    data: {
      categories: [
        { id: "cat-1", name: "Food", groupType: "Expenses" },
        { id: "cat-2", name: "Transport", groupType: "Expenses" },
      ],
    },
  }),
}));

const createTransaction = (
  amount: string
): TransactionWithDetails => ({
  id: "tx-1",
  householdId: "household-1",
  accountId: "account-1",
  date: "2024-01-15",
  name: "Groceries",
  amount: { amount, currency: "ZMW" },
  type: "expense",
  isPending: false,
  isRecurring: false,
  isExcludedFromReports: false,
  isExcludedFromBudget: false,
  isPrivate: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  categoryId: "cat-1",
  merchantName: "Market",
});

describe("SplitTransactionModal — persisted split amounts keep decimal precision", () => {
  it("submits a MoneyDto split amount of 0.1 with exact 2-decimal precision", () => {
    const onSubmit = vi.fn();
    // Total 0.30 with two 0.1/0.2 splits exercises the 0.1 + 0.2 float-drift probe:
    // allocated must equal 0.30 exactly for the modal to consider itself balanced.
    const transaction = createTransaction("0.30");

    render(
      <SplitTransactionModal
        open
        onOpenChange={() => {}}
        transaction={transaction}
        onSubmit={onSubmit}
      />
    );

    const amountInputs = screen
      .getAllByPlaceholderText("0.00")
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    expect(amountInputs.length).toBeGreaterThanOrEqual(2);

    // The two splits start empty (controlled-open render skips the half-seed). Type
    // 0.1 and 0.2; if balance math used floats, 0.1 + 0.2 = 0.30000000000000004 and
    // the modal would never become balanced, so onSubmit would never fire.
    fireEvent.change(amountInputs[0], { target: { value: "0.1" } });
    fireEvent.change(amountInputs[1], { target: { value: "0.2" } });

    // Assign a category to split 1 so it is persisted (split 2 stays uncategorised).
    const triggers = screen.getAllByRole("combobox");
    fireEvent.click(triggers[0]);
    fireEvent.click(screen.getByRole("option", { name: "Food" }));

    const saveButton = screen.getByRole("button", { name: /save splits/i });
    // Button is only enabled when balanced -> proves Decimal balance math
    // (0.1 + 0.2 === 0.30 exactly, not 0.30000000000000004).
    expect(saveButton).not.toBeDisabled();
    fireEvent.click(saveButton);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const splits = onSubmit.mock.calls[0][0] as Array<{
      amount: { amount: string; currency: string };
      categoryId: string;
    }>;

    // The categorised split is persisted as a clean 2dp MoneyDto, no float tail.
    const persisted = splits.find((s) => s.categoryId === "cat-1");
    expect(persisted).toBeDefined();
    expect(persisted!.amount).toEqual({ amount: "0.10", currency: "ZMW" });
  });
});

describe("split-amount build helpers keep decimal precision", () => {
  it("halves a MoneyDto to an exact 2-decimal string (seed default path)", () => {
    // Half of 100.05 = 50.025 -> rounds to 50.03 (2dp), no float artifact.
    expect(multiplyMoneyDto({ amount: "100.05", currency: "ZMW" }, 0.5)).toEqual(
      { amount: "50.03", currency: "ZMW" }
    );
  });

  it("sums split MoneyDto amounts 0.1 + 0.2 to exactly 0.30", () => {
    const total = sumMoneyDto(
      [
        { amount: "0.10", currency: "ZMW" },
        { amount: "0.20", currency: "ZMW" },
      ],
      "ZMW"
    );
    expect(total).toEqual({ amount: "0.30", currency: "ZMW" });
  });
});

describe("calculateBudgetTotals — group aggregation keeps decimal precision", () => {
  const makeItem = (
    id: string,
    budget: number,
    actual: number
  ): BudgetCategory => ({
    id,
    name: id,
    icon: DollarSign,
    budget,
    actual,
    remaining: budget - actual,
  });

  it("sums 0.1 + 0.2 budget items to exactly 0.3 (no float drift)", () => {
    const groups: BudgetGroup[] = [
      {
        id: "g1",
        name: "Flexible",
        type: "expense",
        items: [makeItem("a", 0.1, 0), makeItem("b", 0.2, 0)],
      },
    ];

    const totals = calculateBudgetTotals(groups);

    // Float reduce would yield 0.30000000000000004; the Decimal path yields exactly 0.3.
    expect(totals.totalExpenseBudget).toBe(0.3);
  });

  it("computes remaining via Decimal subtraction without float tails", () => {
    const groups: BudgetGroup[] = [
      {
        id: "income",
        name: "Income",
        type: "income",
        items: [makeItem("salary", 0.3, 0.1)],
      },
      {
        id: "exp",
        name: "Expenses",
        type: "expense",
        items: [makeItem("food", 0.2, 0.1)],
      },
    ];

    const totals = calculateBudgetTotals(groups);

    expect(totals.totalIncomeBudget).toBe(0.3);
    expect(totals.totalIncomeActual).toBe(0.1);
    expect(totals.incomeRemaining).toBe(0.2);
    expect(totals.totalExpenseBudget).toBe(0.2);
    // leftToBudget = totalIncomeActual - totalExpenseActual = 0.1 - 0.1 = 0
    expect(totals.leftToBudget).toBe(0);
  });
});
