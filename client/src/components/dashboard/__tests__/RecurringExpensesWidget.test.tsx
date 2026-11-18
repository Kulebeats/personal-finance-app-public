import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import RecurringExpensesWidget from "../RecurringExpensesWidget";
import { useUpcomingBills } from "@/hooks/useRecurring";

vi.mock("@/hooks/useRecurring", () => ({
  useUpcomingBills: vi.fn(),
}));

vi.mock("@/contexts/SettingsContext", () => ({
  useFormatters: () => ({
    formatCurrency: (val: number) => `$${val.toLocaleString()}`,
  }),
}));

const mockedUseUpcomingBills = vi.mocked(useUpcomingBills);

function renderAt(initialPath: string) {
  const { hook, searchHook, history } = memoryLocation({
    path: initialPath,
    record: true,
  });
  render(
    <Router hook={hook} searchHook={searchHook}>
      <RecurringExpensesWidget />
    </Router>,
  );
  return { history: history! };
}

describe("RecurringExpensesWidget", () => {
  const bill = {
    id: "rec-1",
    name: "Netflix",
    amount: { amount: "15.99", currency: "USD" },
    nextDueDate: new Date().toISOString(),
  };

  it("navigates to the recurring rule deep link when an upcoming bill row is clicked (audit v2 P2)", () => {
    mockedUseUpcomingBills.mockReturnValue({
      data: [bill],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useUpcomingBills>);

    const { history } = renderAt("/");

    const row = screen.getByRole("button", { name: /netflix/i });
    fireEvent.click(row);

    expect(history[history.length - 1]).toBe("/recurring?ruleId=rec-1");
  });

  it("is keyboard accessible", () => {
    mockedUseUpcomingBills.mockReturnValue({
      data: [bill],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useUpcomingBills>);

    renderAt("/");

    const row = screen.getByRole("button", { name: /netflix/i });
    expect(row.tagName).toBe("BUTTON");
  });
});
