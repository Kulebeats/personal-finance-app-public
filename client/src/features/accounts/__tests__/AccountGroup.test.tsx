import { render, screen } from "@testing-library/react";
import { AccountGroup } from "../components/AccountGroup";

describe("AccountGroup", () => {
  it("renders group title and positive total correctly", () => {
    render(<AccountGroup title="Banks" amount={25000} />);

    expect(screen.getByText("Banks")).toBeDefined();
    expect(screen.getByText("K25,000.00")).toBeDefined();
    // Should not have minus sign
    expect(screen.queryByText("-K25,000.00")).toBeNull();
  });

  it("renders liability group correctly with red styling", () => {
    render(<AccountGroup title="Credit Cards" amount={-5000} isLiability />);

    expect(screen.getByText("Credit Cards")).toBeDefined();
    // Should render as -K5,000.00 text because of manual formatting in component
    // Check component implementation: {isLiability && "-"}K{Math.abs(amount)...}
    expect(screen.getByText("-K5,000.00")).toBeDefined();

    const amountElement = screen.getByText("-K5,000.00");
    expect(amountElement.className).toContain("text-rose-600");
  });
});
