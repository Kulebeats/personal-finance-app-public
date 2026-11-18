/**
 * Goals Page - /goals/:id deep link test (audit v2 P2 / R12)
 *
 * The dashboard's GoalsWidget (activity items) and GoalHistoryList link to
 * `/goals/:id`. The route already existed in App.tsx's router, but the
 * Goals page never read the `:id` param, so the "deep link" landed on the
 * plain goals list instead of opening the goal. This verifies the page now
 * opens GoalDetailModal for the id in the URL.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Router, Route, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import Goals from "@/pages/Goals";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

const mockUseGoalsData = vi.fn();
vi.mock("@/features/goals/hooks/useGoalsData", () => ({
  useGoalsData: () => mockUseGoalsData(),
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

const mockGoalDetailModal = vi.fn();
vi.mock("@/features/goals/components/GoalDetailModal", () => ({
  GoalDetailModal: (props: { goalId: string; open: boolean }) => {
    mockGoalDetailModal(props);
    return props.open ? (
      <div role="dialog" aria-label="Goal detail">
        Goal detail for {props.goalId}
      </div>
    ) : null;
  },
}));

function renderGoalsAt(initialPath: string) {
  const { hook, searchHook } = memoryLocation({ path: initialPath, record: true });
  return render(
    <Router hook={hook} searchHook={searchHook}>
      <Switch>
        <Route path="/goals" component={Goals} />
        <Route path="/goals/:id" component={Goals} />
      </Switch>
    </Router>,
  );
}

describe("Goals page /goals/:id deep link (R12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseGoalsData.mockReturnValue({
      isLoading: false,
      error: null,
      saveUpGoals: [],
      payDownGoals: [],
    });
  });

  it("opens the goal detail modal for the id in the URL", async () => {
    renderGoalsAt("/goals/goal-42");

    await waitFor(() => {
      expect(screen.getByText("Goal detail for goal-42")).toBeInTheDocument();
    });
  });

  it("does not open the detail modal when there is no id in the URL", () => {
    renderGoalsAt("/goals");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
