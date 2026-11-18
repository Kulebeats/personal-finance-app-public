import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "../Dashboard";

type ApiErrorLike = Error & { code?: string; status?: number };

type HouseholdHookState = {
  error: ApiErrorLike | null;
  isLoading: boolean;
};

// Real apiCall-thrown errors (see client/src/lib/api.ts) carry `code` and
// `status`; useHousehold's fetchHousehold (use-settings.ts) now routes
// through apiCall for exactly this reason (FIX P7b-3).
function noHouseholdError(message = "No household found"): ApiErrorLike {
  const error = new Error(message) as ApiErrorLike;
  error.code = "HOUSEHOLD_NOT_FOUND";
  error.status = 404;
  return error;
}

const mocks = vi.hoisted(() => ({
  householdState: {
    error: null,
    isLoading: false,
  } as { error: (Error & { code?: string; status?: number }) | null; isLoading: boolean },
  profile: { firstName: "Ada", displayName: "Ada" } as {
    firstName?: string | null;
    displayName?: string | null;
    fullName?: string | null;
  },
}));

type ChildrenProps = { children?: React.ReactNode };

vi.mock("@/components/Layout", () => ({
  default: ({ children }: ChildrenProps) => <div>{children}</div>,
}));

vi.mock("@/components/dashboard/NetWorthWidget", () => ({
  default: () => <div data-testid="widget-net-worth" />,
}));
vi.mock("@/components/dashboard/CashFlowWidget", () => ({
  default: () => <div data-testid="widget-cash-flow" />,
}));
vi.mock("@/components/dashboard/RecentTransactionsWidget", () => ({
  default: () => <div data-testid="widget-recent-transactions" />,
}));
vi.mock("@/components/dashboard/SpendingWidget", () => ({
  default: () => <div data-testid="widget-spending-category" />,
}));
vi.mock("@/components/dashboard/AccountsWidget", () => ({
  default: () => <div data-testid="widget-accounts" />,
}));
vi.mock("@/components/dashboard/BudgetStatusWidget", () => ({
  default: () => <div data-testid="widget-budget-status" />,
}));
vi.mock("@/components/dashboard/GoalsWidget", () => ({
  default: () => <div data-testid="widget-goals" />,
}));
vi.mock("@/components/dashboard/RecurringExpensesWidget", () => ({
  default: () => <div data-testid="widget-recurring" />,
}));
vi.mock("@/components/dashboard/AnnualSummaryWidget", () => ({
  default: () => <div data-testid="widget-annual-summary" />,
}));
vi.mock("@/components/dashboard/DashboardBudgetWidget", () => ({
  default: () => <div data-testid="widget-budget-summary" />,
}));
vi.mock("@/components/dashboard/DashboardTransactionsWidget", () => ({
  default: () => <div data-testid="widget-transactions-list" />,
}));
vi.mock("@/components/dashboard/DashboardSpendingWidget", () => ({
  default: () => <div data-testid="widget-spending-trend" />,
}));
vi.mock("@/components/dashboard/TopMerchantsWidget", () => ({
  default: () => <div data-testid="widget-top-merchants" />,
}));
vi.mock("@/components/dashboard/InvestmentSummaryWidget", () => ({
  default: () => <div data-testid="widget-investments" />,
}));
vi.mock("@/components/weekly-recap/WeeklyRecapWidget", () => ({
  default: () => <div data-testid="widget-weekly-recap" />,
}));
vi.mock("@/components/weekly-recap/WeeklyRecapWizard", () => ({
  default: () => null,
}));
vi.mock("@/components/dashboard/CustomizeDashboardModal", () => ({
  CustomizeDashboardModal: () => null,
}));
vi.mock("@/features/accounts", () => ({
  AddAccountModal: ({ children }: ChildrenProps) => <>{children}</>,
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: ChildrenProps) => <>{children}</>,
  closestCenter: vi.fn(),
  KeyboardSensor: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: ChildrenProps) => <>{children}</>,
  arrayMove: <T,>(items: T[]) => items,
  rectSortingStrategy: {},
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  })),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: {
    Transform: {
      toString: vi.fn(() => undefined),
    },
  },
}));

vi.mock("@/hooks/use-format", () => ({
  useFormat: () => ({
    formatCurrency: (amount: number) => `$${amount}`,
  }),
}));

vi.mock("@/hooks/use-settings", () => ({
  useProfile: () => ({
    data: mocks.profile,
  }),
  useHousehold: () => mocks.householdState,
}));

vi.mock("@/hooks/useDashboardWidgets", () => ({
  useDashboardWidgets: () => ({
    widgets: [{ id: "budget-summary", label: "Budget Summary", enabled: true }],
    toggleWidget: vi.fn(),
    reorderWidgets: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useRefetchOnFocus", () => ({
  useRefetchOnFocus: vi.fn(),
}));

describe("Dashboard", () => {
  beforeEach(() => {
    mocks.householdState = { error: null, isLoading: false };
    mocks.profile = { firstName: "Ada", displayName: "Ada" };
  });

  it("greets by the first word of fullName when no first or display name is set", () => {
    mocks.profile = { fullName: "Ada Lovelace", firstName: null, displayName: null };

    render(<Dashboard />);

    expect(screen.getByText("Good morning, Ada")).toBeInTheDocument();
  });

  it("shows onboarding when the household query fails with the structural HOUSEHOLD_NOT_FOUND signal", () => {
    mocks.householdState = { error: noHouseholdError(), isLoading: false };

    render(<Dashboard />);

    expect(screen.getByText("Welcome to Capital!")).toBeInTheDocument();
  });

  // FIX P7b-3: the whole point of the fix - if the server's error message is
  // reworded (translation, copy update, whatever), the onboarding gate must
  // still trigger because it keys off `code`/`status`, not message prose.
  it("still shows onboarding when the server's error message is reworded, as long as the structural signal is present", () => {
    mocks.householdState = {
      error: noHouseholdError("Le foyer n'existe pas encore pour cet utilisateur"),
      isLoading: false,
    };

    render(<Dashboard />);

    expect(screen.getByText("Welcome to Capital!")).toBeInTheDocument();
  });

  it("does NOT show onboarding merely because the message happens to contain the old prose, without the structural signal", () => {
    // Simulates an error that is NOT the no-household case (e.g. a 500) but
    // coincidentally shares wording with the historical message. Prose
    // matching alone would have false-positived here; the structural check
    // must not.
    const error = new Error("No household found in the audit trail") as Error & {
      code?: string;
      status?: number;
    };
    error.code = "INTERNAL_ERROR";
    error.status = 500;
    mocks.householdState = { error, isLoading: false };

    render(<Dashboard />);

    expect(screen.queryByText("Welcome to Capital!")).not.toBeInTheDocument();
  });

  it("keeps hook order stable when household state moves from missing to loaded", () => {
    mocks.householdState = { error: noHouseholdError(), isLoading: false };
    const { rerender } = render(<Dashboard />);

    expect(screen.getByText("Welcome to Capital!")).toBeInTheDocument();

    mocks.householdState = {
      error: null,
      isLoading: false,
    };

    expect(() => rerender(<Dashboard />)).not.toThrow();
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByTestId("widget-budget-summary")).toBeInTheDocument();
  });
});
