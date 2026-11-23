/**
 * FIN-01: when the server withholds a goal's progress (another member's
 * private source), the goal detail shows "Progress hidden" and the target,
 * never a 0% bar or a zero amount.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GoalDetailsSection } from "../components/GoalDetailsSection";
import type { Goal } from "../types";

vi.mock("@/hooks/useGoals", () => ({
  useArchiveGoal: () => ({ mutate: vi.fn(), isPending: false }),
  useCompleteGoal: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/components/session/ProtectedImage", () => ({
  ProtectedImage: () => null,
}));

vi.mock("../components/GoalProgressBar", () => ({
  GoalProgressBar: () => <div data-testid="progress-bar" />,
}));

const baseGoal: Goal = {
  id: "goal-1",
  householdId: "h1",
  name: "Family holiday",
  targetAmount: "50000.00",
  currentAmount: "0",
  currency: "ZMW",
  startDate: "2026-10-01",
  type: "save_up",
  status: "on_track",
  isCompleted: false,
  isArchived: false,
  createdAt: "2026-10-01",
  updatedAt: "2026-10-01",
};

function renderSection(goal: Goal) {
  return render(
    <GoalDetailsSection
      goal={goal}
      formatCurrency={(amount) => `K${amount.toFixed(2)}`}
      onEdit={vi.fn()}
      onClose={vi.fn()}
      percentComplete={0}
      progressAmount={0}
      targetAmount={50000}
      remainingAmount={50000}
      usesHoldings={false}
    />,
  );
}

describe("GoalDetailsSection with withheld progress", () => {
  it("shows 'Progress hidden' and the target instead of a zero progress", () => {
    renderSection({ ...baseGoal, progressAvailability: "unavailable" });

    expect(screen.getByText(/Progress hidden/)).toBeInTheDocument();
    expect(screen.getByText("Target: K50000.00")).toBeInTheDocument();
    expect(screen.queryByTestId("progress-bar")).not.toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText("K0.00")).not.toBeInTheDocument();
    expect(screen.queryByText(/Remaining/)).not.toBeInTheDocument();
  });

  it("still shows the progress bar and amounts when progress is available", () => {
    renderSection({ ...baseGoal, progressAvailability: "available" });

    expect(screen.queryByText(/Progress hidden/)).not.toBeInTheDocument();
    expect(screen.getByTestId("progress-bar")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByText("Remaining: K50000.00")).toBeInTheDocument();
  });
});
