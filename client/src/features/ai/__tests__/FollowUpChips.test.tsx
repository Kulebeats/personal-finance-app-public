/**
 * FollowUpChips — after an answer, tappable next questions that fit what the
 * answer drew on, so the conversation can carry on with one tap.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FollowUpChips, followUpsFor } from "../components/FollowUpChips";

describe("followUpsFor", () => {
  it("offers next questions that fit the data the answer used", () => {
    const followUps = followUpsFor(["get_account_balances"]);

    expect(followUps.length).toBeGreaterThanOrEqual(2);
    expect(followUps.length).toBeLessThanOrEqual(3);
  });

  it("never repeats a question and never offers more than three", () => {
    const followUps = followUpsFor(["get_account_balances", "get_spending_by_category", "get_goals_status", "get_cash_flow"]);

    expect(new Set(followUps).size).toBe(followUps.length);
    expect(followUps.length).toBeLessThanOrEqual(3);
  });

  it("offers general next questions when the answer used no data", () => {
    expect(followUpsFor([]).length).toBeGreaterThanOrEqual(2);
  });
});

describe("FollowUpChips", () => {
  it("sends the tapped question", () => {
    const onSelect = vi.fn();
    render(<FollowUpChips tools={["get_account_balances"]} onSelect={onSelect} disabled={false} />);

    const [first] = screen.getAllByRole("button");
    fireEvent.click(first);

    expect(onSelect).toHaveBeenCalledWith(first.textContent);
  });

  it("disables the chips while they cannot be sent", () => {
    render(<FollowUpChips tools={["get_account_balances"]} onSelect={vi.fn()} disabled />);

    for (const chip of screen.getAllByRole("button")) expect(chip).toBeDisabled();
  });
});
