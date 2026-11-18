import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useGoalsData } from "../hooks/useGoalsData";
import { useGoals, useGoalsSummary } from "@/hooks/useGoals";

// Mock the hooks
vi.mock("@/hooks/useGoals", () => ({
  useGoals: vi.fn(),
  useGoalsSummary: vi.fn(),
}));

describe("useGoalsData", () => {
  it("returns filtered and sorted goals", () => {
    const mockGoals = [
      { id: "1", type: "save_up", name: "B", priority: 2, status: "on_track" },
      { id: "2", type: "save_up", name: "A", priority: 1, status: "behind" },
      { id: "3", type: "pay_down", name: "C", priority: 1, status: "on_track" },
    ];

    (useGoals as any).mockReturnValue({
      data: mockGoals,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    (useGoalsSummary as any).mockReturnValue({
      data: { saveUp: {}, payDown: {} },
      isLoading: false,
    });

    const { result } = renderHook(() => useGoalsData());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.saveUpGoals).toHaveLength(2);
    expect(result.current.payDownGoals).toHaveLength(1);

    // Check sorting (Priority 1 comes first)
    expect(result.current.saveUpGoals[0].id).toBe("2");
    expect(result.current.saveUpGoals[1].id).toBe("1");

    // Check Goals On Track count (2 goals are filtered?? No, count logic: status === 'on_track' or 'completed')
    // Goal 1 (on_track), Goal 3 (on_track). Total 2.
    expect(result.current.goalsOnTrack).toBe(2);
  });

  it("handles loading state", () => {
    (useGoals as any).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });
    (useGoalsSummary as any).mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    const { result } = renderHook(() => useGoalsData());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.saveUpGoals).toHaveLength(0);
  });
});
