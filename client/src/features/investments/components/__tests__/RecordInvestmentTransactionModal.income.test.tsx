import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { Holding } from "@/hooks/useInvestments";
import { setHouseholdCalendarTimeZone } from "@/lib/calendarZone";
import { RecordInvestmentTransactionModal } from "../RecordInvestmentTransactionModal";

const { submit, display } = vi.hoisted(() => ({ submit: vi.fn(), display: { numberFormat: "US", currency: "ZMW" } }));
vi.mock("@/hooks/useInvestments", () => ({ useCreateInvestmentTransaction: () => ({ mutateAsync: submit }) }));
vi.mock("@/hooks/use-settings", () => ({ useDisplaySettings: () => ({ data: display }) }));
const holding: Holding = {
  id: "holding", householdId: "household", accountId: "account", securityId: "security", quantity: "2",
  costBasis: null, costBasisZmw: null, acquiredDate: null, acquisitionFxRate: null, createdAt: "", updatedAt: "",
  security: { id: "security", symbol: "ABC", name: "Synthetic instrument", type: "bond", currency: "USD",
    exchange: null, isOffshore: false, sector: null, cusipIsin: null, currentPrice: "20.00", lastPriceUpdate: null,
    withholdingTaxRate: "15", createdAt: "", updatedAt: "" },
};

async function openActivity(type: "Interest" | "Dividend" | "Buy" | "Sell", source = holding) {
  const user = userEvent.setup();
  render(<RecordInvestmentTransactionModal holding={source}><button>Record activity</button></RecordInvestmentTransactionModal>);
  await user.click(screen.getByRole("button", { name: "Record activity" }));
  const form = within(screen.getByRole("dialog"));
  await user.click(form.getByRole("button", { name: type }));
  return { user, form, save: form.getByRole("button", { name: `Record ${type}` }) };
}

beforeEach(() => { submit.mockReset().mockResolvedValue({}); display.numberFormat = "US"; });

it.each([["Interest", "15%", "0.08", "0.02"], ["Dividend", "0%", "0.10", "0.00"]] as const)(
  "%s previews and submits gross less one rounded withholding deduction", async (type, rate, net, withheld) => {
    const { user, form, save } = await openActivity(type);
    fireEvent.change(form.getByPlaceholderText("1000.00"), { target: { value: "0.10" } });
    expect(save).toBeDisabled();
    await user.click(form.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: new RegExp("^" + rate) }));
    expect(form.getByText("-$" + withheld)).toBeVisible();
    expect(form.getAllByText("$" + net).length).toBeGreaterThan(0);
    await user.click(save);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ type: type.toLowerCase(), currency: "USD",
      holdingId: holding.id, amount: net, withholdingTax: withheld }));
  });

it("requires valid stated amounts and an explicit custom rate", async () => {
  const { user, form, save } = await openActivity("Interest");
  fireEvent.change(form.getByPlaceholderText("1000.00"), { target: { value: "40.00" } });
  await user.click(form.getByRole("combobox"));
  await user.click(screen.getByRole("option", { name: "Custom Rate" }));
  const custom = form.getByPlaceholderText("15");
  expect(save).toBeDisabled();
  for (const rate of ["-1", "100.01", "14.999999999999999999999"]) {
    fireEvent.change(custom, { target: { value: rate } });
    expect(save).toBeDisabled();
  }
  fireEvent.change(custom, { target: { value: "12.5" } });
  expect(save).toBeEnabled();
  fireEvent.change(form.getByPlaceholderText("1000.00"), { target: { value: "40.009" } });
  expect(save).toBeDisabled();
  expect(submit).not.toHaveBeenCalled();
});

it("keeps European separators and the holding currency in a seven-digit preview", async () => {
  display.numberFormat = "EU";
  const { user, form } = await openActivity("Dividend");
  fireEvent.change(form.getByPlaceholderText("1000.00"), { target: { value: "1234567.89" } });
  await user.click(form.getByRole("combobox"));
  await user.click(screen.getByRole("option", { name: "0%" }));
  expect(form.getAllByText("$1.234.567,89")).toHaveLength(2);
});

