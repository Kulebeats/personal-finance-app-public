/**
 * BudgetDetailModal Unit Tests (R11 - audit v2 finding B4)
 *
 * The modal used to render a hardcoded 6-month chart and a fabricated
 * "Associated Account" (a fake card number), and had no path to the
 * transactions behind a category's spend. This suite asserts:
 *   (a) the modal renders REAL injected category-spend history and the
 *       old hardcoded chart/account values are gone, and
 *   (b) "View transactions" deep-links to the Transactions page filtered
 *       to this category + the budget period, via the R8 URL contract.
 */
import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BudgetDetailModal } from "../components/BudgetDetailModal";
import type { SelectedItem, BudgetGroup, BudgetCategory } from "../types";

const mockNavigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/budget", mockNavigate],
}));

vi.mock("@/contexts/SettingsContext", () => ({
  useFormatters: () => ({
    formatCurrency: (val: number) => `$${val.toString()}`,
  }),
}));

const mockUseBudgetCategoryHistory = vi.fn();
vi.mock("../hooks/useBudgetCategoryHistory", () => ({
  useBudgetCategoryHistory: (...args: unknown[]) =>
    mockUseBudgetCategoryHistory(...args),
}));

function MockIcon() {
  return <span data-testid="mock-icon">$</span>;
}

function createSelected(overrides: Partial<SelectedItem> = {}): SelectedItem {
  return {
    groupId: "grp-1",
    itemId: "cat-1",
    groupName: "Food",
    item: {
      id: "cat-1",
      name: "Groceries",
      icon: MockIcon,
      budget: 500,
      actual: 350,
      remaining: 150,
      budgetId: "b1",
    },
    ...overrides,
  };
}

const REAL_POINTS = [
  { year: 2026, month: 2, label: "FEB", actual: 410 },
  { year: 2026, month: 3, label: "MAR", actual: 522 },
  { year: 2026, month: 4, label: "APR", actual: 298 },
  { year: 2026, month: 5, label: "MAY", actual: 610 },
  { year: 2026, month: 6, label: "JUN", actual: 355 },
  { year: 2026, month: 7, label: "JUL", actual: 350 },
];

