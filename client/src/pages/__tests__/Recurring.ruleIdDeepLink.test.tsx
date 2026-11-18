/**
 * Recurring Page - ruleId deep-link test (audit v2 P2 / R12)
 *
 * The dashboard's RecurringExpensesWidget navigates to
 * `/recurring?ruleId=<id>` for a specific upcoming bill. This verifies the
 * Recurring page actually consumes that param and opens the edit modal for
 * the matching rule, so the deep link isn't just a URL that lands on the
 * plain list (CLAUDE.md End-to-End Tracing Rule).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import Recurring from "@/pages/Recurring";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

vi.mock("@/components/transactions/AddTransactionModal", () => ({
  AddTransactionModal: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/contexts/SettingsContext", () => ({
  useSettings: () => ({ currency: "USD" }),
  useFormatters: () => ({ currency: "USD" }),
}));

vi.mock("@/lib/format", () => ({
  formatCurrency: (val: number, _currency?: string) => `$${val.toFixed(2)}`,
}));

const mockRecurring = vi.fn();
const mockUpcomingBills = vi.fn();

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
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

function renderRecurringAt(initialPath: string) {
  const queryClient = createQueryClient();
  const { hook, searchHook } = memoryLocation({ path: initialPath, record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <Recurring />
      </Router>
    </QueryClientProvider>,
  );
}

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

describe("Recurring page ruleId deep link (R12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecurring.mockReturnValue({
      data: [
        createMockRecurring({ id: "rec-1", name: "Netflix" }),
        createMockRecurring({ id: "rec-2", name: "Spotify" }),
      ],
      isLoading: false,
      error: null,
    });
    mockUpcomingBills.mockReturnValue({ data: [] });
  });

  it("opens the edit modal for the rule matching ?ruleId= on mount", async () => {
    renderRecurringAt("/recurring?ruleId=rec-2");

    await waitFor(() => {
      expect(screen.getByText("Edit Recurring Transaction")).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("Spotify")).toBeInTheDocument();
  });

  it("does not open the edit modal when there is no ruleId param", () => {
    renderRecurringAt("/recurring");

    expect(
      screen.queryByText("Edit Recurring Transaction"),
    ).not.toBeInTheDocument();
  });

  it("ignores a ruleId that does not match any recurring rule", () => {
    renderRecurringAt("/recurring?ruleId=does-not-exist");

    expect(
      screen.queryByText("Edit Recurring Transaction"),
    ).not.toBeInTheDocument();
  });
});
