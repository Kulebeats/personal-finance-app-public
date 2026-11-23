/**
 * NEW-37: the two legs of a transfer must be distinguishable in the list,
 * card and detail views, and a counterpart the viewer cannot list is never named.
 */
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { accountKeys } from "@/hooks/useAccounts";
import { TransactionRow } from "../components/TransactionRow";
import { TransactionCard } from "../components/TransactionCard";
import { TransactionAmountHeader } from "../components/TransactionAmountHeader";
import { TransferAccountNamesProvider, transferLegLabel } from "../transferLeg";
import type { TransactionWithDetails } from "../types";

vi.mock("wouter", () => ({ Link: ({ children }: { children: ReactNode }) => <a>{children}</a> }));

const CHECKING = "00000000-0000-4000-8000-0000000000c1";
const SAVINGS = "00000000-0000-4000-8000-0000000000s2";
const PRIVATE = "00000000-0000-4000-8000-0000000000p3";

function leg(overrides: Partial<TransactionWithDetails>): TransactionWithDetails {
  return {
    id: "tx-out", householdId: "h1", accountId: CHECKING, date: "2026-11-02", name: "Move to savings",
    amount: { amount: "150.00", currency: "ZMW" }, type: "transfer", isPending: false, isRecurring: false,
    isExcludedFromReports: false, isExcludedFromBudget: false, isPrivate: false,
    createdAt: "2026-11-02T08:00:00.000Z", updatedAt: "2026-11-02T08:00:00.000Z",
    accountName: "Checking", currency: "ZMW", transferAccountId: SAVINGS, isTransferIn: false,
    ...overrides,
  };
}

const outgoing = leg({});
const incoming = leg({ id: "tx-in", accountId: SAVINGS, accountName: "Savings", transferAccountId: CHECKING, isTransferIn: true });

function withAccounts(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(accountKeys.list({ includeArchived: true, includeHidden: true }), [
    { id: CHECKING, name: "Checking" }, { id: SAVINGS, name: "Savings" },
  ]);
  return <QueryClientProvider client={client}><TransferAccountNamesProvider>{children}</TransferAccountNamesProvider></QueryClientProvider>;
}

const rowProps = { isSelected: false, onSelect: vi.fn(), onClick: vi.fn() };

describe("transfer-leg attribution", () => {
  it("names direction and counterpart on each leg of the list", () => {
    render(withAccounts(<>
      <TransactionRow transaction={outgoing} {...rowProps} />
      <TransactionRow transaction={incoming} {...rowProps} />
    </>));
    expect(screen.getByText("Transfer to Savings")).toBeInTheDocument();
    expect(screen.getByText("Transfer from Checking")).toBeInTheDocument();
    expect(screen.queryByText("Uncategorized")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^View Move to savings, Transfer to Savings, / })).toBeInTheDocument();
  });

  it("labels the card and the detail header the same way", () => {
    render(withAccounts(<>
      <TransactionCard transaction={incoming} {...rowProps} />
      <TransactionAmountHeader transaction={outgoing} displayName="Move to savings" onViewTransactions={vi.fn()} />
    </>));
    expect(screen.getByText("Transfer from Checking")).toBeInTheDocument();
    expect(screen.getByText("Transfer to Savings")).toBeInTheDocument();
  });

  it("never names a counterpart the viewer cannot list", () => {
    render(withAccounts(<TransactionRow transaction={leg({ transferAccountId: PRIVATE })} {...rowProps} />));
    expect(screen.getByText("Transfer to another account")).toBeInTheDocument();
  });

  it("leaves income and expense rows unchanged", () => {
    expect(transferLegLabel({ type: "expense", isTransferIn: false, transferAccountId: SAVINGS }, new Map())).toBeNull();
    render(withAccounts(<TransactionRow transaction={leg({ type: "expense", categoryName: "Groceries" })} {...rowProps} />));
    expect(screen.getByText("Groceries")).toBeInTheDocument();
    expect(screen.queryByText(/^Transfer /)).not.toBeInTheDocument();
  });
});
