import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { TransactionsList } from "../components/GoalHistoryList";
import type { TransactionGoalLinkWithTransaction } from "@/hooks/useGoals";

function renderAt(initialPath: string, ui: React.ReactElement) {
  const { hook, searchHook, history } = memoryLocation({
    path: initialPath,
    record: true,
  });
  render(
    <Router hook={hook} searchHook={searchHook}>
      {ui}
    </Router>,
  );
  return { history: history! };
}

const baseItem: TransactionGoalLinkWithTransaction = {
  id: "link-1",
  goalId: "goal-1",
  transactionId: "tx-1",
  linkType: "contribution",
  amount: "50.00",
  createdAt: "2026-01-05T00:00:00Z",
  transaction: {
    id: "tx-1",
    accountId: "acc-1",
    householdId: "h-1",
    date: "2026-01-05",
    name: "Paycheck deposit",
    amount: "50.00",
    type: "income",
    categoryId: "cat-1",
  },
} as unknown as TransactionGoalLinkWithTransaction;

describe("GoalHistoryList TransactionsList", () => {
  it("navigates to the filtered transactions view when a linked transaction row is clicked (audit v2 P2)", () => {
    const { history } = renderAt(
      "/",
      <TransactionsList items={[baseItem]} formatCurrency={(v) => `$${v}`} />,
    );

    const row = screen.getByRole("button", { name: /paycheck deposit/i });
    fireEvent.click(row);

    const lastUrl = history[history.length - 1];
    expect(lastUrl.startsWith("/transactions?")).toBe(true);
    const params = new URLSearchParams(lastUrl.split("?")[1]);
    expect(params.get("accountId")).toBe("acc-1");
    expect(params.get("categoryId")).toBe("cat-1");
    expect(params.get("from")).toBe("2026-01-05");
    expect(params.get("to")).toBe("2026-01-05");
  });

  it("does not navigate when the Unlink button is clicked", () => {
    const onUnlink = vi.fn();
    const { history } = renderAt(
      "/",
      <TransactionsList
        items={[baseItem]}
        formatCurrency={(v) => `$${v}`}
        onUnlink={onUnlink}
        unlinking={false}
      />,
    );

    const unlinkButton = screen.getByRole("button", { name: /unlink/i });
    fireEvent.click(unlinkButton);

    expect(onUnlink).toHaveBeenCalledWith("tx-1");
    expect(history.length).toBe(1);
    expect(history[0]).toBe("/");
  });
});
