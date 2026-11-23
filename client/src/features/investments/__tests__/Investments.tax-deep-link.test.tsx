/**
 * NEW-25: the Reports Income "Investment Tax Reports" link lands on the
 * Investments tax report. It goes through App's real router, so a target the
 * router does not match would show the 404 page here.
 */
import { Suspense, type ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router as WouterRouter } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { Router } from "@/App";
import { IncomeSection } from "@/features/reports/components/IncomeSection";

vi.mock("@/pages/Reports", () => ({ default: () => <IncomeSection data={[]} isLoading={false} /> }));
vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({ status: null, lifetime: null }) }));
vi.mock("../hooks/useInvestmentsData", () => ({ useInvestmentsData: () => ({ displayCurrency: "USD", setDisplayCurrency: vi.fn(),
  timeframe: "1M", setTimeframe: vi.fn(), isLoading: false, holdings: [], performanceHistory: [], allocationData: [],
  totalValue: 0, totalGainLoss: 0, totalGainLossPercent: 0,
  formatCurrency: (value: number, currency = "USD") => `${currency} ${value.toFixed(2)}` }) }));
vi.mock("@/hooks/useInvestments", () => ({ useHoldings: () => ({ isError: false, refetch: vi.fn() }) }));
vi.mock("@/hooks/use-format", () => ({ useFormat: () => ({ formatCurrency: (value: number, currency = "USD") => `${currency} ${value.toFixed(2)}` }) }));
vi.mock("../components/PortfolioSummary", () => ({ PortfolioSummary: () => <h1>Investments</h1> }));
vi.mock("../components/AddHoldingModal", () => ({ AddHoldingModal: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../components/TaxReport", () => ({ TaxReport: () => <h2>Tax report content</h2> }));

it("opens the investments tax report from the Reports income link, not the 404 page", async () => {
  const user = userEvent.setup();
  const location = memoryLocation({ path: "/reports", record: true });
  render(
    <WouterRouter hook={location.hook} searchHook={location.searchHook}>
      <Suspense fallback={<p>Loading page</p>}><Router /></Suspense>
    </WouterRouter>,
  );

  await user.click(await screen.findByRole("link", { name: "Investment Tax Reports" }));

  expect(await screen.findByRole("heading", { name: "Tax report content" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "Tax Report" })).toHaveAttribute("aria-selected", "true");
  expect(screen.queryByText("404 Page Not Found")).not.toBeInTheDocument();
});
