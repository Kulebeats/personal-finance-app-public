import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AccountsWidget from "../AccountsWidget";
import BudgetStatusWidget from "../BudgetStatusWidget";
import RecurringExpensesWidget from "../RecurringExpensesWidget";
import { useCurrentMonthBudgets } from "@/hooks/useBudgets";
import { useUpcomingBills } from "@/hooks/useRecurring";
import { useAccounts } from "@/hooks/use-finance-data";

const mockBudgetRefetch = vi.fn();
const mockRecurringRefetch = vi.fn();
const mockAccountRefresh = vi.fn();
const mockSetLocation = vi.fn();

vi.mock("@/contexts/SettingsContext", () => ({
  useFormatters: () => ({
    currency: "USD",
    formatCurrency: (value: number) => `$${value.toFixed(2)}`,
  }),
}));

vi.mock("@/hooks/useBudgets", () => ({
  useCurrentMonthBudgets: vi.fn(),
}));

vi.mock("@/hooks/useRecurring", () => ({
  useUpcomingBills: vi.fn(),
}));

vi.mock("@/hooks/use-finance-data", () => ({
  useAccounts: vi.fn(),
}));

vi.mock("@/components/BankLogo", () => ({
  BankLogo: ({ institution }: { institution: string }) => (
    <span data-testid="bank-logo">{institution}</span>
  ),
}));

vi.mock("wouter", () => ({
  Link: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
  useLocation: () => ["/", mockSetLocation],
}));

const mockedUseCurrentMonthBudgets = vi.mocked(useCurrentMonthBudgets);
const mockedUseUpcomingBills = vi.mocked(useUpcomingBills);
const mockedUseAccounts = vi.mocked(useAccounts);

describe("Dashboard hardened widgets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders BudgetStatusWidget error state with retry", () => {
    mockedUseCurrentMonthBudgets.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("budget failed"),
      refetch: mockBudgetRefetch,
    } as unknown as ReturnType<typeof useCurrentMonthBudgets>);

    render(<BudgetStatusWidget />);

    expect(screen.getByText("Unable to load budget status")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(mockBudgetRefetch).toHaveBeenCalledTimes(1);
  });

  it("renders BudgetStatusWidget decimal-backed aggregate status", () => {
    mockedUseCurrentMonthBudgets.mockReturnValue({
      data: [
        { amount: "100.10", spent: "20.05" },
        { amount: "99.90", spent: "119.95" },
      ],
      isLoading: false,
      error: null,
      refetch: mockBudgetRefetch,
    } as unknown as ReturnType<typeof useCurrentMonthBudgets>);

    render(<BudgetStatusWidget />);

    expect(screen.getByText("Budget Status")).toBeInTheDocument();
    expect(screen.getByText("$140.00")).toBeInTheDocument();
    expect(screen.getByText("$200.00")).toBeInTheDocument();
    expect(screen.getByText("You are approaching your limit.")).toBeInTheDocument();
  });

  it("renders RecurringExpensesWidget error state with retry", () => {
    mockedUseUpcomingBills.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("recurring failed"),
      refetch: mockRecurringRefetch,
    } as unknown as ReturnType<typeof useUpcomingBills>);

    render(<RecurringExpensesWidget />);

    expect(screen.getByText("Unable to load upcoming bills")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(mockRecurringRefetch).toHaveBeenCalledTimes(1);
  });

  it("renders RecurringExpensesWidget total and navigation action", () => {
    mockedUseUpcomingBills.mockReturnValue({
      data: [
        {
          id: "rent",
          name: "Rent",
          amount: { amount: "1200.00", currency: "USD" },
          nextDueDate: "2026-07-12",
        },
        {
          id: "internet",
          name: "Internet",
          amount: { amount: "50.25", currency: "USD" },
          nextDueDate: "2026-07-14",
        },
      ],
      isLoading: false,
      error: null,
      refetch: mockRecurringRefetch,
    } as unknown as ReturnType<typeof useUpcomingBills>);

    render(<RecurringExpensesWidget />);

    expect(screen.getByText("Rent")).toBeInTheDocument();
    expect(screen.getByText("$1250.25")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /view all/i }));
    expect(mockSetLocation).toHaveBeenCalledWith("/recurring");
  });

  it("renders AccountsWidget error state with retry", () => {
    mockedUseAccounts.mockReturnValue({
      accounts: [],
      loading: false,
      error: new Error("accounts failed"),
      refresh: mockAccountRefresh,
    } as unknown as ReturnType<typeof useAccounts>);

    render(<AccountsWidget />);

    expect(screen.getByText("Unable to load accounts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(mockAccountRefresh).toHaveBeenCalledTimes(1);
  });

  it("renders AccountsWidget balances with per-account currency", () => {
    mockedUseAccounts.mockReturnValue({
      accounts: [
        {
          id: "checking",
          name: "Main Checking",
          type: "checking",
          balance: 1250.5,
          currency: "USD",
          institution: "Test Bank",
        },
        {
          id: "card",
          name: "Credit Card",
          type: "credit",
          balance: 200.25,
          currency: "ZMW",
          institution: "Card Bank",
        },
      ],
      loading: false,
      error: null,
      refresh: mockAccountRefresh,
    } as unknown as ReturnType<typeof useAccounts>);

    render(<AccountsWidget />);

    expect(screen.getByText("Main Checking")).toBeInTheDocument();
    expect(screen.getByText("$1,250.50")).toBeInTheDocument();
    expect(screen.getByText("Credit Card")).toBeInTheDocument();
    expect(screen.getByText("-K200.25")).toBeInTheDocument();
    expect(screen.getByText("View all accounts")).toBeInTheDocument();
  });
});
