/**
 * Recurring Page Integration Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Recurring from "@/pages/Recurring";
import { setCalendarTimeZone, setHouseholdCalendarTimeZone } from "@/lib/calendarZone";

// Mock Layout
vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

// Mock AddTransactionModal
vi.mock("@/components/transactions/AddTransactionModal", () => ({
  AddTransactionModal: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

// Mock Settings Context
vi.mock("@/contexts/SettingsContext", () => ({
  useSettings: () => ({ currency: "USD" }),
  useFormatters: () => ({ currency: "USD" }),
}));

// RecurringPatternsModal reads the data lifetime from the session; the real
// SessionProvider is not under test here (same pattern as Investments tests).
vi.mock("@/contexts/SessionContext", () => ({
  useSession: () => ({ status: null, lifetime: null }),
}));

// Mock format utilities
vi.mock("@/lib/format", () => ({
  formatCurrency: (val: number, _currency?: string) => `$${val.toFixed(2)}`,
}));

// Mock recurring hooks
const mockRecurring = vi.fn();
const mockUpcomingBills = vi.fn();
const mockCalendarRequest = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api")>(),
  apiCall: mockCalendarRequest,
}));

// Partial mock: override only the hooks this page exercises and spread the rest
// of the real module. importOriginal keeps every other export (useDetectPatterns,
// useConfirmPattern, types, etc.) defined, so the mock cannot leak as a partial
// module into sibling test files that share vitest's module registry.
vi.mock("@/hooks/useRecurring", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useRecurring")>();
  return {
    ...actual,
    useRecurring: () => mockRecurring(),
    useUpcomingBills: () => mockUpcomingBills(),
    useDeleteRecurring: () => ({ mutate: vi.fn() }),
    usePauseRecurring: () => ({ mutate: vi.fn() }),
    useSkipRecurring: () => ({ mutate: vi.fn() }),
  };
});

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

const renderWithProviders = (ui: React.ReactElement) => {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
};

const createMockRecurring = (overrides = {}) => ({
  id: "rec-1",
  name: "Netflix",
  amount: { amount: "15.99", currency: "USD" },
  frequency: "monthly",
  type: "expense",
  nextDueDate: new Date().toISOString(),
  isPaused: false,
  categoryId: "cat-1",
  householdId: "h-1",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe("Recurring Page Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCalendarRequest.mockReset().mockResolvedValue({ success: true, data: [] });

    // Default mock responses
    mockRecurring.mockReturnValue({
      data: [
        createMockRecurring({
          id: "r1",
          name: "Netflix",
          amount: { amount: "15.99", currency: "USD" },
        }),
        createMockRecurring({
          id: "r2",
          name: "Spotify",
          amount: { amount: "9.99", currency: "USD" },
        }),
        createMockRecurring({
          id: "r3",
          name: "Salary",
          amount: { amount: "5000", currency: "USD" },
          type: "income",
          frequency: "monthly",
        }),
      ],
      isLoading: false,
      error: null,
    });

    mockUpcomingBills.mockReturnValue({
      data: [
        createMockRecurring({
          id: "r1",
          name: "Netflix",
          amount: { amount: "15.99", currency: "USD" },
        }),
        createMockRecurring({
          id: "r2",
          name: "Spotify",
          amount: { amount: "9.99", currency: "USD" },
        }),
      ],
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await act(async () => {
      setCalendarTimeZone(null);
      setHouseholdCalendarTimeZone(null);
    });
  });

  describe("Loading States", () => {
    it("shows loading spinner while fetching data", () => {
      mockRecurring.mockReturnValue({
        data: null,
        isLoading: true,
        error: null,
      });
      renderWithProviders(<Recurring />);
      expect(
        screen.getByText("Loading recurring transactions...")
      ).toBeInTheDocument();
    });

    it("shows error state when fetch fails", () => {
      mockRecurring.mockReturnValue({
        data: null,
        isLoading: false,
        error: new Error("Failed to fetch"),
      });
      renderWithProviders(<Recurring />);
      expect(
        screen.getByText("Failed to load recurring transactions")
      ).toBeInTheDocument();
    });
  });

  describe("Page Header", () => {
    it("displays page title", () => {
      renderWithProviders(<Recurring />);
      expect(screen.getByText("Recurring")).toBeInTheDocument();
    });

    it("displays upcoming payments summary", () => {
      renderWithProviders(<Recurring />);
      expect(screen.getByText(/upcoming payments/i)).toBeInTheDocument();
    });

    it("has Add Recurring button", () => {
      renderWithProviders(<Recurring />);
      expect(screen.getByText("Add Recurring")).toBeInTheDocument();
    });

    it("has Calendar/List view toggle", () => {
      renderWithProviders(<Recurring />);
      // Look for the view toggle buttons (Calendar and List icons)
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  describe("Calendar View", () => {
    it.each([
      { zone: null, month: "November 2026", from: "2026-11-01", to: "2026-11-30", today: 30 },
      { zone: "Africa/Lusaka", month: "December 2026", from: "2026-12-01", to: "2026-12-31", today: 1 },
    ])("opens the server's month at the UTC boundary with household zone $zone", async ({ zone, month, from, to, today }) => {
      vi.setSystemTime(new Date("2026-11-30T22:15:00Z"));
      await act(async () => {
        setCalendarTimeZone("Africa/Lusaka");
        setHouseholdCalendarTimeZone(zone);
      });
      renderWithProviders(<Recurring />);
      expect(screen.getByRole("heading", { name: month })).toBeInTheDocument();
      expect(screen.getByRole("gridcell", { name: `Day ${today}, today` })).toBeInTheDocument();
      await waitFor(() => expect(mockCalendarRequest).toHaveBeenCalledWith(
        `/recurring/calendar?from=${from}&to=${to}`, expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ));
      await waitFor(() => expect(screen.queryByText("Loading calendar status…")).not.toBeInTheDocument());
    });

    it("switches the mounted calendar from legacy UTC when the matching household zone arrives", async () => {
      vi.setSystemTime(new Date("2026-11-30T22:15:00Z"));
      await act(async () => {
        setCalendarTimeZone("Africa/Lusaka");
        setHouseholdCalendarTimeZone(null);
      });
      renderWithProviders(<Recurring />);
      expect(screen.getByRole("heading", { name: "November 2026" })).toBeInTheDocument();
      expect(screen.getByRole("gridcell", { name: "Day 30, today" })).toBeInTheDocument();

      await act(async () => { setHouseholdCalendarTimeZone("Africa/Lusaka"); });

      expect(screen.getByRole("heading", { name: "December 2026" })).toBeInTheDocument();
      expect(screen.getByRole("gridcell", { name: "Day 1, today" })).toBeInTheDocument();
      await waitFor(() => expect(mockCalendarRequest).toHaveBeenCalledWith(
        "/recurring/calendar?from=2026-12-01&to=2026-12-31", expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ));
    });

    it("reads back the mounted calendar after saving a rule from its occurrence", async () => {
      vi.setSystemTime(new Date("2026-11-22T12:00:00Z"));
      const before = createMockRecurring({ id: "edited", name: "Before edit", nextDueDate: "2026-11-24" });
      const after = { ...before, name: "After edit", nextDueDate: "2026-11-26" };
      let saved = false;
      mockCalendarRequest.mockImplementation(async (path: string, options?: RequestInit) => {
        if (path === "/recurring/edited" && options?.method === "PUT") {
          expect(JSON.parse(String(options.body))).toMatchObject({ name: after.name, nextDueDate: after.nextDueDate });
          saved = true;
          return { success: true, data: after };
        }
        const rule = saved ? after : before;
        return { success: true, data: [{ id: rule.id, date: rule.nextDueDate, status: "upcoming", rule, amount: rule.amount }] };
      });

      renderWithProviders(<Recurring />);
      fireEvent.click(await screen.findByRole("button", { name: /Before edit.*Upcoming/ }));
      const dialog = within(screen.getByRole("dialog", { name: "Edit Recurring Transaction" }));
      fireEvent.change(dialog.getByLabelText("Name"), { target: { value: after.name } });
      fireEvent.change(dialog.getByLabelText("Next Due Date"), { target: { value: after.nextDueDate } });
      fireEvent.click(dialog.getByRole("button", { name: "Save Changes" }));

      expect(await screen.findByRole("button", { name: /After edit.*Upcoming/ })).toBeInTheDocument();
      expect(within(screen.getByRole("gridcell", { name: /^Day 26,/ })).getByRole("button", {
        name: /After edit.*Upcoming/,
      })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Before edit.*Upcoming/ })).not.toBeInTheDocument();
      expect(mockCalendarRequest.mock.calls.filter(([path]) => String(path).startsWith("/recurring/calendar?"))).toHaveLength(2);
    });

    it("shows overdue, due today, upcoming, paid and skipped on their own occurrence dates", async () => {
      vi.setSystemTime(new Date(2026, 10, 22, 12));
      const overdue = createMockRecurring({ id: "overdue", name: "Rent", nextDueDate: "2026-11-20" });
      const due = createMockRecurring({ id: "today", name: "Internet", nextDueDate: "2026-11-22" });
      const upcoming = createMockRecurring({ id: "upcoming", name: "Phone", nextDueDate: "2026-11-24" });
      const paid = createMockRecurring({ id: "paid", name: "Insurance", nextDueDate: "2026-12-13" });
      const skipped = createMockRecurring({ id: "skipped", name: "Gym", nextDueDate: "2026-12-15" });
      mockRecurring.mockReturnValue({ data: [overdue, due, upcoming, paid, skipped] });
      mockCalendarRequest.mockResolvedValue({
        success: true,
        data: [
          { id: overdue.id, date: overdue.nextDueDate, status: "overdue", rule: overdue, amount: overdue.amount },
          { id: due.id, date: due.nextDueDate, status: "due", rule: due, amount: due.amount },
          { id: upcoming.id, date: upcoming.nextDueDate, status: "upcoming", rule: upcoming, amount: upcoming.amount },
          { id: "payment", date: "2026-11-13", status: "paid", rule: paid, amount: paid.amount },
          { id: "skip", date: "2026-11-15", status: "skipped", rule: skipped, amount: skipped.amount },
        ],
      });

      renderWithProviders(<Recurring />);
      await screen.findByRole("button", { name: /Rent.*Overdue/ });
      expect(within(screen.getByRole("gridcell", { name: /^Day 22,/ })).getByRole("button", {
        name: /Internet.*Due today/,
      })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Phone.*Upcoming/ })).toBeInTheDocument();
      expect(within(screen.getByRole("gridcell", { name: /^Day 13,/ })).getByRole("button", {
        name: /Insurance.*Paid/,
      })).toBeInTheDocument();
      expect(within(screen.getByRole("gridcell", { name: /^Day 15,/ })).getByRole("button", {
        name: /Gym.*Skipped/,
      })).toBeInTheDocument();
    });

    it("reports calendar status unavailable when the occurrence read fails", async () => {
      mockCalendarRequest.mockRejectedValue(new Error("Unavailable"));
      renderWithProviders(<Recurring />);
      expect(await screen.findByText("Calendar status is unavailable.")).toBeInTheDocument();
      expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    });

    it("renders calendar with day headers", () => {
      renderWithProviders(<Recurring />);
      expect(screen.getByText("Sun")).toBeInTheDocument();
      expect(screen.getByText("Mon")).toBeInTheDocument();
      expect(screen.getByText("Tue")).toBeInTheDocument();
      expect(screen.getByText("Wed")).toBeInTheDocument();
      expect(screen.getByText("Thu")).toBeInTheDocument();
      expect(screen.getByText("Fri")).toBeInTheDocument();
      expect(screen.getByText("Sat")).toBeInTheDocument();
    });

    it("displays current month name", () => {
      renderWithProviders(<Recurring />);
      const today = new Date();
      const monthYear = today.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      });
      expect(screen.getByText(monthYear)).toBeInTheDocument();
    });

    it("has month navigation arrows", () => {
      renderWithProviders(<Recurring />);
      // Should have prev/next month buttons
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThan(2);
    });
  });

  describe("List View", () => {
    it("has view toggle buttons available", () => {
      renderWithProviders(<Recurring />);
      // Calendar view is default - should have day headers
      expect(screen.getByText("Sun")).toBeInTheDocument();
      // Should have multiple buttons for view toggle
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThan(3);
    });
  });

  describe("Summary Sidebar", () => {
    it("displays recurring summary section", () => {
      renderWithProviders(<Recurring />);
      // Summary sidebar should be present with recurring info
      expect(screen.getByText("Upcoming Bills")).toBeInTheDocument();
    });

    it("displays upcoming bills section", () => {
      renderWithProviders(<Recurring />);
      expect(screen.getByText("Upcoming Bills")).toBeInTheDocument();
    });

    it("shows individual upcoming bills", () => {
      renderWithProviders(<Recurring />);
      // Netflix and Spotify should appear in the upcoming bills section
      const netflixElements = screen.getAllByText("Netflix");
      const spotifyElements = screen.getAllByText("Spotify");
      expect(netflixElements.length).toBeGreaterThan(0);
      expect(spotifyElements.length).toBeGreaterThan(0);
    });

    it("has View All button", () => {
      renderWithProviders(<Recurring />);
      expect(screen.getByText("View All")).toBeInTheDocument();
    });
  });

  describe("User Interactions", () => {
    it("opens View All modal when clicked", async () => {
      const user = userEvent.setup();
      renderWithProviders(<Recurring />);

      const viewAllButton = screen.getByText("View All");
      await user.click(viewAllButton);

      await waitFor(() => {
        expect(screen.getByText("All Upcoming Bills")).toBeInTheDocument();
      });
    });

    it("navigates to previous month", async () => {
      const user = userEvent.setup();
      renderWithProviders(<Recurring />);

      const prevButton = screen
        .getAllByRole("button")
        .find((btn) => btn.querySelector('[class*="ChevronLeft"]') !== null);

      if (prevButton) {
        const currentMonth = new Date().toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        });
        expect(screen.getByText(currentMonth)).toBeInTheDocument();

        await user.click(prevButton);

        // Month should change
        const prevMonth = new Date(
          new Date().setMonth(new Date().getMonth() - 1)
        ).toLocaleDateString("en-US", { month: "long", year: "numeric" });
        await waitFor(() => {
          expect(screen.getByText(prevMonth)).toBeInTheDocument();
        });
      }
    });
  });
});
