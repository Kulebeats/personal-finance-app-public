import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CustomizeDashboardCustomTab } from "../CustomizeDashboardCustomTab";

afterEach(cleanup);
it("keeps a failed chart deletion visible and retries it without closing the customization dialog", async () => {
  let resolve!: () => void;
  const remove = vi.fn().mockRejectedValueOnce(new Error("Could not delete chart")).mockReturnValueOnce(new Promise<void>(yes => { resolve = yes; }));
  const close = vi.fn();
  render(<CustomizeDashboardCustomTab customCharts={[{ id: "legacy", name: "Saved chart", chartType: "bar", primaryMetric: "income", order: 0 }]} onEditCustomChart={vi.fn()} onDeleteCustomChart={remove} onClose={close} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Delete Saved chart" })); });
  expect(screen.getByRole("alert")).toHaveTextContent("Could not delete chart");
  expect(screen.getByText("Saved chart")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry Delete" }));
  expect(screen.getByRole("button", { name: "Delete Saved chart" })).toBeDisabled();
  expect(remove).toHaveBeenNthCalledWith(2, "legacy");
  await act(async () => { resolve(); });
  expect(close).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
