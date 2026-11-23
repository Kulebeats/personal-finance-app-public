import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AccountList } from "../components/AccountList";
vi.mock("../components/AddAccountModal", () => ({ AddAccountModal: () => null }));
afterEach(cleanup);
it("offers All accounts for a filtered empty list when accessible accounts exist", () => {
  const reset = vi.fn();
  render(<AccountList groupedAccounts={{}} accounts={[]} getGroupTotal={() => 0} isFiltered hasAccessibleAccounts onResetFilter={reset} onAddAccount={vi.fn()} />);
  expect(screen.getByText("No accounts match this filter")).toBeInTheDocument();
  expect(screen.queryByText("No accounts yet")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show All Accounts" }));
  expect(reset).toHaveBeenCalledTimes(1);
});
it("shows the first-account empty state only when the authorized count is zero", () => {
  render(<AccountList groupedAccounts={{}} accounts={[]} getGroupTotal={() => 0} isFiltered hasAccessibleAccounts={false} onResetFilter={vi.fn()} onAddAccount={vi.fn()} />);
  expect(screen.getByText("No accounts yet")).toBeInTheDocument();
});
