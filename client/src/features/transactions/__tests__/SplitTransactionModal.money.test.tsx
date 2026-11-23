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
  it("submits both exact cent allocations, including the uncategorized row", () => {
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

    // Change the two allocations to decimal values that drift in binary floating point.
    fireEvent.change(amountInputs[0], { target: { value: "0.1" } });
    fireEvent.change(amountInputs[1], { target: { value: "0.2" } });

    // Select one category; the second allocation must survive without a category.
    const triggers = screen.getAllByRole("combobox");
    fireEvent.click(triggers[0]);
    fireEvent.click(screen.getByRole("option", { name: "Food" }));

    const saveButton = screen.getByRole("button", { name: /save splits/i });
    // Button is only enabled when balanced -> proves Decimal balance math
    // (0.1 + 0.2 === 0.30 exactly, not 0.30000000000000004).
    expect(saveButton).not.toBeDisabled();
    fireEvent.click(saveButton);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith([
      { amount: { amount: "0.10", currency: "ZMW" }, categoryId: "cat-1", notes: undefined, displayOrder: 0 },
      { amount: { amount: "0.20", currency: "ZMW" }, categoryId: null, notes: undefined, displayOrder: 1 },
    ], transaction.updatedAt);
  });

  it.each([
    ["empty row", "", "0.30"],
    ["zero row", "0.00", "0.30"],
    ["negative row masking over-allocation", "-0.10", "0.40"],
    ["sub-cent row", "0.001", "0.299"],
    ["rounded allocations hiding an imbalance", "0.105", "0.195"],
    ["less-than-a-cent remainder", "0.10", "0.199"],
    ["scientific notation", "1e-1", "0.20"],
  ])("rejects %s without submitting partial rows", (_label, first, second) => {
    const onSubmit = vi.fn();
    render(<SplitTransactionModal open onOpenChange={() => {}} transaction={createTransaction("0.30")} onSubmit={onSubmit} />);
    const amounts = screen.getAllByPlaceholderText("0.00");
    fireEvent.change(amounts[0], { target: { value: first } });
    fireEvent.change(amounts[1], { target: { value: second } });
    const save = screen.getByRole("button", { name: /save splits/i });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not reinterpret a negative parent amount as positive allocations", () => {
    const onSubmit = vi.fn();
    render(<SplitTransactionModal open onOpenChange={() => {}} transaction={createTransaction("-0.30")} onSubmit={onSubmit} />);
    const amounts = screen.getAllByPlaceholderText("0.00");
    fireEvent.change(amounts[0], { target: { value: "0.10" } });
    fireEvent.change(amounts[1], { target: { value: "0.20" } });
    expect(screen.getByRole("button", { name: /save splits/i })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps saved child fields and the opening version together, then resets on reopen", () => {
    const onSubmit = vi.fn();
    const original = { ...createTransaction("0.30"), updatedAt: "2026-11-01T13:00:00.000Z",
      splits: [
        { id: "a", amount: { amount: "0.10", currency: "ZMW" }, categoryId: "cat-1", merchantId: "m", displayOrder: 7, notes: "First" },
        { id: "b", amount: { amount: "0.20", currency: "ZMW" }, categoryId: null, displayOrder: 9 },
      ] };
    const modal = (transaction: TransactionWithDetails, open = true) =>
      <SplitTransactionModal open={open} transaction={transaction} onOpenChange={vi.fn()} onSubmit={onSubmit} />;
    const view = render(modal(original));
    const notes = () => screen.getAllByPlaceholderText("Add a note...");
    expect(notes()[0]).toHaveValue("First");
    fireEvent.change(notes()[0], { target: { value: "Local draft" } });
    const latest = { ...original, updatedAt: "2026-11-01T13:01:00.000Z" };
    view.rerender(modal(latest));
    fireEvent.click(screen.getByRole("button", { name: /save splits/i }));
    expect(onSubmit).toHaveBeenCalledWith([
      expect.objectContaining({ merchantId: "m", displayOrder: 7, notes: "Local draft" }),
      expect.objectContaining({ categoryId: null, displayOrder: 9 }),
    ], original.updatedAt);
    view.rerender(modal(latest, false));
    view.rerender(modal(latest));
    expect(notes()[0]).toHaveValue("First");
    view.rerender(modal({ ...latest, id: "another", splits: [] }));
    expect(notes()[0]).toHaveValue("");
  });

  it("disables editing amounts with an unresolved historical denomination", () => {
    render(<SplitTransactionModal open onOpenChange={vi.fn()} onSubmit={vi.fn()}
      transaction={{ ...createTransaction("0.30"), currency: null }} />);
    expect(screen.getByText(/reconcile the transaction currency/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /save splits/i })).toBeDisabled();
  });

  it.each([[0, 0, false], [7, 9, true]] as const)("keeps displayed order for saved ordinals %s,%s with append=%s", (first, second, append) => {
    const onSubmit = vi.fn(), transaction = { ...createTransaction("0.30"), splits: [
      { id: "first", displayOrder: first, amount: { amount: "0.10", currency: "ZMW" } },
      { id: "second", displayOrder: second, amount: { amount: "0.20", currency: "ZMW" } },
    ] };
    render(<SplitTransactionModal open onOpenChange={vi.fn()} transaction={transaction} onSubmit={onSubmit} />);
    if (append) {
      fireEvent.click(screen.getByRole("button", { name: "Add Split" }));
      const amounts = screen.getAllByRole("spinbutton");
      fireEvent.change(amounts[1], { target: { value: "0.15" } });
      fireEvent.change(amounts[2], { target: { value: "0.05" } });
    }
    fireEvent.click(screen.getByRole("button", { name: /save splits/i }));
    expect(onSubmit.mock.calls[0][0].map((s: { displayOrder: number }) => s.displayOrder)).toEqual(append ? [0, 1, 2] : [0, 1]);
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
