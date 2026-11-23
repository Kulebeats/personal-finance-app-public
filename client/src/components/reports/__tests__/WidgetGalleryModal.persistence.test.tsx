import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WidgetGalleryModal } from "../WidgetGalleryModal";

const mocks = vi.hoisted(() => ({ toggle: vi.fn(), reset: vi.fn() }));
vi.mock("@/hooks/use-report-widget-preferences", () => ({
  useReportWidgetPreferences: () => ({ data: { coreWidgets: { summaryCards: { enabled: true, order: 0 } }, optionalWidgets: {}, customCharts: [] } }),
  useWidgetToggle: () => ({ toggleWidget: mocks.toggle }),
  useResetReportWidgetPreferences: () => ({ mutateAsync: mocks.reset }),
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("keeps the gallery open on a failed reset and offers a working retry", async () => {
  let resolve!: () => void;
  mocks.reset.mockRejectedValueOnce(new Error("Reset unavailable")).mockReturnValueOnce(new Promise<void>(yes => { resolve = yes; }));
  const close = vi.fn();
  render(<WidgetGalleryModal open onOpenChange={close} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reset Defaults" })); });
  expect(screen.getByRole("alert")).toHaveTextContent("Reset unavailable");
  expect(screen.getByText(/custom charts.*retained/i)).toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry Reset" }));
  expect(screen.getByRole("button", { name: "Resetting…" })).toBeDisabled();
  expect(screen.getByRole("switch")).toBeDisabled();
  await act(async () => { resolve(); });
  expect(close).toHaveBeenCalledWith(false);
});

it("surfaces a failed toggle without changing the acknowledged switch and retries that exact action", async () => {
  mocks.toggle.mockRejectedValueOnce(new Error("Toggle unavailable")).mockResolvedValueOnce(undefined);
  render(<WidgetGalleryModal open />);
  await act(async () => { fireEvent.click(screen.getByRole("switch")); });
  expect(screen.getByRole("alert")).toHaveTextContent("Toggle unavailable");
  expect(screen.getByRole("switch")).toBeChecked();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry Change" })); });
  expect(mocks.toggle).toHaveBeenNthCalledWith(2, "coreWidgets", "summaryCards", false);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
