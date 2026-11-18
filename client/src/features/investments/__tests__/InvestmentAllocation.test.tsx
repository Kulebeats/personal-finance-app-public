import { render, screen } from "@testing-library/react";
import { InvestmentAllocation } from "../components/InvestmentAllocation";
import { TestWrapper } from "@/test/test-utils";

// Mock Recharts
vi.mock("recharts", () => {
  const OriginalModule = vi.importActual("recharts");
  return {
    ...OriginalModule,
    ResponsiveContainer: ({ children }: any) => (
      <div style={{ width: 300, height: 300 }}>{children}</div>
    ),
    PieChart: ({ children }: any) => <div>{children}</div>,
    Pie: ({ data }: any) => (
      <div>
        {data.map((entry: any) => (
          <div key={entry.name} data-testid="pie-slice">
            {entry.name}
          </div>
        ))}
      </div>
    ),
    Cell: () => null,
    Tooltip: () => null,
  };
});

describe("InvestmentAllocation", () => {
  const mockFormatCurrency = (val: number, curr: string) => `${curr} ${val}`;
  const mockData = [
    { name: "Stocks", value: 60, amount: 6000, color: "#000" },
    { name: "Bonds", value: 40, amount: 4000, color: "#111" },
  ];

  it("renders allocation chart and list", () => {
    render(
      <TestWrapper>
        <InvestmentAllocation
          data={mockData}
          totalValue={10000}
          displayCurrency="ZMW"
          formatCurrency={mockFormatCurrency}
        />
      </TestWrapper>
    );

    // Check Total Value
    expect(screen.getByText("Total Assets")).toBeInTheDocument();
    expect(screen.getByText("ZMW 10000")).toBeInTheDocument();

    // Check Breakdown List
    expect(screen.getByText("Asset Class Breakdown")).toBeInTheDocument();
    expect(screen.getAllByText("Stocks")).toHaveLength(2); // Chart slice + Legend item
    expect(screen.getAllByText("Bonds")).toHaveLength(2);
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getAllByText("ZMW 6000")).toHaveLength(1); // Amount only in legend? Total is 10000. Wait, strict check.
  });

  it("shows empty state message", () => {
    render(
      <TestWrapper>
        <InvestmentAllocation
          data={[]}
          totalValue={0}
          displayCurrency="ZMW"
          formatCurrency={mockFormatCurrency}
        />
      </TestWrapper>
    );

    expect(
      screen.getByText(/Add holdings to see allocation/i)
    ).toBeInTheDocument();
  });
});
