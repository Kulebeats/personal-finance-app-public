/**
 * RecurringPageHeader: the upcoming total says how many payments it leaves
 * out because their amount is not confirmed in the display currency (FIN-05).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { RecurringPageHeader } from "../components/RecurringPageHeader";

vi.mock("@/components/transactions/AddTransactionModal", () => ({
  AddTransactionModal: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../components/RecurringPatternsModal", () => ({
  RecurringPatternsModal: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function renderHeader(upcomingExcluded: number) {
  render(
    <RecurringPageHeader
      upcomingCount={3}
      upcomingTotal={{ amount: "45.50", currency: "ZMW" }}
      upcomingExcluded={upcomingExcluded}
      currency="ZMW"
      viewMode="calendar"
      setViewMode={vi.fn()}
    />,
  );
}

describe("RecurringPageHeader", () => {
  it("says nothing is left out when every upcoming amount is in the display currency", () => {
    renderHeader(0);
    expect(screen.queryByText(/not included/)).toBeNull();
  });

  it("says one upcoming payment is left out of the total", () => {
    renderHeader(1);
    expect(screen.getByText("1 payment is not included because its amount is not confirmed in ZMW.")).toBeDefined();
  });

  it("says how many upcoming payments are left out of the total", () => {
    renderHeader(2);
    expect(screen.getByText("2 payments are not included because their amounts are not confirmed in ZMW.")).toBeDefined();
  });
});
