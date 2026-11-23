import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WidgetOnboardingModal } from "../WidgetOnboardingModal";
import { CustomChartBuilderModal } from "../CustomChartBuilderModal";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";

vi.mock("../CustomChartWidget", () => ({ default: () => <div>Preview</div> }));
afterEach(() => { cleanup(); retireOperationLifetime(); });

it("retains onboarding choices and retries a failed save while closing only after acknowledgement", async () => {
  const close = vi.fn();
  let resolve!: (value: unknown) => void;
  const complete = vi.fn().mockRejectedValueOnce(new Error("Invalid widget preferences response. Please retry.")).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  render(<WidgetOnboardingModal open onOpenChange={close} onComplete={complete} />);
  fireEvent.click(screen.getByRole("button", { name: /Quick Overview/ }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save & Continue" })); });
  expect(screen.getByRole("alert")).toHaveTextContent("Invalid widget preferences");
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole("checkbox", { name: "Monthly Trends" })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
  fireEvent.click(screen.getByRole("button", { name: /Saving/ }));
  expect(complete).toHaveBeenCalledTimes(2);
  expect(complete.mock.calls[1][0]).toEqual(complete.mock.calls[0][0]);
  expect(screen.getByRole("button", { name: "Skip for Now" })).toBeDisabled();
  await act(async () => { resolve(undefined); });
  expect(close).toHaveBeenCalledWith(false);
});

it("keeps a failed skip retry on the skip operation", async () => {
  const complete = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(undefined);
  const close = vi.fn();
  render(<WidgetOnboardingModal open onOpenChange={close} onComplete={complete} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Skip for Now" })); });
  expect(close).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry Skip" })); });
  expect(complete).toHaveBeenNthCalledWith(2, {});
  expect(close).toHaveBeenCalledWith(false);
});

it("does not close onboarding when its pending operation identity retires", async () => {
  const identity = createOperationLifetime(); activateOperationLifetime(identity);
  let resolve!: (value: unknown) => void;
  const complete = vi.fn().mockReturnValueOnce(new Promise(yes => { resolve = yes; })); const close = vi.fn();
  render(<WidgetOnboardingModal open onOpenChange={close} onComplete={complete} />);
  fireEvent.click(screen.getByRole("button", { name: "Save & Continue" }));
  retireOperationLifetime(identity); activateOperationLifetime(createOperationLifetime());
  await act(async () => { resolve(undefined); });
  expect(close).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it.each([undefined, { id: "existing", name: "Existing", chartType: "line", primaryMetric: "income", order: 0 }])("retains create or edit draft on failure and awaits retry acknowledgement (%s)", async initialConfig => {
  let resolve!: (value: unknown) => void;
  const save = vi.fn().mockRejectedValueOnce(new Error("Could not save chart")).mockReturnValueOnce(new Promise(yes => { resolve = yes; })); const close = vi.fn();
  render(<CustomChartBuilderModal open onOpenChange={close} onSave={save} initialConfig={initialConfig} />);
  fireEvent.change(screen.getByLabelText("Chart Name"), { target: { value: "My retained chart" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save Chart" })); });
  expect(screen.getByRole("alert")).toHaveTextContent("Could not save chart");
  expect(screen.getByLabelText("Chart Name")).toHaveValue("My retained chart");
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry Save" }));
  fireEvent.click(screen.getByRole("button", { name: /Saving/ }));
  expect(save).toHaveBeenCalledTimes(2);
  await act(async () => { resolve(undefined); });
  expect(close).toHaveBeenCalledWith(false);
});
