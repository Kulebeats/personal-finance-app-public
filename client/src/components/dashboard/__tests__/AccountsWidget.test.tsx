import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AccountsWidget from "../AccountsWidget";
import { useAccounts } from "@/hooks/use-finance-data";

const mockSetLocation = vi.fn();
const mockRefresh = vi.fn();

vi.mock("@/hooks/use-finance-data", () => ({
  useAccounts: vi.fn(),
}));

vi.mock("@/components/BankLogo", () => ({
  BankLogo: ({ institution }: { institution: string }) => (
    <span data-testid="bank-logo">{institution}</span>
  ),
}));

vi.mock("wouter", () => ({
  Link: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
  useLocation: () => ["/", mockSetLocation],
}));

const mockedUseAccounts = vi.mocked(useAccounts);

const singleAccount = {
  accounts: [
    {
      id: "checking",
      name: "Main Checking",
      type: "checking",
      balance: 1250.5,
      currency: "USD",
      institution: "Test Bank",
    },
  ],
  loading: false,
  error: null,
  refresh: mockRefresh,
} as unknown as ReturnType<typeof useAccounts>;

describe("AccountsWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("navigates to the account detail route when an account row is clicked", () => {
    mockedUseAccounts.mockReturnValue(singleAccount);

    render(<AccountsWidget />);

    fireEvent.click(screen.getByRole("button", { name: /main checking/i }));

    expect(mockSetLocation).toHaveBeenCalledWith("/accounts/checking");
  });

  it("navigates to the account detail route on keyboard activation (Enter)", () => {
    mockedUseAccounts.mockReturnValue(singleAccount);

    render(<AccountsWidget />);

    fireEvent.keyDown(screen.getByRole("button", { name: /main checking/i }), {
      key: "Enter",
    });

    expect(mockSetLocation).toHaveBeenCalledWith("/accounts/checking");
  });
});
