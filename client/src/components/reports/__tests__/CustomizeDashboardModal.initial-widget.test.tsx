import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { CustomizeDashboardModal } from "../CustomizeDashboardModal";
import { useUpdateReportWidgetPreferences } from "@/hooks/use-report-widget-preferences";
import type { ReportWidgetPreferences } from "@shared/reports";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiCall: mocks.api }));
afterEach(() => { cleanup(); mocks.api.mockReset(); });
it("saves a previously absent widget through the actual checkbox and mutation with its complete first-write contract", async () => {
  const preferences: ReportWidgetPreferences = { coreWidgets: {}, optionalWidgets: {}, customCharts: [] };
  const acknowledged = { ...preferences, optionalWidgets: { cumulativeGrowth: { enabled: false, order: 1, chartType: "default" } } };
  mocks.api.mockResolvedValue({ success: true, data: { preferences: acknowledged } });
  const close = vi.fn();
  function Driver() {
    const { mutateAsync } = useUpdateReportWidgetPreferences();
    return <CustomizeDashboardModal open preferences={preferences} onOpenChange={close} onSave={mutateAsync} onReset={vi.fn()} customCharts={[]} onEditCustomChart={vi.fn()} onDeleteCustomChart={vi.fn()} />;
  }
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><Driver /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("checkbox", { name: "Enable Cumulative Growth" }));
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
  expect(JSON.parse(mocks.api.mock.calls[0][1].body)).toEqual({ optionalWidgets: { cumulativeGrowth: { enabled: false, order: 1, chartType: "default" } } });
  await waitFor(() => expect(close).toHaveBeenCalledWith(false));
  client.clear();
});

it("keeps the actual form draft open after a malformed PATCH acknowledgement and retries it", async () => {
  const preferences: ReportWidgetPreferences = { coreWidgets: {}, optionalWidgets: { monthlyTrends: { id: "monthlyTrends", enabled: true, order: 0, chartType: "bar" } }, customCharts: [] };
  const acknowledged = { ...preferences, optionalWidgets: { monthlyTrends: { ...preferences.optionalWidgets.monthlyTrends, enabled: false } } };
  mocks.api.mockResolvedValueOnce({ success: true, data: {} }).mockResolvedValueOnce({ success: true, data: { preferences: acknowledged } });
  const close = vi.fn();
  function Driver() {
    const { mutateAsync } = useUpdateReportWidgetPreferences();
    return <CustomizeDashboardModal open preferences={preferences} onOpenChange={close} onSave={mutateAsync} onReset={vi.fn()} customCharts={[]} onEditCustomChart={vi.fn()} onDeleteCustomChart={vi.fn()} />;
  }
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData(["settings", "report-widgets"], preferences);
  render(<QueryClientProvider client={client}><Driver /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("checkbox", { name: "Enable Monthly Trends" }));
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/invalid widget preferences/i));
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole("checkbox", { name: "Enable Monthly Trends" })).not.toBeChecked();
  expect(client.getQueryData(["settings", "report-widgets"])).toEqual(preferences);
  fireEvent.click(screen.getByRole("button", { name: "Retry Save" }));
  await waitFor(() => expect(close).toHaveBeenCalledWith(false));
  expect(mocks.api).toHaveBeenCalledTimes(2);
  expect(mocks.api.mock.calls[0][1].body).toEqual(mocks.api.mock.calls[1][1].body);
  client.clear();
});
