import { render, screen, fireEvent } from "@testing-library/react";
import { HoldingsList } from "../components/HoldingsList";
import { TestWrapper } from "@/test/test-utils";

// Mock child modal
vi.mock("../components/RecordInvestmentTransactionModal", () => ({
  RecordInvestmentTransactionModal: ({ children }: any) => <>{children}</>,
}));

describe("HoldingsList", () => {
  const mockFormatCurrency = (val: number, curr: string) => `${curr} ${val}`;
  const mockHoldings = [
    {
      id: "1",
      quantity: "100",
      currentValue: 1000,
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
      currentValue: 2000,
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
