import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SummaryCards } from "../components/SummaryCards";
import { INCOME_COLOR, EXPENSE_COLOR } from "../utils/chartTheme";

const money = (value: number, currency: string = "USD") => ({
  amount: value.toFixed(2),
  currency,
});

const totals = (income: number, expenses: number, savings: number, savingsRate: number, currency = "USD") => ({
  income: money(income, currency),
  expenses: money(expenses, currency),
  savings: money(savings, currency),
  savingsRate,
});

describe("SummaryCards", () => {
  const defaultTotals = totals(5000, 3500, 1500, 30);

  it("should render all four summary cards", () => {
    render(<SummaryCards totals={defaultTotals} />);

    expect(screen.getByText("Total Income")).toBeDefined();
    expect(screen.getByText("Total Expenses")).toBeDefined();
    expect(screen.getByText("Total Net Income")).toBeDefined();
    expect(screen.getByText("Savings Rate")).toBeDefined();
  });

  it("should format income correctly", () => {
    render(<SummaryCards totals={defaultTotals} />);
    expect(screen.getByText("US$5,000.00")).toBeDefined();
  });

  it("should format expenses correctly", () => {
    render(<SummaryCards totals={defaultTotals} />);
    expect(screen.getByText("US$3,500.00")).toBeDefined();
  });

  it("should format savings correctly", () => {
    render(<SummaryCards totals={defaultTotals} />);
    expect(screen.getByText("US$1,500.00")).toBeDefined();
  });

  it("shows a 42.50 kwacha expense to the ngwee, never rounded to a whole kwacha", () => {
    render(<SummaryCards totals={{ ...totals(0, 0, 0, 0, "ZMW"), expenses: { amount: "42.50", currency: "ZMW" } }} />);
    expect(screen.getByText(/^K\s42\.50$/)).toBeDefined();
    expect(screen.queryByText(/43/)).toBeNull();
  });

  it("shows each amount in its own currency, to that currency's minor units", () => {
    render(<SummaryCards totals={{ ...totals(0, 0, 0, 0, "ZMW"), expenses: { amount: "4250", currency: "JPY" } }} />);
    expect(screen.getByText("JP¥4,250")).toBeDefined();
  });

  it("shows no amount and no guessed currency while the totals are unknown", () => {
    const { container } = render(<SummaryCards totals={null} />);
    expect(screen.getAllByText("—")).toHaveLength(4);
    expect(container.textContent).not.toMatch(/\$|US|K\s?0/);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
  });

  it("should format savings rate as percentage", () => {
    render(<SummaryCards totals={defaultTotals} />);
    expect(screen.getByText("30.0%")).toBeDefined();
  });

  it("should use correct colors for income (green) and expenses (red)", () => {
    render(<SummaryCards totals={defaultTotals} />);

    // Income value is rendered with the income (emerald) theme color
    const incomeValue = screen.getByText("US$5,000.00");
    expect(incomeValue.style.color).toBe(INCOME_COLOR);

    // Expense value is rendered with the expense (rose) theme color
    const expenseValue = screen.getByText("US$3,500.00");
    expect(expenseValue.style.color).toBe(EXPENSE_COLOR);
  });

  it("should handle zero values", () => {
    render(<SummaryCards totals={totals(0, 0, 0, 0)} />);

    expect(screen.getAllByText("US$0.00").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("0.0%")).toBeDefined();
  });

  it("should handle large numbers", () => {
    render(<SummaryCards totals={totals(1234567, 987654, 246913, 20)} />);

    expect(screen.getByText("US$1,234,567.00")).toBeDefined();
    expect(screen.getByText("US$987,654.00")).toBeDefined();
  });
});
