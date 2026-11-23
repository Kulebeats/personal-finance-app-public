/**
 * NEW-27: a household that has just been created is guided account ->
 * categories -> first transaction; the guidance goes away once it has both an
 * account and a transaction, and never flashes while counts load.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({
  accounts: undefined as unknown[] | undefined,
  categories: undefined as { categories: unknown[] } | undefined,
  transactions: undefined as { transactions: unknown[] } | undefined,
  // A refetch can fail while TanStack Query keeps the last data (isError + data).
  failing: new Set<"accounts" | "categories" | "transactions">(),
}));

vi.mock("@/hooks/useAccounts", () => ({ useAccounts: () => ({ data: state.accounts, isError: state.failing.has("accounts") }) }));
vi.mock("@/hooks/useCategories", () => ({ useCategories: () => ({ data: state.categories, isError: state.failing.has("categories") }) }));
vi.mock("@/hooks/useTransactions", () => ({ useTransactions: () => ({ data: state.transactions, isError: state.failing.has("transactions") }) }));
vi.mock("@/features/accounts", () => ({ AddAccountModal: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("wouter", () => ({ Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));

import { GettingStartedChecklist } from "../GettingStartedChecklist";

beforeEach(() => {
  state.accounts = [];
  state.categories = { categories: [{ id: "c1" }] };
  state.transactions = { transactions: [] };
  state.failing = new Set();
});

describe("GettingStartedChecklist", () => {
  it("guides a new household from account to first transaction", () => {
    render(<GettingStartedChecklist />);
    const region = screen.getByRole("region", { name: "Get started with your household" });
    expect(region).toBeInTheDocument();
    const steps = screen.getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(steps[0]).toMatch(/^Add an account \(to do\)/);
    expect(steps[1]).toMatch(/^Review your categories \(done\)/);
    expect(steps[2]).toMatch(/^Add your first transaction \(to do\)/);
    expect(screen.getByRole("button", { name: "Add account" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open categories" })).toHaveAttribute("href", "/settings/organization/categories");
    expect(screen.getByRole("link", { name: "Go to transactions" })).toHaveAttribute("href", "/transactions");
  });

  it("marks the account step done and keeps the transaction step open", () => {
    state.accounts = [{ id: "a1" }];
    render(<GettingStartedChecklist />);
    expect(screen.queryByRole("button", { name: "Add account" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to transactions" })).toBeInTheDocument();
  });

  it("disappears once the household has an account and a transaction", () => {
    state.accounts = [{ id: "a1" }];
    state.transactions = { transactions: [{ id: "t1" }] };
    const { container } = render(<GettingStartedChecklist />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not count a step done from cached data whose refetch failed", () => {
    // Cached data alone would hide the card (account + transaction), but the
    // accounts refetch failed: the account may have been deleted elsewhere.
    state.accounts = [{ id: "a1" }];
    state.transactions = { transactions: [{ id: "t1" }] };
    state.failing = new Set(["accounts"]);
    render(<GettingStartedChecklist />);
    const steps = screen.getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(steps[0]).toMatch(/^Add an account \(to do\)/);
    expect(steps[2]).toMatch(/^Add your first transaction \(done\)/);
    expect(screen.getByRole("button", { name: "Add account" })).toBeInTheDocument();
  });

  it("renders nothing until every count has loaded", () => {
    state.transactions = undefined;
    const { container } = render(<GettingStartedChecklist />);
    expect(container).toBeEmptyDOMElement();
  });
});
