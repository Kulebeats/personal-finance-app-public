import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OverfundConfirm, needsOverfundConfirm } from "../components/OverfundConfirm";

/** #245 review P1-1: when the transfer modal must ask before money moves into a goal. */
describe("needsOverfundConfirm", () => {
  const goal = { id: "goal-1", type: "save_up", currentAmount: "90.00", targetAmount: "100.00" };

  it("asks only when the amount takes a visible goal past its target", () => {
    expect([needsOverfundConfirm(goal, "10.00"), needsOverfundConfirm(goal, "10.01")]).toEqual([false, true]);
  });

  it("adds in exact decimal: 0.10 + 0.20 reaches a 0.30 target without passing it", () => {
    const small = { id: "goal-3", type: "save_up", currentAmount: "0.10", targetAmount: "0.30" };
    expect([needsOverfundConfirm(small, "0.20"), needsOverfundConfirm(small, "0.21")]).toEqual([false, true]);
  });

  it("always asks for a goal whose progress is hidden, whatever the amount", () => {
    const hidden = { id: "goal-2", type: "save_up", targetAmount: "100.00", currentAmount: null,
      progressAvailability: "unavailable" as const };
    expect(needsOverfundConfirm(hidden, "1.00")).toBe(true);
  });

  it("never asks for a debt goal or when no goal is chosen", () => {
    expect(needsOverfundConfirm({ ...goal, type: "pay_down" }, "500.00")).toBe(false);
    expect(needsOverfundConfirm(undefined, "500.00")).toBe(false);
  });
});

describe("OverfundConfirm", () => {
  it("tells a member why a hidden goal needs confirming without stating its progress", () => {
    render(<OverfundConfirm goal={{ id: "goal-2", progressAvailability: "unavailable" }} checked={false} onCheckedChange={() => undefined} />);
    expect(screen.getByLabelText(/sources you can't see/)).toBeInTheDocument();
  });
});
