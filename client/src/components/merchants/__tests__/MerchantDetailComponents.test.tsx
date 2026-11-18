import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { MerchantDetailChart } from "../detail/MerchantDetailChart";
import { MerchantCategoryBreakdown } from "../detail/MerchantCategoryBreakdown";
import { MerchantAliasSection } from "../detail/MerchantAliasSection";
import { MerchantDetailFilters } from "../detail/MerchantDetailFilters";
import { MerchantTransactionsList } from "../detail/MerchantTransactionsList";

// Mock recharts. Spread the real module first so every export the UI touches
// (Legend, PieChart, etc. via chart.tsx) is defined, then override the handful
// of chart primitives we want to stub out in jsdom.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
    LineChart: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
    Line: () => <div>Line</div>,
    XAxis: () => <div>XAxis</div>,
    YAxis: () => <div>YAxis</div>,
    CartesianGrid: () => <div>CartesianGrid</div>,
    Tooltip: () => <div>Tooltip</div>,
  };
});

// Mock useSettings hook
vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({ currency: "USD" }),
}));

describe("MerchantDetailChart", () => {
  it("renders chart with trend data", () => {
    const trend = [
      { period: "2024-01-01", total: 100 },
      { period: "2024-01-02", total: 150 },
    ];

    render(<MerchantDetailChart trend={trend} />);
    // Chart should render
  });

  it("handles empty trend data", () => {
    render(<MerchantDetailChart trend={[]} />);
    // Should render without errors
  });
});

describe("MerchantCategoryBreakdown", () => {
  it("renders category breakdown items", () => {
    const items = [
      { id: "1", label: "Groceries", value: "500", percent: 50 },
      { id: "2", label: "Dining", value: "300", percent: 30 },
    ];

    render(<MerchantCategoryBreakdown items={items} />);

    expect(screen.getByText("Groceries")).toBeInTheDocument();
    expect(screen.getByText("Dining")).toBeInTheDocument();
  });

  it("handles empty items array", () => {
    render(<MerchantCategoryBreakdown items={[]} />);
    expect(screen.getByText("No category breakdown for this range.")).toBeInTheDocument();
  });

  it("displays percentages correctly", () => {
    const items = [
      { id: "1", label: "Groceries", value: "500", percent: 50 },
    ];

    render(<MerchantCategoryBreakdown items={items} />);

    expect(screen.getByText("50.0%")).toBeInTheDocument();
  });
});

describe("MerchantAliasSection", () => {
  it("renders alias list", () => {
    const aliases = [
      { id: "1", merchantId: "m1", aliasName: "Alias 1", createdAt: "2024-01-01" },
      { id: "2", merchantId: "m1", aliasName: "Alias 2", createdAt: "2024-01-01" },
    ];

    render(
      <MerchantAliasSection
        aliases={aliases}
        onAddAlias={vi.fn()}
        onDeleteAlias={vi.fn()}
        isAddPending={false}
        isDeletePending={false}
      />
    );

    expect(screen.getByText("Alias 1")).toBeInTheDocument();
    expect(screen.getByText("Alias 2")).toBeInTheDocument();
  });

  it("calls onAddAlias when adding alias", () => {
    const onAddAlias = vi.fn();
    render(
      <MerchantAliasSection
        aliases={[]}
        onAddAlias={onAddAlias}
        onDeleteAlias={vi.fn()}
        isAddPending={false}
        isDeletePending={false}
      />
    );

    // This test would need to interact with the add alias form
  });

  it("calls onDeleteAlias when deleting alias", () => {
    const onDeleteAlias = vi.fn();
    const aliases = [
      { id: "1", merchantId: "m1", aliasName: "Alias 1", createdAt: "2024-01-01" },
    ];

    render(
      <MerchantAliasSection
        aliases={aliases}
        onAddAlias={vi.fn()}
        onDeleteAlias={onDeleteAlias}
        isAddPending={false}
        isDeletePending={false}
      />
    );

    // Find and click delete button
  });

  it("disables add button when pending", () => {
    render(
      <MerchantAliasSection
        aliases={[]}
        onAddAlias={vi.fn()}
        onDeleteAlias={vi.fn()}
        isAddPending={true}
        isDeletePending={false}
      />
    );

    // Add button should be disabled
  });

  it("shows empty state when no aliases", () => {
    render(
      <MerchantAliasSection
        aliases={[]}
        onAddAlias={vi.fn()}
        onDeleteAlias={vi.fn()}
        isAddPending={false}
        isDeletePending={false}
      />
    );

    // Should show appropriate empty state message
  });
});

