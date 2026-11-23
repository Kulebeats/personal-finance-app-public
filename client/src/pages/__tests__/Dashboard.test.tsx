import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  householdProbe: vi.fn(),
  householdState: {
    error: null,
    isLoading: false,
  } as { error: (Error & { code?: string; status?: number }) | null; isLoading: boolean },
  profile: { firstName: "Ada", displayName: "Ada" } as { firstName: string | null; displayName: string | null; fullName?: string | null } | undefined,
  display: { data: { timezone: "Africa/Lusaka" }, isLoading: false, isError: false } as {
    data: { timezone: string } | undefined; isLoading: boolean; isError: boolean;
  },
  widgetSave: { saveStatus: "idle", saveError: null } as { saveStatus: string; saveError: string | null },
  retrySave: vi.fn(),
  load: { loadError: null } as { loadError: string | null },
  retryLoad: vi.fn(),
}));

type ChildrenProps = { children?: React.ReactNode };

vi.mock("@/components/Layout", () => ({
  default: ({ children }: ChildrenProps) => <div>{children}</div>,
}));

vi.mock("@/components/dashboard/GettingStartedChecklist", () => ({
  GettingStartedChecklist: () => null,
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
  useDisplaySettings: () => mocks.display,
  useProfile: () => ({
    data: mocks.profile,
  }),
  useHousehold: () => { mocks.householdProbe(); return mocks.householdState; },
}));

vi.mock("@/hooks/useDashboardWidgets", () => ({
  useDashboardWidgets: () => ({
    widgets: [{ id: "budget-summary", label: "Budget Summary", enabled: true }],
    toggleWidget: vi.fn(),
    reorderWidgets: vi.fn(),
    isLoading: false,
    ...mocks.widgetSave,
    retrySave: mocks.retrySave,
    ...mocks.load,
    retryLoad: mocks.retryLoad,
  }),
}));

vi.mock("@/hooks/useRefetchOnFocus", () => ({
  useRefetchOnFocus: vi.fn(),
}));

