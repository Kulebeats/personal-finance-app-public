/**
 * CashFlowDrilldownPanel Tests
 *
 * Verifies the panel shown when a Cash Flow Sankey node is selected now
 * navigates to a correctly filtered Transactions view instead of showing the
 * old "Click to view transaction details." placeholder (audit v2 finding
 * B3). RED (pre-fix) behavior: the panel rendered static text with no
 * action. GREEN (this component): a real "View transactions" button that
 * calls `useDrillDown` with the right filters, or an explicit
 * not-drillable message for derived totals (savings/refunds) that have no
 * transaction-level equivalent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CashFlowDrilldownPanel } from "../CashFlowDrilldownPanel";

const mockDrillDown = vi.fn();
vi.mock("@/hooks/use-drilldown", () => ({
  useDrillDown: () => ({ drillDown: mockDrillDown }),
}));

const dateRange = { from: "2026-01-01", to: "2026-12-31" };

describe("CashFlowDrilldownPanel", () => {
  beforeEach(() => {
    mockDrillDown.mockClear();
  });

  it("renders nothing when no node is selected", () => {
    const { container } = render(
      <CashFlowDrilldownPanel node={null} dateRange={dateRange} onClear={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("no longer shows the old non-functional placeholder text", () => {
    render(
      <CashFlowDrilldownPanel
        node={{ label: "Groceries", entityType: "category", entityId: "cat-1" }}
        dateRange={dateRange}
        onClear={vi.fn()}
      />,
    );
    expect(
      screen.queryByText(/Click to view transaction details/i),
    ).not.toBeInTheDocument();
  });

  it("navigates to transactions filtered by categoryId when a category node's button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <CashFlowDrilldownPanel
        node={{ label: "Groceries", entityType: "category", entityId: "cat-1" }}
        dateRange={dateRange}
        onClear={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /view transactions/i }));

    expect(mockDrillDown).toHaveBeenCalledWith({
      categoryId: "cat-1",
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });

  it("navigates filtered by accountId for an account node", async () => {
    const user = userEvent.setup();
    render(
      <CashFlowDrilldownPanel
        node={{ label: "Checking", entityType: "account", entityId: "acc-9" }}
        dateRange={dateRange}
        onClear={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /view transactions/i }));

    expect(mockDrillDown).toHaveBeenCalledWith({
      accountId: "acc-9",
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });

  it("navigates filtered by type=expense for a categoryGroup node", async () => {
    const user = userEvent.setup();
    render(
      <CashFlowDrilldownPanel
        node={{ label: "Housing", entityType: "categoryGroup", entityId: "grp-1" }}
        dateRange={dateRange}
        onClear={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /view transactions/i }));

    expect(mockDrillDown).toHaveBeenCalledWith({
      type: "expense",
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });

  it("navigates filtered by type=income for the synthetic income node", async () => {
    const user = userEvent.setup();
    render(
      <CashFlowDrilldownPanel
        node={{ label: "Income", entityType: "synthetic", entityId: "income" }}
        dateRange={dateRange}
        onClear={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /view transactions/i }));

    expect(mockDrillDown).toHaveBeenCalledWith({
      type: "income",
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });

  it("shows a not-drillable message with no button for the synthetic savings node", () => {
    render(
      <CashFlowDrilldownPanel
        node={{ label: "Savings", entityType: "synthetic", entityId: "savings" }}
        dateRange={dateRange}
        onClear={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /view transactions/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/isn't linked to individual transactions/i)).toBeInTheDocument();
  });

  it("calls onClear when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(
      <CashFlowDrilldownPanel
        node={{ label: "Groceries", entityType: "category", entityId: "cat-1" }}
        dateRange={dateRange}
        onClear={onClear}
      />,
    );

    await user.click(screen.getByRole("button", { name: /clear selected category/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("renders the node label", () => {
    render(
      <CashFlowDrilldownPanel
        node={{ label: "Groceries", entityType: "category", entityId: "cat-1" }}
        dateRange={dateRange}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText("Groceries")).toBeInTheDocument();
  });
});