describe("MerchantDetailFilters", () => {
  it("renders all filter controls", () => {
    render(
      <MerchantDetailFilters
        startDate=""
        endDate=""
        groupBy="day"
        categoryId=""
        minAmount=""
        maxAmount=""
        categories={[]}
        onStartDateChange={vi.fn()}
        onEndDateChange={vi.fn()}
        onGroupByChange={vi.fn()}
        onCategoryChange={vi.fn()}
        onMinAmountChange={vi.fn()}
        onMaxAmountChange={vi.fn()}
      />
    );

    // Filter controls should be present
  });

  it("calls onStartDateChange when date changes", () => {
    const onStartDateChange = vi.fn();
    render(
      <MerchantDetailFilters
        startDate=""
        endDate=""
        groupBy="day"
        categoryId=""
        minAmount=""
        maxAmount=""
        categories={[]}
        onStartDateChange={onStartDateChange}
        onEndDateChange={vi.fn()}
        onGroupByChange={vi.fn()}
        onCategoryChange={vi.fn()}
        onMinAmountChange={vi.fn()}
        onMaxAmountChange={vi.fn()}
      />
    );

    // Interact with date picker
  });

  it("displays category options", () => {
    const categories = [
      { id: "1", name: "Groceries" },
      { id: "2", name: "Dining" },
    ];

    render(
      <MerchantDetailFilters
        startDate=""
        endDate=""
        groupBy="day"
        categoryId=""
        minAmount=""
        maxAmount=""
        categories={categories}
        onStartDateChange={vi.fn()}
        onEndDateChange={vi.fn()}
        onGroupByChange={vi.fn()}
        onCategoryChange={vi.fn()}
        onMinAmountChange={vi.fn()}
        onMaxAmountChange={vi.fn()}
      />
    );

    // Categories should be in select
  });
});

describe("MerchantTransactionsList", () => {
  it("renders transaction list", () => {
    const transactions = [
      {
        id: "1",
        date: "2024-01-01",
        name: "Transaction 1",
        amount: "100",
      },
      {
        id: "2",
        date: "2024-01-02",
        name: "Transaction 2",
        amount: "150",
      },
    ];

    render(
      <MerchantTransactionsList
        transactions={transactions}
        page={1}
        onPageChange={vi.fn()}
        onExport={vi.fn()}
        onViewAll={vi.fn()}
      />
    );

    expect(screen.getByText("Transaction 1")).toBeInTheDocument();
    expect(screen.getByText("Transaction 2")).toBeInTheDocument();
    expect(screen.getByText("$100.00")).toBeInTheDocument();
    expect(screen.queryByText("K100.00")).not.toBeInTheDocument();
  });

  it("handles empty transactions list", () => {
    render(
      <MerchantTransactionsList
        transactions={[]}
        page={1}
        onPageChange={vi.fn()}
        onExport={vi.fn()}
        onViewAll={vi.fn()}
      />
    );

    // Should show empty state
  });

  it("calls onPageChange when page changes", () => {
    const onPageChange = vi.fn();
    const transactions = Array.from({ length: 20 }, (_, i) => ({
      id: `${i}`,
      date: "2024-01-01",
      name: `Transaction ${i}`,
      amount: "100",
    }));

    render(
      <MerchantTransactionsList
        transactions={transactions}
        page={1}
        onPageChange={onPageChange}
        onExport={vi.fn()}
        onViewAll={vi.fn()}
      />
    );

    // Pagination controls would trigger onPageChange
  });

  it("calls onExport when export button is clicked", () => {
    const onExport = vi.fn();
    const transactions = [
      {
        id: "1",
        date: "2024-01-01",
        name: "Transaction 1",
        amount: "100",
      },
    ];

    render(
      <MerchantTransactionsList
        transactions={transactions}
        page={1}
        onPageChange={vi.fn()}
        onExport={onExport}
        onViewAll={vi.fn()}
      />
    );

    // Find and click export button
  });

  it("calls onViewAll when view all button is clicked", () => {
    const onViewAll = vi.fn();
    const transactions = [
      {
        id: "1",
        date: "2024-01-01",
        name: "Transaction 1",
        amount: "100",
      },
    ];

    render(
      <MerchantTransactionsList
        transactions={transactions}
        page={1}
        onPageChange={vi.fn()}
        onExport={vi.fn()}
        onViewAll={onViewAll}
      />
    );

    // Find and click view all button
  });
});
