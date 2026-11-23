import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReportWidgetPreferences } from "@shared/reports";
import { CustomizeDashboardModal } from "../CustomizeDashboardModal";

vi.mock("../CustomizeDashboardOptionalTab", () => ({
  CustomizeDashboardOptionalTab: ({ orderedOptional, toggleOptional }: { orderedOptional: { id: string; enabled: boolean }[]; toggleOptional: (id: string, enabled: boolean) => void }) => <>{orderedOptional.map(widget => <button key={widget.id} onClick={() => toggleOptional(widget.id, !widget.enabled)}>{widget.id}:{String(widget.enabled)}</button>)}</>,
}));
const preferences: ReportWidgetPreferences = {
  coreWidgets: { summaryCards: { id: "summaryCards", enabled: true, order: 0 } },
  optionalWidgets: { monthlyTrends: { id: "monthlyTrends", enabled: true, order: 4, chartType: "line", expanded: true } },
  customCharts: [], hasCompletedWidgetSetup: true,
};
const baseProps = { open: true, preferences, onReset: vi.fn(), customCharts: [], onEditCustomChart: vi.fn(), onDeleteCustomChart: vi.fn() };
afterEach(cleanup);

it("retains a local edit across refetch and saves no stale sibling fields or injected defaults", async () => {
  const close = vi.fn(); const save = vi.fn().mockResolvedValue(preferences);
  const view = render(<CustomizeDashboardModal {...baseProps} onOpenChange={close} onSave={save} />);
  fireEvent.click(screen.getByText("monthlyTrends:true"));
  view.rerender(<CustomizeDashboardModal {...baseProps} preferences={{ ...preferences, optionalWidgets: { monthlyTrends: { ...preferences.optionalWidgets.monthlyTrends, chartType: "bar", order: 9 } } }} onOpenChange={close} onSave={save} />);
  expect(screen.getByText("monthlyTrends:false")).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByText("Save Changes")); });
  expect(save).toHaveBeenCalledWith({ optionalWidgets: { monthlyTrends: { enabled: false } } });
  expect(close).toHaveBeenCalledWith(false);
});

it("keeps a failed modal open with its draft and supports an explicit retry", async () => {
  const close = vi.fn(); const save = vi.fn().mockRejectedValueOnce(new Error("Could not save layout")).mockResolvedValueOnce(preferences);
  render(<CustomizeDashboardModal {...baseProps} onOpenChange={close} onSave={save} />);
  fireEvent.click(screen.getByText("monthlyTrends:true"));
  await act(async () => { fireEvent.click(screen.getByText("Save Changes")); });
  expect(screen.getByRole("alert")).toHaveTextContent("Could not save layout");
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByText("monthlyTrends:false")).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByText("Retry Save")); });
  expect(save).toHaveBeenCalledTimes(2);
  expect(close).toHaveBeenCalledWith(false);
});

it("keeps edits made during a pending save open and sends their changed field on the next save", async () => {
  let resolve!: (prefs: ReportWidgetPreferences) => void;
  const pending = new Promise<ReportWidgetPreferences>(yes => { resolve = yes; });
  const close = vi.fn(); const save = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(preferences);
  render(<CustomizeDashboardModal {...baseProps} onOpenChange={close} onSave={save} />);
  fireEvent.click(screen.getByText("monthlyTrends:true"));
  fireEvent.click(screen.getByText("Save Changes"));
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  fireEvent.click(screen.getByText("monthlyTrends:false"));
  await act(async () => { resolve({ ...preferences, optionalWidgets: { monthlyTrends: { ...preferences.optionalWidgets.monthlyTrends, enabled: false } } }); });
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByText("monthlyTrends:true")).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByText("Save Changes")); });
  expect(save).toHaveBeenLastCalledWith({ optionalWidgets: { monthlyTrends: { enabled: true } } });
  expect(close).toHaveBeenCalledWith(false);
});

it("omits a reverted default field and closes after the remaining edits are acknowledged", async () => {
  const close = vi.fn(); const save = vi.fn().mockResolvedValue(preferences);
  render(<CustomizeDashboardModal {...baseProps} onOpenChange={close} onSave={save} />);
  fireEvent.click(screen.getByText("cumulativeGrowth:true"));
  fireEvent.click(screen.getByText("cumulativeGrowth:false"));
  fireEvent.click(screen.getByText("monthlyTrends:true"));
  await act(async () => { fireEvent.click(screen.getByText("Save Changes")); });
  expect(save).toHaveBeenCalledWith({ optionalWidgets: { monthlyTrends: { enabled: false } } });
  expect(close).toHaveBeenCalledWith(false);
});

it("awaits reset acknowledgement, preserves the draft on failure, and retries explicitly", async () => {
  let resolve!: (prefs: ReportWidgetPreferences) => void;
  const reset = vi.fn().mockRejectedValueOnce(new Error("Reset failed")).mockReturnValueOnce(new Promise<ReportWidgetPreferences>(yes => { resolve = yes; }));
  const close = vi.fn(); const save = vi.fn();
  render(<CustomizeDashboardModal {...baseProps} onReset={reset} onOpenChange={close} onSave={save} />);
  fireEvent.click(screen.getByText("monthlyTrends:true"));
  await act(async () => { fireEvent.click(screen.getByText("Reset Defaults")); });
  expect(screen.getByRole("alert")).toHaveTextContent("Reset failed");
  expect(screen.getByText("monthlyTrends:false")).toBeInTheDocument();
  expect(screen.getByText(/custom charts.*retained/i)).toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Retry Reset"));
  fireEvent.click(screen.getByText("Resetting…"));
  expect(reset).toHaveBeenCalledTimes(2);
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getByText("monthlyTrends:false")).toBeDisabled();
  fireEvent.click(screen.getByText("monthlyTrends:false"));
  expect(screen.getByText("monthlyTrends:false")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(close).not.toHaveBeenCalled();
  await act(async () => { resolve(preferences); });
  expect(close).toHaveBeenCalledWith(false);
});
