import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GrzBond, GrzTBill } from "@/hooks/useGrzSecurities";
import Investments from "@/pages/Investments";
import { GRZSecurities } from "../components/GRZSecurities";

const state = vi.hoisted(() => ({ error: false, retry: vi.fn(), bonds: [] as GrzBond[], bills: [] as GrzTBill[] }));
vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
// Opening recovery has an active-lifetime page fixture in Investments.opening-recovery.test.tsx.
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({ status: null, lifetime: null }) }));
vi.mock("../hooks/useInvestmentsData", () => ({ useInvestmentsData: () => ({ displayCurrency: "USD", setDisplayCurrency: vi.fn(),
  timeframe: "1M", setTimeframe: vi.fn(), isLoading: false, holdings: [], performanceHistory: [], allocationData: [],
  totalValue: 0, totalGainLoss: 0, totalGainLossPercent: 0,
  formatCurrency: (value: number, currency = "USD") => `${currency} ${value.toFixed(2)}` }) }));
vi.mock("@/hooks/useInvestments", () => ({ useHoldings: () => ({ isError: state.error, refetch: state.retry }) }));
vi.mock("@/hooks/use-format", () => ({ useFormat: () => ({ formatCurrency: (value: number, currency = "USD") => `${currency} ${value.toFixed(2)}` }) }));
vi.mock("@/hooks/useGrzSecurities", () => ({ useGrzBonds: () => ({ data: state.bonds, isLoading: false }), useGrzTBills: () => ({ data: state.bills, isLoading: false }),
  useGrzPolicy: () => ({ data: null }) }));
vi.mock("../components/PortfolioSummary", () => ({ PortfolioSummary: () => <h1>Investments</h1> }));
vi.mock("../components/AddHoldingModal", () => ({ AddHoldingModal: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../components/AddGrzBondModal", () => ({ AddGrzBondModal: () => null }));
vi.mock("../components/AddGrzTBillModal", () => ({ AddGrzTBillModal: () => null }));
vi.mock("../components/BondScheduleDialog", () => ({ BondScheduleDialog: () => null }));
vi.mock("../components/TaxReport", () => ({ TaxReport: () => <h2>Tax report content</h2> }));
vi.mock("../components/PensionDashboard", () => ({ PensionDashboard: () => <h2>Pension content</h2> }));

const bond: GrzBond = { id: "active-bond", bondName: "Active issue", isin: "ZM0000000001", tenorYears: 5, faceValue: { amount: "1000.01", currency: "ZMW" }, purchasePrice: { amount: "950.00", currency: "ZMW" },
  purchaseDate: "2026-03-12", purchaseYield: null, couponRate: "0.1899", couponFrequency: 2, maturityDate: "2029-05-10", status: "active", createdAt: "2026-03-12" };
const bill: GrzTBill = { id: "active-bill", tbillName: "Active bill", isin: null, tenorDays: 182, faceValue: { amount: "200.02", currency: "ZMW" }, purchasePrice: { amount: "190.00", currency: "ZMW" },
  purchaseDate: "2026-03-12", purchaseYield: "0.1", discountAmount: { amount: "10.02", currency: "ZMW" }, maturityDate: "2026-09-10", status: "active", createdAt: "2026-03-12" };
beforeEach(() => { state.error = false; state.retry.mockReset(); state.bonds = []; state.bills = []; });

it("keeps the empty holdings action inside Holdings while GRZ, tax and pension stay reachable", async () => {
  const user = userEvent.setup(); render(<Investments />);
  expect(screen.getByRole("heading", { name: "No Holdings Yet" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Add Your First Holding" })).toBeVisible();
  await user.click(screen.getByRole("tab", { name: "Government (GRZ)" }));
  expect(screen.getByRole("button", { name: "Add Security" })).toBeVisible();
  await user.click(screen.getByRole("tab", { name: "Tax Report" })); expect(screen.getByRole("heading", { name: "Tax report content" })).toBeVisible();
  await user.click(screen.getByRole("tab", { name: "Pension" })); expect(screen.getByRole("heading", { name: "Pension content" })).toBeVisible();
});
it("keeps independent GRZ access when the holdings query fails and preserves its retry", async () => {
  state.error = true; const user = userEvent.setup(); render(<Investments />);
  expect(screen.getByText("Couldn't load your investments")).toBeVisible(); expect(screen.queryByText("No Holdings Yet")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /retry|try again/i })); expect(state.retry).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("tab", { name: "Government (GRZ)" })); expect(screen.getByRole("button", { name: "Add Security" })).toBeVisible();
});
it("shows held GRZ totals in ZMW, a bill awaiting receipt at face less withholding, even when the display preference is USD", () => {
  state.bonds = [bond, { ...bond, id: "sold", status: "sold", faceValue: { amount: "9999.99", currency: "ZMW" } }];
  state.bills = [bill, { ...bill, id: "matured", status: "matured", faceValue: { amount: "8999.98", currency: "ZMW" } },
    { ...bill, id: "due", status: "awaiting_receipt", faceValue: { amount: "100.00", currency: "ZMW" },
      maturityWithholdingTax: { amount: "1.50", currency: "ZMW" }, maturityNetProceeds: { amount: "98.50", currency: "ZMW" } }]; render(<GRZSecurities />);
  for (const [title, amount] of [["GRZ value held (ZMW)", "ZMW 1298.53"], ["Active bond face value (ZMW)", "ZMW 1000.01"], ["T-bill value held (ZMW)", "ZMW 298.52"]]) {
    const card = screen.getByText(title).closest(".rounded-xl"); expect(card).not.toBeNull(); expect(within(card as HTMLElement).getByText(amount)).toBeVisible();
  }
  expect(screen.getByText("1 Active Bonds")).toBeVisible(); expect(screen.getByText("1 Active T-Bills, 1 awaiting receipt")).toBeVisible();
  expect(screen.queryByText("Total GRZ Portfolio")).not.toBeInTheDocument(); expect(screen.queryByText(/USD/)).not.toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Face Value (ZMW)" })).toBeVisible();
  expect(screen.getByRole("columnheader", { name: "Purchase Price (ZMW)" })).toBeVisible();
  const activeRow = screen.getByRole("row", { name: /ZMW 1000\.01/ });
  expect(within(activeRow).getByRole("cell", { name: "ZMW 950.00" })).toBeVisible();
});
it("keeps T-bill table monetary columns in ZMW independently of the display preference", async () => {
  state.bills = [bill]; const user = userEvent.setup(); render(<GRZSecurities />); await user.click(screen.getByRole("tab", { name: "Treasury Bills" }));
  expect(screen.getByRole("columnheader", { name: "Face Value (ZMW)" })).toBeVisible(); expect(screen.getByText("ZMW 190.00")).toBeVisible();
  expect(screen.queryByText(/USD/)).not.toBeInTheDocument();
});
it("A-36: reads a due bill without booked proceeds as unavailable, never as zero", () => {
  state.bonds = [bond]; state.bills = [bill, { ...bill, id: "due", status: "awaiting_receipt", maturityNetProceeds: undefined }]; render(<GRZSecurities />);
  expect(screen.getAllByText("Unavailable")).toHaveLength(2); expect(screen.getByText("1 Active T-Bills, 1 awaiting receipt")).toBeVisible();
});