describe("BudgetDetailModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBudgetCategoryHistory.mockReturnValue({
      points: REAL_POINTS,
      isLoading: false,
      isError: false,
      hasData: true,
      average: 424.17,
    });
  });

  it("renders nothing when no item is selected", () => {
    const { container } = render(
      <BudgetDetailModal
        selected={null}
        year={2026}
        month={7}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the real injected category-spend history and drops the old fabricated chart/account values", () => {
    render(
      <BudgetDetailModal
        selected={createSelected()}
        year={2026}
        month={7}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    // The hook is asked for this category's history over the viewed period.
    expect(mockUseBudgetCategoryHistory).toHaveBeenCalledWith(
      "cat-1",
      2026,
      7,
    );

    // Real, injected values are shown (MAR actual + the injected average).
    expect(screen.getByText("$522")).toBeInTheDocument();
    expect(screen.getByText("$424.17")).toBeInTheDocument();

    // The old hardcoded mock chart values (JAN-JUN, 8500/9200/8800/9750/9100/9000)
    // and the fabricated "Chase Sapphire Reserve" account line are gone.
    expect(screen.queryByText("$8500")).not.toBeInTheDocument();
    expect(screen.queryByText("$9750")).not.toBeInTheDocument();
    expect(screen.queryByText("$9000")).not.toBeInTheDocument();
    expect(screen.queryByText(/Chase Sapphire Reserve/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/4242/)).not.toBeInTheDocument();
  });

  it("renders an honest empty state instead of fake numbers when there is no real spend history", () => {
    mockUseBudgetCategoryHistory.mockReturnValue({
      points: REAL_POINTS.map((p) => ({ ...p, actual: null })),
      isLoading: false,
      isError: false,
      hasData: false,
      average: null,
    });

    render(
      <BudgetDetailModal
        selected={createSelected()}
        year={2026}
        month={7}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    expect(screen.getByTestId("budget-history-empty-state")).toHaveTextContent("Spending history is unavailable");
    expect(screen.queryByText("$8500")).not.toBeInTheDocument();
  });

  it("navigates to the category's transactions filtered to this category and the budget period", () => {
    render(
      <BudgetDetailModal
        selected={createSelected()}
        year={2026}
        month={7}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /view transactions/i }),
    );

    expect(mockNavigate).toHaveBeenCalledWith(
      "/transactions?categoryId=cat-1&from=2026-07-01&to=2026-07-31",
    );
  });

  it("navigates using the selected item's own categoryId even for a different month/year", () => {
    render(
      <BudgetDetailModal
        selected={createSelected({
          itemId: "cat-9",
          item: {
            id: "cat-9",
            name: "Utilities",
            icon: MockIcon,
            budget: 200,
            actual: 100,
            remaining: 100,
          },
        })}
        year={2025}
        month={2}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /view transactions/i }),
    );

    expect(mockNavigate).toHaveBeenCalledWith(
      "/transactions?categoryId=cat-9&from=2025-02-01&to=2025-02-28",
    );
  });

  describe("editing the budget amount", () => {
    // Mirrors the Budget page: `selected` is the snapshot taken when the row
    // was clicked, while onUpdate only changes the live groups.
    function Harness({
      onCommitBudget,
    }: {
      onCommitBudget: (
        item: BudgetCategory,
        group: BudgetGroup,
        value: number,
      ) => Promise<boolean>;
    }) {
      const snapshot = createSelected();
      const [groups, setGroups] = useState<BudgetGroup[]>([
        { id: "grp-1", name: "Food", type: "expense", items: [snapshot.item] },
      ]);
      return (
        <BudgetDetailModal
          selected={snapshot}
          groups={groups}
          year={2026}
          month={7}
          onClose={vi.fn()}
          onUpdate={(groupId, itemId, field, value) =>
            setGroups((prev) =>
              prev.map((g) =>
                g.id !== groupId
                  ? g
                  : {
                      ...g,
                      items: g.items.map((i) =>
                        i.id === itemId ? { ...i, [field]: value } : i,
                      ),
                    },
              ),
            )
          }
          onCommitBudget={onCommitBudget}
        />
      );
    }

    it("shows the typed amount and commits it on blur", async () => {
      const user = userEvent.setup();
      const onCommitBudget = vi.fn().mockResolvedValue(true);
      render(<Harness onCommitBudget={onCommitBudget} />);

      const input = screen.getByDisplayValue("500");
      await user.clear(input);
      await user.type(input, "750");
      expect(input).toHaveValue("750");

      await user.tab();
      expect(onCommitBudget).toHaveBeenCalledTimes(1);
      expect(onCommitBudget).toHaveBeenCalledWith(
        expect.objectContaining({ id: "cat-1", budgetId: "b1" }),
        expect.objectContaining({ id: "grp-1" }),
        750,
      );
    });

    it("does not commit when the amount is unchanged", async () => {
      const user = userEvent.setup();
      const onCommitBudget = vi.fn();
      render(<Harness onCommitBudget={onCommitBudget} />);

      await user.click(screen.getByDisplayValue("500"));
      await user.tab();
      expect(onCommitBudget).not.toHaveBeenCalled();
    });

    it("commits a return to the original amount after another amount was saved", async () => {
      const user = userEvent.setup();
      const onCommitBudget = vi.fn().mockResolvedValue(true);
      render(<Harness onCommitBudget={onCommitBudget} />);

      const input = screen.getByDisplayValue("500");
      await user.clear(input);
      await user.type(input, "750");
      await user.tab();
      await user.clear(input);
      await user.type(input, "500");
      await user.tab();

      expect(onCommitBudget.mock.calls.map((call) => call[2])).toEqual([750, 500]);
    });

    it("does not re-commit when blurring an amount that was already saved", async () => {
      const user = userEvent.setup();
      const onCommitBudget = vi.fn().mockResolvedValue(true);
      render(<Harness onCommitBudget={onCommitBudget} />);

      const input = screen.getByDisplayValue("500");
      await user.clear(input);
      await user.type(input, "750");
      await user.tab();
      await user.click(input);
      await user.tab();

      expect(onCommitBudget).toHaveBeenCalledTimes(1);
    });

    // A-17: the commit opens the scope chooser. Cancelling it saves nothing,
    // so typing the same amount again must reopen it, not be skipped.
    it("commits the same amount again after the scope dialog was cancelled", async () => {
      const user = userEvent.setup();
      const onCommitBudget = vi.fn().mockResolvedValue(false);
      render(<Harness onCommitBudget={onCommitBudget} />);

      const input = screen.getByDisplayValue("500");
      await user.clear(input);
      await user.type(input, "750");
      await user.tab();
      await user.clear(input);
      await user.type(input, "750");
      await user.tab();

      expect(onCommitBudget.mock.calls.map((call) => call[2])).toEqual([750, 750]);
    });
  });
});
