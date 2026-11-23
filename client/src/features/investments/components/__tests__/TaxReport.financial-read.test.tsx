import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { TaxReport } from "../TaxReport";
import { investmentKeys } from "@/hooks/investments/keys";

const { getReport, display, calendar } = vi.hoisted(() => ({ getReport: vi.fn(), display: { currency: "USD", numberFormat: "US" },
  calendar: { year: new Date().getFullYear() } }));
// The household's year comes from its own endpoint; every financial read goes through getReport.
vi.mock("@/lib/queryClient", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/queryClient")>(),
  apiRequest: (method: string, url: string) => url === "/api/investments/tax/year"
    ? Promise.resolve(Response.json({ year: calendar.year })) : getReport(method, url),
}));
vi.mock("@/hooks/use-settings", () => ({ useDisplaySettings: () => ({ data: display }) }));

const year = new Date().getFullYear();
const report = { year, interestIncome: "40.00", dividendIncome: "0.00", realizedGains: "0.00",
  grossIncome: "40.00", totalWht: "6.00", netIncome: "34.00", currency: "ZMW" };

function mount(cached = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cached) client.setQueryData(investmentKeys.taxSummary(year), report);
  render(<QueryClientProvider client={client}><TaxReport /></QueryClientProvider>);
}

beforeEach(() => { getReport.mockReset(); display.numberFormat = "US"; calendar.year = year; });

it("opens on the household's year, not the browser's, and stops there (NEW-22)", async () => {
  // e.g. 00:30 on 1 January in Lusaka while the browser's clock is still on 31 December.
  calendar.year = year + 1;
  getReport.mockResolvedValue(Response.json({ ...report, year: year + 1 }));
  mount();
  expect(await screen.findByText("K34.00")).toBeVisible();
  expect(getReport).toHaveBeenCalledWith("GET", `/api/investments/tax/summary?year=${year + 1}`);
  expect(getReport).not.toHaveBeenCalledWith("GET", `/api/investments/tax/summary?year=${year}`);
  expect(screen.getByRole("button", { name: "Next year" })).toBeDisabled();
});

it("shows the report denomination when the display preference uses another currency", async () => {
  getReport.mockResolvedValue(Response.json(report));
  mount();
  expect(await screen.findByText("K34.00")).toBeVisible();
  expect(screen.getByText("K6.00")).toBeVisible();
  expect(screen.queryByText("$34.00")).not.toBeInTheDocument();
  expect(screen.queryByText(/standard 15% rate/i)).not.toBeInTheDocument();
});

it("renders reported zero amounts for a genuinely empty year", async () => {
  getReport.mockResolvedValue(Response.json({ ...report, interestIncome: "0.00", grossIncome: "0.00", totalWht: "0.00", netIncome: "0.00" }));
  mount();
  await waitFor(() => expect(screen.getAllByText("K0.00").length).toBeGreaterThan(0));
  expect(screen.getByRole("button", { name: /export csv/i })).toBeEnabled();
});

it.each([false, true])("withholds totals after an unsuccessful financial read (cached=%s) and allows another year", async cached => {
  getReport.mockRejectedValueOnce(new Error("Financial data unavailable"));
  getReport.mockResolvedValueOnce(Response.json({ ...report, year: year - 1 }));
  mount(cached);
  expect(await screen.findByRole("alert")).toHaveTextContent(/unavailable/i);
  expect(screen.queryAllByText(/^[K$](34|0)\.00$/)).toHaveLength(0);
  expect(screen.getByRole("button", { name: /export csv/i })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Previous year" }));
  expect(await screen.findByText("K34.00")).toBeVisible();
  expect(getReport).toHaveBeenLastCalledWith("GET", `/api/investments/tax/summary?year=${year - 1}`);
});

it.each([
  ["US", "100000000000000.01", "K100,000,000,000,000.01"],
  ["EU", "-1234567.89", "-K1.234.567,89"],
])("preserves exact reported cents using the %s number format", async (numberFormat, amount, expected) => {
  display.numberFormat = numberFormat;
  getReport.mockResolvedValue(Response.json({ ...report, realizedGains: amount }));
  mount();
  expect(await screen.findByText(expected)).toBeVisible();
});

it("retries the same year after a failed read and shows only the new summary", async () => {
  getReport.mockRejectedValueOnce(new Error("Financial data unavailable"));
  getReport.mockResolvedValueOnce(Response.json(report));
  mount(true);
  expect(await screen.findByRole("alert")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("K34.00")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(getReport).toHaveBeenCalledTimes(2);
  expect(getReport).toHaveBeenLastCalledWith("GET", `/api/investments/tax/summary?year=${year}`);
});
