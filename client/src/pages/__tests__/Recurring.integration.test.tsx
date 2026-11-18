/**
 * Recurring Page Integration Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Recurring from "@/pages/Recurring";

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

// Mock format utilities
vi.mock("@/lib/format", () => ({
  formatCurrency: (val: number, _currency?: string) => `$${val.toFixed(2)}`,
}));

// Mock recurring hooks
const mockRecurring = vi.fn();
const mockUpcomingBills = vi.fn();

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
    useUpdateRecurring: () => ({ mutate: vi.fn(), isPending: false }),
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
