/**
 * @vitest-environment jsdom
 *
 * NEW-37 / R18.2: every control the Investments header offers works or is
 * removed. The "Filter" button had no handler, so it is gone; the currency
 * toggle exposes which currency is shown (aria-pressed), not only a colour.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PortfolioSummary } from "../PortfolioSummary";

function renderSummary(onCurrencyChange = vi.fn()) {
  render(
    <PortfolioSummary
      totalValue={100}
      totalGainLoss={null}
      totalGainLossPercent={null}
      displayCurrency="ZMW"
      onCurrencyChange={onCurrencyChange}
      formatCurrency={(amount, currency) => `${currency} ${amount}`}
      onAddHolding={vi.fn()}
    />,
  );
  return onCurrencyChange;
}

describe("PortfolioSummary header controls", () => {
  it("offers no Filter button, since it had nothing to do", () => {
    renderSummary();
    expect(screen.queryByRole("button", { name: "Filter" })).toBeNull();
  });

  it("marks the shown currency as pressed and asks for the other on click", async () => {
    const onCurrencyChange = renderSummary();
    expect(screen.getByRole("button", { name: "ZMW" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "USD" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.setup().click(screen.getByRole("button", { name: "USD" }));
    expect(onCurrencyChange).toHaveBeenCalledWith("USD");
  });
});
