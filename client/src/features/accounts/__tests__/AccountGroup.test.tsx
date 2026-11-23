import { fireEvent, render, screen } from "@testing-library/react";
import { AccountGroup } from "../components/AccountGroup";

describe("AccountGroup", () => {
  it("renders group title and positive total correctly", () => {
    render(<AccountGroup title="Banks" amount={25000} currency="ZMW" />);

    expect(screen.getByText("Banks")).toBeDefined();
    expect(screen.getByText(/ZMW.*25,000\.00/)).toBeDefined();
    // Should not have minus sign
    expect(screen.queryByText(/-ZMW.*25,000\.00/)).toBeNull();
  });

  it("renders liability group correctly with red styling", () => {
    render(<AccountGroup title="Credit Cards" amount={-5000} currency="ZMW" isLiability />);

    expect(screen.getByText("Credit Cards")).toBeDefined();
    expect(screen.getByText(/-ZMW.*5,000\.00/)).toBeDefined();

    const amountElement = screen.getByText(/-ZMW.*5,000\.00/);
    expect(amountElement.parentElement?.className).toContain("text-rose-600");
  });
  it("preserves focus and Enter/Space toggling with denominated totals", () => {
    const toggle = vi.fn();
    render(<AccountGroup title="Banks" totals={[{ amount: 10, currency: "USD" }, { amount: 900, currency: "ZMW" }]} onToggle={toggle} />);
    const group = screen.getByRole("button", { name: /Banks account group/ }); group.focus();
    fireEvent.keyDown(group, { key: "Enter" }); fireEvent.keyDown(group, { key: " " });
    expect(toggle).toHaveBeenCalledTimes(2);
    expect(group).toHaveFocus();
  });
});
