import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import GoalsWidget from "../GoalsWidget";
import { useGoalsSummary } from "@/hooks/useGoals";

vi.mock("@/hooks/useGoals", () => ({
  useGoalsSummary: vi.fn(),
}));

vi.mock("@/contexts/SettingsContext", () => ({
  useFormatters: () => ({
    formatCurrency: (val: number) => `$${val.toLocaleString()}`,
  }),
}));

const mockedUseGoalsSummary = vi.mocked(useGoalsSummary);

describe("GoalsWidget", () => {
  const summary = {
    saveUp: {
      total: 1,
      onTrack: 1,
      behind: 0,
      atRisk: 0,
      completed: 0,
      totalSaved: 100,
      totalTarget: 500,
      overallProgress: 20,
    },
    payDown: {
      total: 1,
      totalDebt: 1000,
      totalPaid: 200,
      projectedInterest: 0,
      onTrack: 0,
      behind: 1,
    },
    recentActivity: [
      {
        goalId: "goal-42",
        goalName: "Emergency Fund",
        activityType: "contribution_added",
        amount: 50,
        createdAt: new Date().toISOString(),
      },
    ],
    upcomingMilestones: [],
  };

  it("links each recent activity item to its goal detail page (audit v2 P2)", () => {
    mockedUseGoalsSummary.mockReturnValue({
      data: summary,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useGoalsSummary>);

    render(<GoalsWidget />);

    const activityLink = screen.getByRole("link", {
      name: /emergency fund/i,
    });
    expect(activityLink).toHaveAttribute("href", "/goals/goal-42");
  });

  it("links the Save Up and Pay Down gauges to the Goals page", () => {
    mockedUseGoalsSummary.mockReturnValue({
      data: summary,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useGoalsSummary>);

    render(<GoalsWidget />);

    const saveUpLink = screen.getByRole("link", { name: /save up/i });
    expect(saveUpLink).toHaveAttribute("href", "/goals");

    const payDownLink = screen.getByRole("link", { name: /pay down/i });
    expect(payDownLink).toHaveAttribute("href", "/goals");
  });
});
