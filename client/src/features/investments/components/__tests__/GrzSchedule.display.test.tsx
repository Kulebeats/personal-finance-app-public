import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GrzBond, GrzTBill } from "@/hooks/useGrzSecurities";
import { BondScheduleDialog } from "../BondScheduleDialog";
import { GRZBondsTable } from "../GRZBondsTable";
import { GRZTBillsTable } from "../GRZTBillsTable";

const mocks = vi.hoisted(() => ({ pay: vi.fn(), format: (value: number, currency = "USD") => `${currency} ${value.toFixed(2)}` }));
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({ status: null, lifetime: null }) }));
vi.mock("@/hooks/use-format",() => ({ useFormat: () => ({ formatCurrency: mocks.format }) }));
vi.mock("@/hooks/useGrzSecurities", () => ({ useMarkGrzPaymentPaid: () => ({ mutateAsync: mocks.pay, isPending: false }) }));
vi.mock("@/hooks/useAccounts", () => ({ useAccounts: () => ({ data: [
  { id: "zmw", name: "Kwacha cash", balance: "125.00", currency: "ZMW" },
  { id: "usd", name: "Dollar cash", balance: "8.00", currency: "USD" },
] }) }));
const bond: GrzBond = { id: "issue", bondName: "Display issue", isin: "ZM0000000001", tenorYears: 5, faceValue: { amount: "1000.00", currency: "ZMW" }, purchasePrice: { amount: "950.00", currency: "ZMW" },
  purchaseDate: "2026-03-12", purchaseYield: null, couponRate: "0.1899", couponFrequency: 2, maturityDate: "2029-05-10", status: "active", createdAt: "2026-03-12",
  payments: [
    { id: "paid", paymentDate: "2026-05-10", paymentType: "coupon", grossAmount: { amount: "94.95", currency: "ZMW" }, withholdingTax: { amount: "14.24", currency: "ZMW" }, netAmount: { amount: "80.71", currency: "ZMW" }, status: "paid", actualPaymentDate: "2026-05-11" },
    { id: "scheduled", paymentDate: "2026-11-10", paymentType: "coupon", grossAmount: { amount: "94.95", currency: "ZMW" }, withholdingTax: { amount: "14.24", currency: "ZMW" }, netAmount: { amount: "80.71", currency: "ZMW" }, status: "scheduled", actualPaymentDate: null },
  ] };
beforeEach(() => vi.clearAllMocks());

it("renders statement payment money in ZMW and civil dates without applying the USD display denomination", () => {
  render(<BondScheduleDialog bond={bond} open onOpenChange={vi.fn()} />);
  expect(screen.getByText("Payment amounts are in ZMW.")).toBeVisible();
  expect(screen.getByText("ZMW 1000.00")).toBeVisible(); expect(screen.getAllByText("ZMW 94.95")).toHaveLength(2);
  expect(screen.getAllByText("ZMW 80.71")).toHaveLength(2); expect(screen.getAllByText("-ZMW 14.24")).toHaveLength(2);
  expect(screen.getByText("May 10, 2026")).toBeVisible(); expect(screen.getByText("Paid: May 11, 2026")).toBeVisible();
  expect(screen.getByRole("columnheader", { name: "Gross (ZMW)" })).toBeVisible(); expect(screen.queryByText(/USD/)).not.toBeInTheDocument();
});
it("shows the deposit in ZMW while showing each destination balance in its actual denomination", async () => {
  const user = userEvent.setup(); render(<BondScheduleDialog bond={bond} open onOpenChange={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Mark Paid" }));
  expect(screen.getByText(/Select account to deposit ZMW 80.71/)).toBeVisible();
  await user.click(screen.getByRole("combobox", { name: "Account" }));
  expect(screen.getByRole("option", { name: "Kwacha cash (ZMW 125.00)" })).toBeVisible();
  expect(screen.getByRole("option", { name: "Dollar cash (USD 8.00)" })).toBeVisible(); expect(mocks.pay).not.toHaveBeenCalled();
});
it("renders the same contractual maturity day in bond and T-bill existing table callers", () => {
  const bill: GrzTBill = { id: "bill", tbillName: "Display bill", isin: null, tenorDays: 182, faceValue: { amount: "1000.00", currency: "ZMW" }, purchasePrice: { amount: "950.00", currency: "ZMW" },
    purchaseDate: "2028-11-10", purchaseYield: null, discountAmount: { amount: "50.00", currency: "ZMW" }, maturityDate: "2029-05-10", status: "active", createdAt: "2028-11-10" };
  render(<><GRZBondsTable bonds={[bond]} formatCurrency={mocks.format} onViewSchedule={vi.fn()} />
    <GRZTBillsTable tbills={[bill]} formatCurrency={mocks.format} /></>);
  expect(screen.getAllByText("May 10, 2029")).toHaveLength(2); expect(screen.queryByText(/May 9, 2029/)).not.toBeInTheDocument();
});
