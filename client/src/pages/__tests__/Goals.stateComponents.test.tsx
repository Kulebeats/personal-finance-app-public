/**
 * Goals Page - loading and error states (audit v2 P7b finding #2)
 *
 * Goals.tsx used to render a plain "Loading goals..." string and a bare
 * error message with no retry, inconsistent with sibling pages
 * (Budget/Recurring/CashFlow, and now Reports - see Reports.errorState.test).
 * This proves the page now shows a real skeleton while loading and a real
 * error state (reusing the shared WidgetErrorState component) with a
 * working retry that refetches the goals query.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Goals from "@/pages/Goals";

const mockUseGoalsData = vi.fn();
vi.mock("@/features/goals/hooks/useGoalsData", () => ({
  useGoalsData: () => mockUseGoalsData(),
}));

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

vi.mock("@/features/goals/components/GoalList", () => ({
  GoalList: () => <div data-testid="goal-list" />,
}));

vi.mock("@/features/goals/components/GoalTransferModal", () => ({
  GoalTransferModal: () => null,
}));

vi.mock("@/features/goals/components/GoalAccountsModal", () => ({
  GoalAccountsModal: () => null,
}));

vi.mock("@/features/goals/components/GoalCreationWizard", () => ({
  GoalCreationWizard: () => null,
}));

vi.mock("@/features/goals/components/GoalDetailModal", () => ({
  GoalDetailModal: () => null,
}));

// Goals is rendered outside a Router in some other tests via wouter's
// useParams default context, but this page also calls useParams() directly -
// no Router wrapper needed for the default "/" match in jsdom's location.

describe("Goals page loading and error states", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a skeleton loading state instead of a bare loading string while goals are loading", () => {
    mockUseGoalsData.mockReturnValue({
      isLoading: true,
      error: null,
      refetch: vi.fn(),
      saveUpGoals: [],
      payDownGoals: [],
    });

    render(<Goals />);

    expect(
      screen.getByRole("status", { name: /loading goals/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading goals...")).not.toBeInTheDocument();
    expect(screen.queryByTestId("goal-list")).not.toBeInTheDocument();
  });

  it("shows an announced error state with a retry button instead of a bare error string", async () => {
    const refetch = vi.fn();
    mockUseGoalsData.mockReturnValue({
      isLoading: false,
      error: new Error("Network unreachable"),
      refetch,
      saveUpGoals: [],
      payDownGoals: [],
    });

    render(<Goals />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Network unreachable");
    expect(
      screen.queryByText("Failed to load goals. Please try again later."),
    ).not.toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: /try again/i });
    await user.click(retryButton);

    await waitFor(() => {
      expect(refetch).toHaveBeenCalledTimes(1);
    });
  });

  it("renders the goal list once loaded without error", () => {
    mockUseGoalsData.mockReturnValue({
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      saveUpGoals: [],
      payDownGoals: [],
    });

    render(<Goals />);

    expect(screen.getByTestId("goal-list")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
