import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Accounts from "@/pages/Accounts";
import { TestWrapper } from "@/test/test-utils";
import { vi, Mock } from "vitest"; // Import Mock type
import * as hooks from "@/hooks"; // Import all hooks to mock specific properties
import { personalPreferences, personalUserId } from "@/hooks/__tests__/personal-preferences-fixture";
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({ status: { state: "ready", subject: { id: "11111111-1111-4111-8111-111111111111" } }, loading: false }) }));
vi.mock("@/hooks/use-settings", async original => ({ ...await original<typeof import("@/hooks/use-settings")>(),
  useUserPreferences: () => ({ data: personalPreferences(), isLoading: false, error: null }),
  useProfile: () => ({ data: { id: personalUserId } }), useHouseholdMembers: () => ({ data: [] }),
}));

// Mock the hooks module
vi.mock("@/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof hooks>();
  return {
    ...actual,
    useAccounts: vi.fn(),
    useNetWorthSummary: vi.fn(),
    useNetWorthHistory: vi.fn(),
    useCreateAccount: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useExportAccountsSummary: vi.fn(() => ({
      mutate: vi.fn(),
      isPending: false,
    })),
  };
});

// Mock Recharts to avoid sizing issues in test environment
vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: any }) => (
      <div style={{ width: 500, height: 300 }}>{children}</div>
    ),
  };
});

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

const mockAccounts = [
  {
    id: "1",
    name: "Main Checking",
    type: "checking",
    balance: "5000.00",
    currency: "ZMW",
    institution: "FNB",
    ownerUserId: null,
    updatedAt: new Date().toISOString(),
  },
  {
    id: "2",
    name: "Credit Card",
    type: "credit",
    balance: "-1500.00",
    currency: "ZMW",
    institution: "Absa",
    ownerUserId: null,
    updatedAt: new Date().toISOString(),
  },
];

describe("Accounts Page Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock returns
    (hooks.useAccounts as Mock).mockReturnValue({
      data: mockAccounts,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    (hooks.useNetWorthSummary as Mock).mockReturnValue({
      data: {
        totalAssets: 5000,
        totalLiabilities: 1500,
        netWorth: 3500,
      },
      isLoading: false,
    });

    (hooks.useNetWorthHistory as Mock).mockReturnValue({
      data: { accounts: mockAccounts, series: [], currentStatus: "available",
        latest: { assets: 5000, liabilities: 1500, netWorth: 3500, currency: "ZMW" } },
      isLoading: false,
    });
  });

  it("renders accounts grouped by type", async () => {
    render(
      <TestWrapper>
        <Accounts />
      </TestWrapper>
    );

    // Check headers
    // Check headers (might appear in summary too, so check for existence)
    expect(screen.getAllByText("Banks").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Credit Cards").length).toBeGreaterThan(0);

    // Check account items
    expect(screen.getByText("Main Checking")).toBeDefined();
    expect(screen.getByText("Credit Card")).toBeDefined();

    // Check amounts
    expect(screen.getAllByText("K5,000.00").length).toBeGreaterThan(0); // Asset
    expect(screen.getAllByText("-K1,500.00").length).toBeGreaterThan(0); // Liability
  });

  it("renders summary sidebar correcty", () => {
    render(
      <TestWrapper>
        <Accounts />
      </TestWrapper>
    );

    expect(screen.getByText("Summary")).toBeDefined();
    expect(screen.getAllByText("Assets").length).toBeGreaterThan(0);
    // Summary values
    expect(screen.getByText(/ZMW.*3,500\.00/)).toBeDefined(); // Coherent current net worth with its denomination.
  });

  it("does not render the removed ViewSwitcher placeholder-only dropdown", () => {
    render(
      <TestWrapper>
        <Accounts />
      </TestWrapper>
    );

    // ViewSwitcher's only item was a disabled "More views coming soon"
    // placeholder with no real destination (R17 dead-control cleanup).
    expect(screen.queryByText("Net worth performance")).not.toBeInTheDocument();
    expect(screen.queryByText("More views coming soon")).not.toBeInTheDocument();
  });

  it("shows loading state", () => {
    (hooks.useNetWorthHistory as Mock).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    render(
      <TestWrapper>
        <Accounts />
      </TestWrapper>
    );

    expect(screen.getAllByText(/Checking current access/i).length).toBeGreaterThan(0);
    expect(screen.queryByText("Main Checking")).not.toBeInTheDocument();
  });
});
