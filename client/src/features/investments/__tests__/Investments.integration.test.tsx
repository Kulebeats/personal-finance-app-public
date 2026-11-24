import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TestWrapper } from "@/test/test-utils";
import Investments from "@/pages/Investments";
import * as useInvestmentsDataHook from "../hooks/useInvestmentsData";

// Mock the feature hook
vi.mock("../hooks/useInvestmentsData");
// These dashboard-composition cases do not open the lifetime-owned holding form.
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({ status: null, lifetime: null }) }));
vi.mock("@/hooks/use-settings", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-settings")>(),
  useDisplaySettings: () => ({ data: undefined }),
}));

// The page subscribes to useHoldings directly (deduped by query key) to surface
// load errors vs. an empty portfolio. It is not part of useInvestmentsData, so
// stub it to a successful, non-error result; otherwise the unmocked query fails
// in jsdom and the page renders its error state instead of the tabs.
vi.mock("@/hooks/useInvestments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useInvestments")>();
  return {
    ...actual,
    useHoldings: vi.fn(() => ({
      isError: false,
      refetch: vi.fn(),
    })),
  };
});

// Mock child components that make network requests or are complex
vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-layout">{children}</div>
  ),
}));

vi.mock("../components/GRZSecurities", () => ({
  GRZSecurities: () => <div>GRZ Content</div>,
}));
vi.mock("../components/FXImpactPanel", () => ({
  FXImpactPanel: () => <div>FX Content</div>,
}));
vi.mock("../components/TaxReport", () => ({
  TaxReport: () => <div>Tax Content</div>,
}));
vi.mock("../components/PensionDashboard", () => ({
  PensionDashboard: () => <div>Pension Content</div>,
}));
vi.mock("../components/RecurringInvestmentSetup", () => ({
  RecurringInvestmentSetup: () => <div>Recurring Content</div>,
}));

// Mock Recharts to avoid sizing issues in JSDOM. importActual returns a Promise,
// so the factory must be async and await it; otherwise every real export
// (PieChart, Pie, Cell, Tooltip, ...) is dropped and the allocation chart throws.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 800, height: 800 }}>{children}</div>
    ),
  };
});

describe("Investments Page Integration", () => {
  const defaultMockData = {
    displayCurrency: "ZMW",
    setDisplayCurrency: vi.fn(),
    timeframe: "1M",
    setTimeframe: vi.fn(),
    isLoading: false,
    holdings: [
      {
        id: "1",
        quantity: "100",
        currentValue: { amount: "1000.00", currency: "ZMW" },
        gainLossPercent: 10,
        security: {
          symbol: "TEST",
          name: "Test Security",
          type: "stock",
          currentPrice: "10",
        },
      },
    ],
    portfolioSummary: {
      totalValue: { amount: "1000.00", currency: "ZMW" },
      totalGainLoss: { amount: "100.00", currency: "ZMW" },
      totalGainLossPercent: 10,
    },
    performanceHistory: [{ date: "Jan", value: { amount: "1000.00", currency: "ZMW" } }],
    allocationData: [
      { name: "Stocks", value: 100, amount: 1000, color: "#000" },
    ],
    totalValue: 1000,
    totalGainLoss: 100,
    totalGainLossPercent: 10,
    formatCurrency: (val: number, curr: string) => `${curr} ${val}`,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useInvestmentsDataHook.useInvestmentsData as any).mockReturnValue(
      defaultMockData
    );
  });

  it("renders the investments dashboard with components", () => {
    render(
      <TestWrapper>
        <Investments />
      </TestWrapper>
    );

    // Header
    expect(screen.getByText(/Total Value/i)).toBeInTheDocument();
    expect(screen.getAllByText("ZMW 1000").length).toBeGreaterThan(0);

    // Tabs
    expect(screen.getByRole("tab", { name: /Holdings/i })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /Performance/i })
    ).toBeInTheDocument();

    // Holdings List (default tab)
    expect(screen.getByText("Test Security")).toBeInTheDocument();
    expect(screen.getAllByText("TEST").length).toBeGreaterThan(0);
  });

  it("shows empty state when no holdings", () => {
    (useInvestmentsDataHook.useInvestmentsData as any).mockReturnValue({
      ...defaultMockData,
      holdings: [],
    });

    render(
      <TestWrapper>
        <Investments />
      </TestWrapper>
    );

    expect(screen.getByText(/No Holdings Yet/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Start tracking your investments/i)
    ).toBeInTheDocument();
  });

  it("switches tabs correctly", async () => {
    const user = userEvent.setup();
    render(
      <TestWrapper>
        <Investments />
      </TestWrapper>
    );

    // Switch to Allocation tab. Radix tab selection requires real pointer
    // events, so use userEvent rather than fireEvent.click.
    const allocationTab = screen.getByRole("tab", { name: /Allocation/i });
    await user.click(allocationTab);

    expect(
      await screen.findByText(/Asset Class Breakdown/i)
    ).toBeInTheDocument();

    // Use findAllByText in case there are multiple or it takes time, although findByText implied waiting for the container
    const stockElements = await screen.findAllByText("Stocks");
    expect(stockElements.length).toBeGreaterThan(0);
  });

  it("offers members no market price refresh: that is an operator action (NEW-13)", () => {
    render(
      <TestWrapper>
        <Investments />
      </TestWrapper>
    );

    expect(screen.queryByRole("button", { name: /Refresh Prices/i })).not.toBeInTheDocument();
  });
});