describe("Dashboard", () => {
  beforeEach(() => {
    mocks.householdProbe.mockClear();
    mocks.householdState = { error: null, isLoading: false };
    mocks.display = { data: { timezone: "Africa/Lusaka" }, isLoading: false, isError: false };
    mocks.profile = { firstName: "Ada", displayName: "Ada" };
    mocks.widgetSave = { saveStatus: "idle", saveError: null };
    mocks.retrySave.mockClear();
    mocks.load = { loadError: null };
    mocks.retryLoad.mockClear();
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("greets using the saved display timezone instead of a fixed morning message", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-30T12:00:00Z"));
    const view = render(<Dashboard />);
    expect(screen.getByText("Good afternoon, Ada")).toBeInTheDocument();
    mocks.display = { data: { timezone: "Asia/Tokyo" }, isLoading: false, isError: false };
    view.rerender(<Dashboard />);
    expect(screen.getByText("Good evening, Ada")).toBeInTheDocument();
  });

  it.each([
    ["2026-10-30T02:59:59Z", "Good evening"],
    ["2026-10-30T03:00:00Z", "Good morning"],
    ["2026-10-30T09:59:59Z", "Good morning"],
    ["2026-10-30T10:00:00Z", "Good afternoon"],
    ["2026-10-30T15:59:59Z", "Good afternoon"],
    ["2026-10-30T16:00:00Z", "Good evening"],
  ])("uses the correct Lusaka greeting at %s", (instant, greeting) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(instant));
    render(<Dashboard />);
    expect(screen.getByText(`${greeting}, Ada`)).toBeInTheDocument();
  });

  it("updates exactly at noon without remounting or user interaction", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-30T09:59:59Z"));
    render(<Dashboard />);
    expect(screen.getByText("Good morning, Ada")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("Good afternoon, Ada")).toBeInTheDocument();
  });

  it.each(["loading", "error", "missing", "empty", "invalid"])("uses a neutral greeting for %s timezone settings", (kind) => {
    mocks.display = { data: kind === "missing" ? undefined : { timezone: kind === "invalid" ? "Invalid/Zone" : kind === "empty" ? "" : "Asia/Tokyo" },
      isLoading: kind === "loading", isError: kind === "error" };
    render(<Dashboard />);
    expect(screen.getByText("Hello, Ada")).toBeInTheDocument();
  });

  it("uses a display name when first name is whitespace and does not invent a missing name", () => {
    mocks.display.data = undefined;
    mocks.profile = { firstName: "  ", displayName: "  Ada L.  " };
    const view = render(<Dashboard />);
    expect(screen.getByText("Hello, Ada L.")).toBeInTheDocument();
    mocks.profile = { firstName: null, displayName: "  " };
    view.rerender(<Dashboard />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.queryByText(/User/)).not.toBeInTheDocument();
    mocks.profile = undefined;
    view.rerender(<Dashboard />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("greets by the first word of fullName when no first or display name is set", () => {
    mocks.display.data = undefined;
    mocks.profile = { firstName: null, displayName: "  ", fullName: " Ada Lovelace " };
    render(<Dashboard />);
    expect(screen.getByText("Hello, Ada")).toBeInTheDocument();
  });

  it("refreshes after a clock jump on focus and removes timers on unmount", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-30T08:00:00Z"));
    const view = render(<Dashboard />);
    vi.setSystemTime(new Date("2026-10-30T18:00:00Z"));
    fireEvent(window, new Event("focus"));
    expect(screen.getByText("Good evening, Ada")).toBeInTheDocument();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops its timer while hidden and refreshes when visible again", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-30T08:00:00Z"));
    let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    render(<Dashboard />);
    visibility = "hidden";
    fireEvent(document, new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(new Date("2026-10-30T18:00:00Z"));
    visibility = "visible";
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.getByText("Good evening, Ada")).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(1);
  });

  it("does not restart its timer on focus or visibility events after unmount", () => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const view = render(<Dashboard />);
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    fireEvent(window, new Event("focus"));
    fireEvent(document, new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows a failed layout load and lets the user retry before customizing", () => {
    mocks.load = { loadError: "Unable to load display settings" };
    render(<Dashboard />);
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load display settings");
    expect(screen.getByRole("button", { name: "Customize" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry Loading Layout" }));
    expect(mocks.retryLoad).toHaveBeenCalledTimes(1);
  });

  it("shows an unsaved failure with an actionable retry and only shows saved after acknowledgement", () => {
    mocks.widgetSave = { saveStatus: "error", saveError: "Connection lost" };
    const view = render(<Dashboard />);
    expect(screen.getByRole("alert")).toHaveTextContent("Dashboard layout is not saved. Connection lost");
    fireEvent.click(screen.getByRole("button", { name: "Retry Save" }));
    expect(mocks.retrySave).toHaveBeenCalledTimes(1);
    mocks.widgetSave = { saveStatus: "saving", saveError: null };
    view.rerender(<Dashboard />);
    expect(screen.getByRole("status")).toHaveTextContent("Saving dashboard layout…");
    expect(screen.queryByText("Dashboard layout saved")).not.toBeInTheDocument();
    mocks.widgetSave = { saveStatus: "saved", saveError: null };
    view.rerender(<Dashboard />);
    expect(screen.getByRole("status")).toHaveTextContent("Dashboard layout saved");
  });

  it("leaves household onboarding authority to the actual App boundary", () => {
    mocks.householdState = { error: noHouseholdError(), isLoading: false };

    render(<Dashboard />);

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(mocks.householdProbe).not.toHaveBeenCalled();
  });

  // Actual root and direct-financial onboarding are covered with production
  // App/providers/fetchers in App.session-access.test.tsx. The authorized leaf
  // must not introduce a second household probe or message-based authority.
  it("does not introduce a duplicate probe when old household error copy changes", () => {
    mocks.householdState = {
      error: noHouseholdError("Le foyer n'existe pas encore pour cet utilisateur"),
      isLoading: false,
    };

    render(<Dashboard />);

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(mocks.householdProbe).not.toHaveBeenCalled();
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
    expect(mocks.householdProbe).not.toHaveBeenCalled();
  });

  it("keeps the App-authorized leaf stable across rerenders without household lookup", () => {
    mocks.householdState = { error: noHouseholdError(), isLoading: false };
    const { rerender } = render(<Dashboard />);

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();

    mocks.householdState = {
      error: null,
      isLoading: false,
    };

    expect(() => rerender(<Dashboard />)).not.toThrow();
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByTestId("widget-budget-summary")).toBeInTheDocument();
    expect(mocks.householdProbe).not.toHaveBeenCalled();
  });
});
