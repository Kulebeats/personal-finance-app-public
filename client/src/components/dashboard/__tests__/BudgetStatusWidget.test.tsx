import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import BudgetStatusWidget from "../BudgetStatusWidget";
import { useCurrentMonthBudgets } from "@/hooks/useBudgets";

// Mock the hooks
vi.mock("@/hooks/useBudgets", () => ({
  useCurrentMonthBudgets: vi.fn(),
}));

vi.mock("@/contexts/SettingsContext", () => ({
  useFormatters: () => ({
    formatCurrency: (val: number) => `$${val.toLocaleString()}`,
  }),
}));

const mockedUseCurrentMonthBudgets = vi.mocked(useCurrentMonthBudgets);

const createWrapper = () => {
  return ({ children }: { children: React.ReactNode }) => <>{children}</>;
};

describe("BudgetStatusWidget", () => {
  it("renders a link to the budgets page so the widget is not a dead end (audit v2 P2)", () => {
    mockedUseCurrentMonthBudgets.mockReturnValue({
      data: [
        {
          id: "b1",
          name: "Groceries",
          amount: { amount: "500.00", currency: "USD" },
          spent: { amount: "100.00", currency: "USD" },
        },
      ],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useCurrentMonthBudgets>);

    render(<BudgetStatusWidget />, { wrapper: createWrapper() });

    const link = screen.getByRole("link", { name: /view budgets/i });
    expect(link).toHaveAttribute("href", "/budget");
  });
});
