import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AccountDetailHeader } from "../components/detail/AccountDetailHeader";
import { AccountTransactions } from "../components/detail/AccountTransactions";
import { TestWrapper } from "@/test/test-utils";

// Mock Recharts and dropdowns
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  AreaChart: () => <div>AreaChart</div>,
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks", () => ({
  useExportTransactions: () => ({ mutate: vi.fn(), isPending: false }),
  useExportBalanceHistory: () => ({ mutate: vi.fn(), isPending: false }),
}));

describe("AccountDetailHeader", () => {
  const mockAccount: any = {
    id: "1",
    householdId: "household1",
    name: "Test Bank",
    type: "checking",
    balance: "1234.56",
    initialBalance: "0.00",
    currency: "USD",
    institution: "Chase",
    isAsset: true,
    isPrivate: false,
    isHidden: false,
    isArchived: false,
    displayOrder: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it("renders account name and formatted balance", () => {
    render(
      <AccountDetailHeader
        account={mockAccount}
        dateRange="1m"
        setDateRange={vi.fn()}
        onEdit={vi.fn()}
        onImportTransactions={vi.fn()}
        onImportBalanceHistory={vi.fn()}
        hasHistory={true}
      />,
      { wrapper: TestWrapper }
    );

    expect(screen.getByText("Test Bank")).toBeInTheDocument();
    expect(screen.getByText("Current Balance")).toBeInTheDocument();
    // Currency symbol and comma formatting might vary, but "1,234.56" should be present in parts or total
    expect(
      screen.getByText((content) => content.includes("1,234.56"))
    ).toBeInTheDocument();
  });
});

describe("AccountTransactions", () => {
  it("renders grouped transactions", () => {
    const grouped = {
      "Jan 1, 2024": [
        {
          id: "1",
          name: "Starbucks",
          amount: "-5.00",
          categoryName: "Coffee",
        } as any,
      ],
    };

    render(
      <AccountTransactions
        groupedTransactions={grouped}
        isLoading={false}
        currency="USD"
        onAddTransaction={vi.fn()}
      />,
      { wrapper: TestWrapper }
    );

    expect(screen.getByText("Transactions")).toBeInTheDocument();
    expect(screen.getByText("Starbucks")).toBeInTheDocument();
    expect(screen.getByText("Coffee")).toBeInTheDocument();
  });

  it("renders empty state", () => {
    render(
      <AccountTransactions
        groupedTransactions={{}}
        isLoading={false}
        currency="USD"
        onAddTransaction={vi.fn()}
      />,
      { wrapper: TestWrapper }
    );

    expect(screen.getByText("No transactions yet")).toBeInTheDocument();
  });
});
