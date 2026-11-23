import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CustomChartConfig } from "@shared/reports";
import { CustomChartBuilderModal } from "../CustomChartBuilderModal";

const fetchReport = vi.hoisted(() => vi.fn<(url: string) => Promise<Response>>());

vi.mock("@/lib/protected-fetch", () => ({ protectedFetch: fetchReport }));
vi.mock("@/hooks/use-settings", () => ({ useHousehold: () => ({ data: undefined }) }));

afterEach(() => {
  cleanup();
  fetchReport.mockReset();
});

function renderBuilder(initialConfig?: CustomChartConfig) {
  fetchReport.mockImplementation(async () => Response.json({ success: true, data: { data: [] } }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <QueryClientProvider client={queryClient}>
      <CustomChartBuilderModal open onOpenChange={vi.fn()} onSave={save} initialConfig={initialConfig} />
    </QueryClientProvider>,
  );
  return save;
}

const previewRequests = () => fetchReport.mock.calls.map(([url]) => new URL(url, "http://localhost").searchParams);
const savedChart = { id: "c1", name: "Spend", chartType: "bar", primaryMetric: "expenses", order: 0 };

it("previews the default category breakdown across the whole range", async () => {
  renderBuilder();

  await waitFor(() => expect(previewRequests()[0]?.get("groupBy")).toBe("category"));
  const [query] = previewRequests();
  expect(query.get("primaryMetric")).toBe("expenses");
  expect(query.has("aggregation")).toBe(false);
  expect(query.has("period")).toBe(false);
  expect(screen.getByRole("combobox", { name: "Time period" })).toBeDisabled();
  expect(screen.getByText(/grouped charts use the whole date range/i)).toBeInTheDocument();
});

it.each(["monthly", "quarterly", "biannual", "annual"] as const)(
  "previews a saved %s time series using the dedicated period parameter",
  async period => {
    const save = renderBuilder({ ...savedChart, aggregation: period });

    await waitFor(() => expect(previewRequests().some(query =>
      query.get("period") === period && !query.has("aggregation") && !query.has("groupBy"),
    )).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Save Chart" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ period })));
  },
);

it("retains a saved grouped chart's preferred period when editing", async () => {
  const save = renderBuilder({ ...savedChart, groupBy: "category", aggregation: "annual" });

  await waitFor(() => expect(previewRequests()[0]?.get("groupBy")).toBe("category"));
  expect(previewRequests().every(query => !query.has("aggregation") && !query.has("period"))).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Save Chart" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ period: "annual" })));
});

it("requests a new preview when the user selects a different time period", async () => {
  const save = renderBuilder();
  const periodControl = screen.getByRole("combobox", { name: "Time period" });
  expect(periodControl).toBeDisabled();
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Group by" }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: "None (time series)" }));
  await waitFor(() => expect(previewRequests().at(-1)?.get("period")).toBe("monthly"));

  fireEvent.keyDown(periodControl, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: "Every six months" }));
  await waitFor(() => expect(previewRequests().at(-1)?.get("period")).toBe("biannual"));
  fireEvent.click(screen.getByRole("button", { name: "Save Chart" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ period: "biannual" })));
});

it("previews an incompatible saved grouping as the named metric's time series", async () => {
  renderBuilder({ ...savedChart, name: "Worth", primaryMetric: "netWorth", groupBy: "category", aggregation: "quarterly" });
  await waitFor(() => expect(previewRequests().at(-1)?.get("period")).toBe("quarterly"));
  expect(previewRequests().every(query => query.get("primaryMetric") === "netWorth" && !query.has("groupBy"))).toBe(true);
  expect(screen.getByText(/only income and expenses can be grouped/i)).toBeInTheDocument();
});

it("requires choosing a supported metric before previewing or saving a legacy chart", () => {
  renderBuilder({ ...savedChart, primaryMetric: "savingsContributions" });
  expect(fetchReport).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Save Chart" })).toBeDisabled();
  expect(screen.getByText(/choose a supported primary metric/i)).toBeInTheDocument();
});
