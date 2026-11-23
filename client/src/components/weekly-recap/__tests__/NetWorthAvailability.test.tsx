/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  worth: {} as Record<string, unknown> | null,
  checking: false, error: null as Error | null,
  next: vi.fn(), previous: vi.fn(), feedback: vi.fn(),
}));
vi.mock("../WeeklyRecapContext", () => ({ useWeeklyRecap: () => ({
  data: state.worth === null ? undefined : { netWorth: state.worth }, isChecking: state.checking, error: state.error,
  nextStep: state.next, prevStep: state.previous, submitStepFeedback: state.feedback,
}) }));
vi.mock("@/contexts/SettingsContext", () => ({ useFormatters: () => ({ formatCurrency: (value: number) => `USD ${value}` }) }));
vi.mock("../components/WeeklyChart", () => ({ default: () => <div aria-label="Worth chart" /> }));
import NetWorthStep from "../steps/NetWorthStep";

describe("recap worth availability", () => {
  beforeEach(() => { vi.clearAllMocks(); state.checking = false; state.error = null; });
  it("shows unavailable history without a fabricated value or trend and retains navigation", () => {
    state.worth = { status: "unavailable", currency: "ZMW", current: null, previous: null, change: null, changePercent: null, trend: null, series: [] };
    render(<NetWorthStep />);
    expect(screen.getByText(/Historical net worth is unavailable/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Worth chart")).not.toBeInTheDocument();
    expect(screen.queryByText(/USD/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(state.next).toHaveBeenCalledOnce();
  });
  it("preserves a valid captured value and identifies an absent comparison", () => {
    state.worth = { status: "partial", currency: "ZMW", asOf: "2026-10-31", current: 988.89, previous: null, change: null, changePercent: null,
      trend: null, series: [{ date: "2026-10-31", value: 988.89 }] };
    render(<NetWorthStep />);
    expect(screen.getByText(/ZMW.*988\.89/)).toBeInTheDocument();
    expect(screen.getByText(/Previous period unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/USD/)).not.toBeInTheDocument();
  });
  it("does not invent a percentage for a supported change from zero", () => {
    state.worth = { status: "available", currency: "ZMW", current: 20, previous: 0, change: 20, changePercent: null, trend: "up", series: [] };
    render(<NetWorthStep />);
    expect(screen.getAllByText(/ZMW.*20/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
  it.each(["checking", "error"])("explains a withdrawn %s projection without a blank step", status => {
    state.worth = null;
    state.checking = status === "checking";
    state.error = status === "error" ? new Error("synthetic protected read failure") : null;
    render(<NetWorthStep />);
    expect(screen.getByRole(status === "checking" ? "status" : "alert")).toHaveTextContent(status === "checking" ? /Checking current access/i : /Unable to refresh/i);
    expect(screen.queryByText(/USD/)).not.toBeInTheDocument();
  });
  it.each([true, false])("retains a supported previous MoneyDTO when current data is absent=%s", missingCurrent => {
    state.worth = { status: "partial", currency: missingCurrent ? "ZMW" : "USD", current: missingCurrent ? null : 20,
      currentMoney: missingCurrent ? null : { amount: "20.00", currency: "USD" }, previous: missingCurrent ? 900 : null,
      previousMoney: { amount: "900.00", currency: "ZMW" }, previousAsOf: "2026-10-24", change: null, changePercent: null, trend: null, series: [] };
    render(<NetWorthStep />);
    expect(screen.getByText(/ZMW.*900/)).toBeInTheDocument();
    expect(screen.getByText(/Previous snapshot 2026-10-24/)).toBeInTheDocument();
    expect(screen.getByText(/Comparison unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});
