import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AnnualSummaryWidget from "../AnnualSummaryWidget";
import * as hooks from "@/hooks/use-reports";

const money = (value: number, currency: string = "USD") => ({
  amount: value.toFixed(2),
  currency,
});

// Mock the hooks
vi.mock("@/hooks/use-reports", () => ({
  useReportsAnnual: vi.fn(),
  useCurrentYearRange: vi.fn(() => ({ year: 2026 })),
}));

// Mock context
vi.mock("@/contexts/SettingsContext", () => ({
  useFormatters: () => ({
    formatCurrency: (val: number) => `$${val.toFixed(2)}`,
  }),
}));

describe("AnnualSummaryWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render loading state", () => {
    (hooks.useReportsAnnual as any).mockReturnValue({
      data: null,
      isLoading: true,
    });

    render(<AnnualSummaryWidget />);

    // Should show loading spinners
    const loaders = document.querySelectorAll(".animate-spin");
    expect(loaders.length).toBeGreaterThan(0);
  });

  it("should render all 5 summary cards", () => {
    (hooks.useReportsAnnual as any).mockReturnValue({
      data: {
        totals: {
          income: money(100000),
          expenses: money(60000),
          savingsContributions: money(20000),
          netSavings: money(20000),
          debtPaid: money(15000),
          netWorth: money(250000),
          savingsRate: 20,
          netSavingsRate: 20,
          totalNetWorthChange: money(50000),
          avgMonthlyNetWorthChange: money(4166.67),
        },
        comparison: {
          incomeChangePct: 10,
          expensesChangePct: -5,
          savingsContributionsChangePct: 15,
          debtPaidChangePct: 8,
          netWorthChangePct: 12,
        },
        monthsInRange: 12,
      },
      isLoading: false,
    });

    render(<AnnualSummaryWidget />);

    // Check all 5 card titles are present
    expect(screen.getByText("Total Income")).toBeDefined();
    expect(screen.getByText("Total Expenses")).toBeDefined();
    expect(screen.getByText("Savings")).toBeDefined();
    expect(screen.getByText("Debt Paid")).toBeDefined();
    expect(screen.getByText("Net Worth")).toBeDefined();
  });

  it("should display formatted currency values", () => {
    (hooks.useReportsAnnual as any).mockReturnValue({
      data: {
        totals: {
          income: money(100000),
          expenses: money(60000),
          savingsContributions: money(20000),
          netSavings: money(20000),
          debtPaid: money(15000),
          netWorth: money(250000),
          savingsRate: 20,
          netSavingsRate: 20,
          totalNetWorthChange: money(50000),
          avgMonthlyNetWorthChange: money(4166.67),
        },
        monthsInRange: 12,
      },
      isLoading: false,
    });

    render(<AnnualSummaryWidget />);

    // Check formatted values appear
    expect(screen.getByText("$100000.00")).toBeDefined();
    expect(screen.getByText("$60000.00")).toBeDefined();
    expect(screen.getByText("$250000.00")).toBeDefined();
  });

  it("should use monthsInRange for average calculations", () => {
    (hooks.useReportsAnnual as any).mockReturnValue({
      data: {
        totals: {
          income: money(60000), // 60000 / 6 = 10000
          expenses: money(30000),
          savingsContributions: money(12000),
          netSavings: money(18000),
          debtPaid: money(6000),
          netWorth: money(200000),
          savingsRate: 20,
          netSavingsRate: 30,
          totalNetWorthChange: money(30000),
          avgMonthlyNetWorthChange: money(5000),
        },
        monthsInRange: 6, // Only 6 months
      },
      isLoading: false,
    });

    render(<AnnualSummaryWidget />);

    // Check that averages use monthsInRange (6) not hardcoded 12
    // 60000 / 6 = 10000
    expect(screen.getByText(/\$10000\.00/)).toBeDefined();
  });

  it("should show YoY comparison percentages with trend icons", () => {
    (hooks.useReportsAnnual as any).mockReturnValue({
      data: {
        totals: {
          income: money(100000),
          expenses: money(60000),
          savingsContributions: money(20000),
          netSavings: money(20000),
          debtPaid: money(15000),
          netWorth: money(250000),
          savingsRate: 20,
          netSavingsRate: 20,
          totalNetWorthChange: money(50000),
          avgMonthlyNetWorthChange: money(4166.67),
        },
        comparison: {
          incomeChangePct: 10.5,
          expensesChangePct: -5.2,
          savingsContributionsChangePct: 15,
          debtPaidChangePct: 8,
          netWorthChangePct: 12,
        },
        monthsInRange: 12,
      },
      isLoading: false,
    });

    render(<AnnualSummaryWidget />);

    // Check for percentage display
    expect(screen.getByText("+10.5%")).toBeDefined();
    expect(screen.getByText("-5.2%")).toBeDefined();
  });

  it("should render 5-column grid on large screens", () => {
    (hooks.useReportsAnnual as any).mockReturnValue({
      data: {
        totals: {
          income: money(100000),
          expenses: money(60000),
          savingsContributions: money(20000),
          netSavings: money(20000),
          debtPaid: money(15000),
          netWorth: money(250000),
          savingsRate: 20,
          netSavingsRate: 20,
          totalNetWorthChange: money(50000),
          avgMonthlyNetWorthChange: money(4166.67),
        },
        monthsInRange: 12,
      },
      isLoading: false,
    });

    const { container } = render(<AnnualSummaryWidget />);

    // Check grid classes for responsive 5-column layout
    const grid = container.querySelector(".grid");
    expect(grid?.classList.contains("lg:grid-cols-5")).toBe(true);
  });
});
