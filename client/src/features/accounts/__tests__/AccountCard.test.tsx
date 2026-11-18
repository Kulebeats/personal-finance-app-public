import { render, screen } from "@testing-library/react";
import { AccountCard } from "../components/AccountCard";
import { Account } from "@/lib/api";
import { TestWrapper } from "@/test/test-utils";

const mockAccount: Account = {
  id: "1",
  householdId: "household1",
  name: "Test Checking",
  type: "checking",
  balance: "1500.00",
  initialBalance: "0.00",
  currency: "ZMW",
  institution: "FNB",
  ownerUserId: "user1",
  isAsset: true,
  isPrivate: false,
  isHidden: false,
  isArchived: false,
  displayOrder: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("AccountCard", () => {
  it("renders account name and balance correctly", () => {
    render(
      <TestWrapper>
        <AccountCard account={mockAccount} />
      </TestWrapper>
    );

    expect(screen.getByText("Test Checking")).toBeDefined();
    expect(screen.getByText("K1,500.00")).toBeDefined();
    expect(screen.getByText(/FNB/)).toBeDefined();
  });

  it("renders negative balance in red", () => {
    const negativeAccount = { ...mockAccount, balance: "-500.00" };
    render(
      <TestWrapper>
        <AccountCard account={negativeAccount} />
      </TestWrapper>
    );

    const balanceElement = screen.getByText("-K500.00");
    expect(balanceElement.className).toContain("text-rose-600");
  });

  it("renders non-default currency badge", () => {
    const usdAccount = { ...mockAccount, currency: "USD", balance: "100" };
    render(
      <TestWrapper>
        <AccountCard account={usdAccount} />
      </TestWrapper>
    );

    expect(screen.getByText("USD")).toBeDefined(); // Badge
    expect(screen.getByText("$100.00")).toBeDefined(); // Formatted balance
  });
});
