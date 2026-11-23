import { render, screen, fireEvent } from "@testing-library/react";
import { HoldingsList } from "../components/HoldingsList";
import { TestWrapper } from "@/test/test-utils";
import type { Holding } from "@/hooks/useInvestments";

// Mock child modal
vi.mock("../components/RecordInvestmentTransactionModal", () => ({
  RecordInvestmentTransactionModal: ({ children }: any) => <>{children}</>,
}));

describe("HoldingsList", () => {
  const mockFormatCurrency = (val: number, curr: string) => `${curr} ${val}`;
  const datedHolding: Holding = {
    id: "price-holding",
    householdId: "household",
    accountId: "account",
    securityId: "security",
    quantity: "100",
    costBasis: "100.00",
    costBasisZmw: "100.00",
    acquiredDate: null,
    acquisitionFxRate: null,
    createdAt: "2000-01-01T00:00:00Z",
    updatedAt: "2000-01-01T00:00:00Z",
    currentValue: { amount: "314.15", currency: "ZMW" },
    security: {
      id: "security",
      symbol: "LOCAL",
      name: "Household-priced security",
      type: "stock",
      currency: "ZMW",
      exchange: null,
      isOffshore: false,
      sector: null,
      cusipIsin: null,
      currentPrice: "3.1415",
      lastPriceUpdate: "2000-01-01T00:00:00Z",
      withholdingTaxRate: "0.00",
      createdAt: "2000-01-01T00:00:00Z",
      updatedAt: "2000-01-01T00:00:00Z",
    },
  };
  const mockHoldings = [
    {
      id: "1",
      quantity: "100",
      currentValue: { amount: "1000.00", currency: "ZMW" },
      gainLossPercent: 10,
      security: {
        symbol: "AAPL",
        name: "Apple Inc",
        type: "stock",
        currentPrice: "150",
      },
    },
    {
      id: "2",
      quantity: "50",
      currentValue: { amount: "2000.00", currency: "ZMW" },
      gainLossPercent: 5,
      security: {
        symbol: "GOOGL",
        name: "Alphabet Inc",
        type: "stock",
        currentPrice: "2800",
      },
    },
  ];

  it("renders holdings correctly", () => {
    render(
      <TestWrapper>
        <HoldingsList
          holdings={mockHoldings as any}
          displayCurrency="ZMW"
          formatCurrency={mockFormatCurrency}
        />
      </TestWrapper>
    );

    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("GOOGL")).toBeInTheDocument();
    expect(screen.getByText("ZMW 1000")).toBeInTheDocument();
    expect(screen.getByText("ZMW 2000")).toBeInTheDocument();
  });

  it("shows the selected household validity instead of a stale global price warning", () => {
    const holding: Holding = {
      ...datedHolding,
      security: {
        ...datedHolding.security!,
        valuationPrice: {
          source: "manual",
          effectiveDate: "2026-01-01",
          validThrough: "2099-12-31",
          recordedAt: "2026-01-01T00:00:00Z",
        },
      },
    };
    render(
      <TestWrapper>
        <HoldingsList holdings={[holding]} displayCurrency="ZMW" formatCurrency={mockFormatCurrency} />
      </TestWrapper>,
    );
    expect(screen.getByText("Household price, valid through 2099-12-31")).toBeInTheDocument();
    expect(screen.queryByTitle(/^Price stale/)).not.toBeInTheDocument();
  });

  it("retains the stale warning for an old selected reference price", () => {
    render(
      <TestWrapper>
        <HoldingsList holdings={[datedHolding]} displayCurrency="ZMW" formatCurrency={mockFormatCurrency} />
      </TestWrapper>,
    );
    expect(screen.getByTitle(/^Price stale/)).toBeInTheDocument();
    expect(screen.queryByText(/Household price, valid through/)).not.toBeInTheDocument();
  });

  it("sorts by value by default (descending)", () => {
    render(
      <TestWrapper>
        <HoldingsList
          holdings={mockHoldings as any}
          displayCurrency="ZMW"
          formatCurrency={mockFormatCurrency}
        />
      </TestWrapper>
    );

    const rows = screen.getAllByRole("row");
    // Row 0 is header. Row 1 should be GOOGL (2000), Row 2 AAPL (1000)
    expect(rows[1]).toHaveTextContent("GOOGL");
    expect(rows[2]).toHaveTextContent("AAPL");
  });

  it("sorts by name when header clicked", () => {
    render(
      <TestWrapper>
        <HoldingsList
          holdings={mockHoldings as any}
          displayCurrency="ZMW"
          formatCurrency={mockFormatCurrency}
        />
      </TestWrapper>
    );

    const nameHeader = screen.getByText("Name");
    fireEvent.click(nameHeader); // Sorts DESC first by default logic or ASC?
    // Implementation says: if new field, set to DESC.
    // So 'Name' clicked -> Name DESC (GOOGL first)
    // Wait, let's check implementation behavior:
    // "setSortField(field); setSortDirection('desc');"
    // So Name DESC -> GOOGL first.

    let rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("GOOGL");
    expect(rows[2]).toHaveTextContent("AAPL");

    // Click again -> Name ASC (AAPL first)
    fireEvent.click(nameHeader);
    rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("AAPL");
    expect(rows[2]).toHaveTextContent("GOOGL");
  });
});
