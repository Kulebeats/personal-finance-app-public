/**
 * Budget Page Integration Tests
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Budget from "@/pages/Budget";

// Mock wouter
vi.mock("wouter", () => ({
  useLocation: () => ["/budget", vi.fn()],
}));

// Mock Layout
vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

// Mock formatters
vi.mock("@/contexts/SettingsContext", () => ({
  useFormatters: () => ({
    formatCurrency: (val: number) => `$${val.toFixed(2)}`,
    currency: "USD",
  }),
}));

// Mock mobile hook
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

// Mock budget hooks
const mockBudgetProgress = vi.fn();
const mockBudgetSettings = vi.fn();
const mockCategories = vi.fn();
const mockGoals = vi.fn();

vi.mock("@/hooks/useBudgets", () => ({
  // BudgetDetailModal's useBudgetCategoryHistory hook builds its query keys
  // off the real `budgetKeys.progress` shape, so the mock must keep it
  // (even though these tests never open the modal, the hook still runs).
  // Inlined here (rather than a top-level const) because vi.mock factories
  // are hoisted above other module-scope declarations.
  budgetKeys: {
    all: ["budgets"] as const,
    progress: (year: number, month: number) =>
      ["budgets", "progress", year, month] as const,
  },
  useBudgetProgress: () => mockBudgetProgress(),
  useBudgetSettings: () => mockBudgetSettings(),
  useUpdateBudgetSettings: () => ({ mutate: vi.fn(), isPending: false }),
  useRecalculateBudgets: () => ({ mutate: vi.fn(), isPending: false }),
  useClearBudgets: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateBudget: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateBudget: () => ({ mutate: vi.fn(), isPending: false }),
  useBudgetForecast: () => ({ data: null, isLoading: false }),
  useUpdateBudgetForecast: () => ({ mutate: vi.fn(), isPending: false }),
  useMoveBudgetAmount: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/use-settings", () => ({
  useCategories: () => mockCategories(),
}));

vi.mock("@/hooks/useGoals", () => ({
  useGoals: () => mockGoals(),
}));

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

describe("Budget Page Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock responses
    mockBudgetProgress.mockReturnValue({
      data: [
        {
          id: "b1",
          name: "Groceries",
          amount: "500",
          spent: 350,
          remaining: 150,
          categoryId: "c1",
        },
        {
          id: "b2",
          name: "Rent",
          amount: "1500",
          spent: 1500,
          remaining: 0,
          categoryId: "c2",
        },
      ],
      isLoading: false,
      error: null,
    });

    mockBudgetSettings.mockReturnValue({
      data: { budgetSystem: "flex", defaultApplyScope: "all_future" },
    });

    mockCategories.mockReturnValue({
      data: {
        categories: [
          {
            id: "c1",
            name: "Groceries",
            groupId: "g1",
            displayOrder: 1,
            includeInBudget: true,
          },
          {
            id: "c2",
            name: "Rent",
            groupId: "g2",
            displayOrder: 1,
            includeInBudget: true,
          },
        ],
        groups: [
          { id: "g1", name: "Food", type: "expense", displayOrder: 1 },
          { id: "g2", name: "Housing", type: "expense", displayOrder: 2 },
        ],
      },
      isLoading: false,
    });

    mockGoals.mockReturnValue({
      data: [],
    });
  });

  describe("Loading States", () => {
    it("shows loading spinner while fetching budgets", () => {
      mockBudgetProgress.mockReturnValue({
        data: null,
        isLoading: true,
        error: null,
      });
      renderWithProviders(<Budget />);
      expect(screen.getByText("Loading budgets...")).toBeInTheDocument();
    });

    it("shows error state when fetch fails", () => {
      mockBudgetProgress.mockReturnValue({
        data: null,
        isLoading: false,
        error: new Error("Network error"),
      });
      renderWithProviders(<Budget />);
      expect(screen.getByText("Failed to load budgets")).toBeInTheDocument();
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });

    it("shows empty state when no categories exist", () => {
      mockCategories.mockReturnValue({
        data: { categories: [], groups: [] },
        isLoading: false,
      });
      renderWithProviders(<Budget />);
      expect(
        screen.getByText("Create categories to start budgeting")
      ).toBeInTheDocument();
    });
  });

  describe("Header Navigation", () => {
    it("displays current month/year in header", () => {
      renderWithProviders(<Budget />);
      const today = new Date();
      const monthYear = today.toLocaleString("en-US", {
        month: "long",
        year: "numeric",
      });
      expect(screen.getByText(monthYear)).toBeInTheDocument();
    });

    it("has Budget/Forecast view toggle", () => {
      renderWithProviders(<Budget />);
      // Exact name avoids colliding with the "Flexible budget group" header,
      // which is a role="button" element whose label also contains "budget".
      expect(
        screen.getByRole("button", { name: "Budget" })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /forecast/i })
      ).toBeInTheDocument();
    });

    it("has Monthly/Yearly timeframe toggle", () => {
      renderWithProviders(<Budget />);
      expect(
        screen.getByRole("button", { name: /monthly/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /yearly/i })
      ).toBeInTheDocument();
    });

    it("has Settings button", () => {
      renderWithProviders(<Budget />);
      expect(
        screen.getByRole("button", { name: /settings/i })
      ).toBeInTheDocument();
    });
  });

  describe("Budget Sections", () => {
    it("renders Income section", () => {
      renderWithProviders(<Budget />);
      expect(screen.getAllByText("Income").length).toBeGreaterThan(0);
    });

    it("renders Expenses section", () => {
      renderWithProviders(<Budget />);
      expect(screen.getAllByText("Expenses").length).toBeGreaterThan(0);
    });

    it("renders table headers", () => {
      renderWithProviders(<Budget />);
      const headerLabel = screen.getByText("Category");
      const headerRow = headerLabel.parentElement?.parentElement;
      expect(headerRow).not.toBeNull();
      if (!headerRow) return;
      const headerScope = within(headerRow);
      expect(headerScope.getByText("Category")).toBeInTheDocument();
      expect(headerScope.getByText("Budget")).toBeInTheDocument();
      expect(headerScope.getByText("Actual")).toBeInTheDocument();
      expect(headerScope.getByText("Remaining")).toBeInTheDocument();
    });
  });

  describe("Summary Card", () => {
    it("displays Left to Budget section", () => {
      renderWithProviders(<Budget />);
      expect(screen.getByText(/left to budget/i)).toBeInTheDocument();
    });

    it("has navigation controls", () => {
      renderWithProviders(<Budget />);
      // Should have multiple buttons for navigation
      const allButtons = screen.getAllByRole("button");
      expect(allButtons.length).toBeGreaterThan(5);
    });
  });

  describe("User Interactions", () => {
    it("has Budget and Forecast view buttons", () => {
      renderWithProviders(<Budget />);
      // Exact name avoids colliding with the "Flexible budget group" header,
      // which is a role="button" element whose label also contains "budget".
      expect(
        screen.getByRole("button", { name: "Budget" })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /forecast/i })
      ).toBeInTheDocument();
    });

    it("has Monthly and Yearly timeframe buttons", () => {
      renderWithProviders(<Budget />);
      expect(
        screen.getByRole("button", { name: /monthly/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /yearly/i })
      ).toBeInTheDocument();
    });
  });
});