it.each([["Buy", "1.01"], ["Sell", "0.99"]] as const)("%s previews the same four-decimal trade and fee that it sends", async (type, total) => {
  const { user, form, save } = await openActivity(type);
  fireEvent.change(form.getByLabelText("Quantity"), { target: { value: "1.5" } });
  fireEvent.change(form.getByLabelText("Price per Share"), { target: { value: "0.6667" } });
  const fee = form.getByLabelText("Trade fee");
  fireEvent.change(fee, { target: { value: "0.001" } });
  expect(save).toBeDisabled();
  fireEvent.change(fee, { target: { value: "0.01" } });
  expect(form.getByText("$" + total)).toBeVisible();
  await user.click(save);
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ type: type.toLowerCase(), price: "0.6667",
    quantity: "1.5", currency: "USD", fees: "0.01", amount: total }));
});
it.each([["", undefined], ["0", "0.00"]])("distinguishes an incomplete fee from fee input %j", async (fee, expected) => {
  const { user, form, save } = await openActivity("Sell", { ...holding, quantity: "1" });
  fireEvent.change(form.getByLabelText("Price per Share"), { target: { value: "20.00" } });
  fireEvent.change(form.getByLabelText("Quantity"), { target: { value: "0.99999999" } });
  const entry = form.getByLabelText("Trade fee");
  await user.type(entry, "1e");
  expect(entry).toHaveValue("1e");
  expect(save).toBeDisabled();
  await user.click(save);
  expect(submit).not.toHaveBeenCalled();
  await user.clear(entry);
  if (fee) await user.type(entry, fee);
  expect(form.getByText("0.00000001")).toBeVisible();
  await user.click(save);
  const [payload] = submit.mock.calls[0];
  if (expected === undefined) expect(payload).not.toHaveProperty("fees");
  else expect(payload.fees).toBe(expected);
});

it.each(["", "usd"])("withholds the trade preview and submit for holding currency %j", async (currency) => {
  const { form, save } = await openActivity("Buy", { ...holding, security: { ...holding.security!, currency } });
  fireEvent.change(form.getByLabelText("Quantity"), { target: { value: "1" } });
  expect(form.getByText(/settlement unavailable/i)).toBeVisible();
  expect(form.queryByText("Total Cost")).toBeNull();
  expect(save).toBeDisabled();
});

const quoteSources = [
  { label: "global reference", valuationPrice: null },
  { label: "household valuation", valuationPrice: { source: "manual" as const,
    effectiveDate: "2026-11-01", validThrough: "2026-11-30", recordedAt: "2026-11-01T00:00:00Z" } },
];
it.each(quoteSources)("requires an explicit Buy execution price when a $label quote is available", async ({ valuationPrice }) => {
  const { user, form, save } = await openActivity("Buy", {
    ...holding, security: { ...holding.security!, currentPrice: "123.4567", valuationPrice },
  });
  const entry = form.getByLabelText("Price per Share");
  expect(entry).toHaveValue(null);
  expect(form.getByText(/Enter the actual execution price/)).toBeVisible();
  expect(form.getByText("Valuation price: USD 123.4567")).toBeVisible();
  fireEvent.change(form.getByLabelText("Quantity"), { target: { value: "1.5" } });
  expect(save).toBeDisabled();
  await user.click(save);
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(entry, { target: { value: "0.6667" } });
  await user.click(save);
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({
    type: "buy", price: "0.6667", quantity: "1.5", currency: "USD", amount: "1.00",
  }));
});

it.each(quoteSources)("requires an explicit Sell execution price when a $label quote is available", async ({ valuationPrice }) => {
  const { user, form, save } = await openActivity("Sell", {
    ...holding, security: { ...holding.security!, currentPrice: "123.4567", valuationPrice },
  });
  const entry = form.getByLabelText("Price per Share");
  expect(entry).toHaveValue(null);
  expect(form.getByText("Valuation price: USD 123.4567")).toBeVisible();
  fireEvent.change(form.getByLabelText("Quantity"), { target: { value: "1.5" } });
  expect(save).toBeDisabled();
  await user.click(save);
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(entry, { target: { value: "0.6667" } });
  await user.click(save);
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({
    type: "sell", price: "0.6667", quantity: "1.5", currency: "USD", amount: "1.00",
  }));
});

it("NEW-15: defaults the activity date to the household's day just after its midnight, not UTC's", async () => {
  // 22:30 UTC on 22 November is 00:30 on 23 November in Lusaka (UTC+2).
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-22T22:30:00Z"));
  setHouseholdCalendarTimeZone("Africa/Lusaka"); await Promise.resolve();
  try {
    const { form } = await openActivity("Buy");
    expect(form.getByLabelText("Transaction Date")).toHaveValue("2026-11-23");
  } finally { vi.useRealTimers(); setHouseholdCalendarTimeZone(null); await Promise.resolve(); }
});
