/**
 * BudgetRow Unit Tests
 */

import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BudgetRow } from "../components/BudgetRow";
import type { BudgetCategory } from "../types";

// Mock the formatters context
vi.mock("@/contexts/SettingsContext", () => ({
  useFormatters: () => ({
    formatCurrency: (val: number) => `$${val.toFixed(2)}`,
  }),
}));

const mockIcon = () => <span data-testid="mock-icon">$</span>;

const createMockItem = (
  overrides: Partial<BudgetCategory> = {}
): BudgetCategory => ({
  id: "cat-1",
  name: "Groceries",
  icon: mockIcon,
  budget: 500,
  actual: 350,
  remaining: 150,
  ...overrides,
});

describe("BudgetRow", () => {
  const defaultProps = {
    item: createMockItem(),
    onUpdate: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders category name", () => {
    render(<BudgetRow {...defaultProps} />);
    expect(screen.getByDisplayValue("Groceries")).toBeInTheDocument();
  });

  it("renders budget amount in input", () => {
    render(<BudgetRow {...defaultProps} />);
    expect(screen.getByDisplayValue("500")).toBeInTheDocument();
  });

  it("renders actual amount", () => {
    render(<BudgetRow {...defaultProps} />);
    expect(screen.getByText("$350.00")).toBeInTheDocument();
  });

  it("renders remaining amount with positive styling", () => {
    render(<BudgetRow {...defaultProps} />);
    const remainingButton = screen.getByRole("button", {
      name: /move money.*\$150\.00/i,
    });
    expect(remainingButton).toHaveClass("bg-emerald-100");
  });

  it("renders remaining amount with negative styling when over budget", () => {
    const overBudgetItem = createMockItem({ remaining: -50 });
    render(<BudgetRow {...defaultProps} item={overBudgetItem} />);
    const remainingButton = screen.getByRole("button", {
      name: /move money.*\$-50\.00/i,
    });
    expect(remainingButton).toHaveClass("bg-rose-100");
  });

  it("calls onUpdate when name is changed", () => {
    const onUpdate = vi.fn();
    render(<BudgetRow {...defaultProps} onUpdate={onUpdate} />);

    const nameInput = screen.getByDisplayValue("Groceries");
    fireEvent.change(nameInput, { target: { value: "Food" } });

    expect(onUpdate).toHaveBeenCalledWith("cat-1", "name", "Food");
  });

  it("calls onUpdate when budget value is changed", () => {
    const onUpdate = vi.fn();
    render(<BudgetRow {...defaultProps} onUpdate={onUpdate} />);

    const budgetInput = screen.getByDisplayValue("500");
    fireEvent.change(budgetInput, { target: { value: "600" } });

    expect(onUpdate).toHaveBeenCalledWith("cat-1", "budget", 600);
  });

  it("calls onSelect when row is clicked", () => {
    const onSelect = vi.fn();
    render(
      <BudgetRow
        {...defaultProps}
        onSelect={onSelect}
        groupId="grp-1"
        groupName="Expenses"
      />
    );

    // Click on the row container
    const row = screen
      .getByDisplayValue("Groceries")
      .closest("div[class*='grid']");
    if (row) fireEvent.click(row);

    expect(onSelect).toHaveBeenCalledWith({
      groupId: "grp-1",
      itemId: "cat-1",
      item: defaultProps.item,
      groupName: "Expenses",
    });
  });

  it("calls onMoveMoney when remaining button is clicked", () => {
    const onMoveMoney = vi.fn();
    render(<BudgetRow {...defaultProps} onMoveMoney={onMoveMoney} />);

    const remainingButton = screen.getByRole("button", {
      name: /move money.*\$150\.00/i,
    });
    fireEvent.click(remainingButton);

    expect(onMoveMoney).toHaveBeenCalledWith(defaultProps.item);
  });

  it("hides budget input when isBudgetEditable is false", () => {
    render(<BudgetRow {...defaultProps} isBudgetEditable={false} />);
    expect(screen.queryByDisplayValue("500")).not.toBeInTheDocument();
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("calls onCommitBudget on blur", () => {
    const onCommitBudget = vi.fn();
    render(<BudgetRow {...defaultProps} onCommitBudget={onCommitBudget} />);

    const budgetInput = screen.getByDisplayValue("500");
    fireEvent.blur(budgetInput);

    expect(onCommitBudget).toHaveBeenCalledWith("cat-1", 500);
  });

  it("calls onCommitBudget on Enter key", () => {
    const onCommitBudget = vi.fn();
    render(<BudgetRow {...defaultProps} onCommitBudget={onCommitBudget} />);

    const budgetInput = screen.getByDisplayValue("500");
    fireEvent.keyDown(budgetInput, { key: "Enter" });

    expect(onCommitBudget).toHaveBeenCalledWith("cat-1", 500);
  });

  // C3-10: clearing the input sends nothing, so the screen must not keep
  // showing "Unbudgeted" while the server still holds the old limit.
  it("restores the saved budget when the input is cleared and left, and sends nothing", () => {
    const onCommitBudget = vi.fn();
    function Harness() {
      const [item, setItem] = useState(createMockItem());
      return (
        <BudgetRow
          item={item}
          onUpdate={(_id, field, value) => setItem(current => ({ ...current, [field]: value }))}
          onCommitBudget={onCommitBudget}
        />
      );
    }
    render(<Harness />);
    const budgetInput = screen.getByLabelText("Budget amount for Groceries");
    fireEvent.focus(budgetInput);
    fireEvent.change(budgetInput, { target: { value: "" } });
    expect(budgetInput).toHaveValue("");
    fireEvent.blur(budgetInput);

    expect(budgetInput).toHaveValue("500");
    expect(onCommitBudget).not.toHaveBeenCalled();
  });
});
