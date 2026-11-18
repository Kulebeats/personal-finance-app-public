import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SummaryCards } from "../components/SummaryCards";
import { INCOME_COLOR, EXPENSE_COLOR } from "../utils/chartTheme";

const money = (value: number, currency: string = "USD") => ({
  amount: value.toFixed(2),
  currency,
});

describe("SummaryCards", () => {
  const defaultProps = {
    income: money(5000),
    expenses: money(3500),
    savings: money(1500),
    savingsRate: 30,
    currency: "USD",
  };

  it("should render all four summary cards", () => {
    render(<SummaryCards {...defaultProps} />);

    expect(screen.getByText("Total Income")).toBeDefined();
    expect(screen.getByText("Total Expenses")).toBeDefined();
    expect(screen.getByText("Total Net Income")).toBeDefined();
    expect(screen.getByText("Savings Rate")).toBeDefined();
  });

  it("should format income correctly", () => {
    render(<SummaryCards {...defaultProps} />);
    expect(screen.getByText("$5,000")).toBeDefined();
  });

  it("should format expenses correctly", () => {
    render(<SummaryCards {...defaultProps} />);
    expect(screen.getByText("$3,500")).toBeDefined();
  });

  it("should format savings correctly", () => {
    render(<SummaryCards {...defaultProps} />);
    expect(screen.getByText("$1,500")).toBeDefined();
  });

  it("should format savings rate as percentage", () => {
    render(<SummaryCards {...defaultProps} />);
    expect(screen.getByText("30.0%")).toBeDefined();
  });

  it("should use correct colors for income (green) and expenses (red)", () => {
    render(<SummaryCards {...defaultProps} />);

    // Income value is rendered with the income (emerald) theme color
    const incomeValue = screen.getByText("$5,000");
    expect(incomeValue.style.color).toBe(INCOME_COLOR);

    // Expense value is rendered with the expense (rose) theme color
    const expenseValue = screen.getByText("$3,500");
    expect(expenseValue.style.color).toBe(EXPENSE_COLOR);
  });

  it("should handle zero values", () => {
    render(
      <SummaryCards
        income={money(0)}
        expenses={money(0)}
        savings={money(0)}
        savingsRate={0}
        currency="USD"
      />
    );

    expect(screen.getAllByText("$0").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("0.0%")).toBeDefined();
  });

  it("should handle large numbers", () => {
    render(
      <SummaryCards
        income={money(1234567)}
        expenses={money(987654)}
        savings={money(246913)}
        savingsRate={20}
        currency="USD"
      />
    );

    expect(screen.getByText("$1,234,567")).toBeDefined();
    expect(screen.getByText("$987,654")).toBeDefined();
  });
});
