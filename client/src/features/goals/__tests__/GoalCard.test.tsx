import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { GoalCard } from "../components/GoalCard";
import type { Goal } from "../types";

// Mock useFormatters
vi.mock("@/contexts/SettingsContext", () => ({
  useFormatters: () => ({
    formatCurrency: (val: number | string) => `$${val}`,
  }),
}));

// Mock GoalStatusBadge (optional, but good for isolation if complex)
vi.mock("../components/GoalStatusBadge", () => ({
  GoalStatusBadge: ({ status }: { status: string }) => (
    <div data-testid="status-badge">{status}</div>
  ),
}));

// Mock GoalProgressBar
vi.mock("../components/GoalProgressBar", () => ({
  GoalProgressBar: ({
    current,
    target,
  }: {
    current: number;
    target: number;
  }) => (
    <div
      data-testid="progress-bar"
      data-current={current}
      data-target={target}
    />
  ),
}));

const mockSaveUpGoal: Goal = {
  id: "1",
  householdId: "h1",
  name: "Vacation",
  targetAmount: "1000",
  currentAmount: "250",
  currency: "USD",
  startDate: "2023-01-01",
  type: "save_up",
  status: "on_track",
  isCompleted: false,
  isArchived: false,
  createdAt: "2023-01-01",
  updatedAt: "2023-01-01",
  goalType: "vacation",
};

const mockPayDownGoal: Goal = {
  id: "2",
  householdId: "h1",
  name: "Credit Card",
  targetAmount: "5000",
  currentAmount: "4000",
  currency: "USD",
  startDate: "2023-01-01",
  type: "pay_down",
  status: "behind",
  isCompleted: false,
  isArchived: false,
  createdAt: "2023-01-01",
  updatedAt: "2023-01-01",
  goalType: "credit_card",
};

describe("GoalCard", () => {
  it("renders safe_up goal details accurately", () => {
    render(<GoalCard goal={mockSaveUpGoal} />);
    expect(screen.getByText("Vacation")).toBeInTheDocument();
    expect(screen.getByText("Save Up")).toBeInTheDocument();
    expect(screen.getByText("Saved")).toBeInTheDocument();
    // 250 / 1000 = 25%
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByTestId("status-badge")).toHaveTextContent("on_track");
    expect(screen.getByText("$250")).toBeInTheDocument(); // Saved amount
    expect(screen.getByText("$1000")).toBeInTheDocument(); // Target amount
  });

  it("renders pay_down goal details accurately", () => {
    render(<GoalCard goal={mockPayDownGoal} />);
    expect(screen.getByText("Credit Card")).toBeInTheDocument();
    expect(screen.getByText("Pay Down")).toBeInTheDocument();
    expect(screen.getByText("Remaining")).toBeInTheDocument(); // Different label
    // Pay down is calculated differently?
    // In GoalCard logic: isPayDown ? (originalBalance ? ... : 0) : (current/target)
    // Wait, the logic for PayDown progress in GoalCard.tsx:
    // const progress = isPayDown ? goal.originalBalance ? ... : 0 : (current/target)
    // If originalBalance is missing, progress is 0.
    // Let's add originalBalance to mockPayDownGoal if we want to test progress logic or assert 0%.

    // In this case render, it should show 0% if originalBalance is missing.
    // Or simpler, check that "Pay Down" text exists.
    expect(screen.getByText("Pay Down")).toBeInTheDocument();
    expect(screen.getByText("$4000")).toBeInTheDocument(); // Current amount is debt remaining
  });

  it("calls onClick handler when clicked", () => {
    const handleClick = vi.fn();
    const { container } = render(
      <GoalCard goal={mockSaveUpGoal} onClick={handleClick} />
    );
    // The Card component spreads props to the div.
    // We can assume the first child of container is the Card div.
    if (container.firstChild) {
      fireEvent.click(container.firstChild as Element);
      expect(handleClick).toHaveBeenCalledTimes(1);
    } else {
      throw new Error("Card container not found");
    }
  });
});
