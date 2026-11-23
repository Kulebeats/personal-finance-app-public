import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { DetectedPattern } from "@/hooks/useRecurring";
import { RecurringPatternsModal } from "../components/RecurringPatternsModal";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime, type OperationLifetime } from "@/lib/operation-lifetime";

const mocks = vi.hoisted(() => ({ detect: vi.fn(), confirm: vi.fn(), actor: "actor-a", operation: null as OperationLifetime | null }));
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({ lifetime: { key: mocks.actor, operation: mocks.operation } }) }));
vi.mock("@/hooks/useRecurring", () => ({
  useDetectPatterns: () => ({ mutate: mocks.detect, isPending: false, isError: false }),
  useConfirmPattern: () => ({ mutate: mocks.confirm, isPending: false, isError: false }),
}));
vi.mock("@/hooks/useAccounts", () => ({ useAccounts: () => ({ data: [
  { id: "real-account-id", name: "Visible ZMW account", currency: "ZMW", isArchived: false },
  { id: "other-currency-id", name: "USD account", currency: "USD", isArchived: false },
  { id: "archived-id", name: "Archived account", currency: "ZMW", isArchived: true },
], isError: false }) }));
vi.mock("@/components/ui/scroll-area", () => ({ ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

function pattern(overrides: Partial<DetectedPattern> = {}): DetectedPattern {
  return { name: "Monthly detected bill", type: "expense", estimatedAmount: { amount: "7.25", currency: "ZMW" },
    frequency: "monthly", confidence: 95, amountVariance: 0, amountTolerance: 0, occurrences: 3,
    sampleTransactionIds: ["transaction-preview-id"], suggestedStartDate: "2026-08-10", suggestedNextDueDate: "2026-11-10",
    selection: { version: 1, startDate: "2026-05-02", endDate: "2026-11-02", groupKey: "group",
      timezone: "Africa/Lusaka", timezoneSource: "profile",
      options: { minOccurrences: 3, lookbackMonths: 6, confidenceThreshold: 80 },
      contributorIds: ["source-a", "source-b", "source-c"], fingerprint: "a".repeat(64) }, ...overrides };
}
function show() {
  const view = render(<RecurringPatternsModal><button>Scan recurring history</button></RecurringPatternsModal>);
  fireEvent.click(screen.getByRole("button", { name: "Scan recurring history" }));
  return view;
}
describe("recurring detection confirmation uses the real selection and destination", () => {
  beforeEach(() => {
    mocks.detect.mockReset(); mocks.confirm.mockReset(); mocks.actor = "actor-a";
    mocks.operation = createOperationLifetime({ subject: mocks.actor });
    activateOperationLifetime(mocks.operation);
  });
  afterEach(() => { retireOperationLifetime(mocks.operation); retireOperationLifetime(); });

  it("shows 0-100 confidence and requires a real visible account before submitting the complete selection", () => {
    const detected = pattern();
    mocks.detect.mockImplementation((_input, options: { onSuccess: (rows: DetectedPattern[]) => void }) => options.onSuccess([detected]));
    show();
    expect(screen.getByText("95% Match")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Rule" })).toBeDisabled();
    const account = screen.getByLabelText("Destination account for Monthly detected bill");
    expect(screen.queryByRole("option", { name: /USD account|Archived account/ })).not.toBeInTheDocument();
    fireEvent.change(account, { target: { value: "real-account-id" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Rule" }));
    expect(mocks.confirm).toHaveBeenCalledWith({ pattern: detected, accountId: "real-account-id" }, expect.any(Object));
  });

  it("replaces the local scan results and clears the old account choice on Scan Again", () => {
    const first = pattern(), replacement = pattern({ name: "Newly detected bill", selection: { ...pattern().selection!, fingerprint: "b".repeat(64) } });
    mocks.detect.mockImplementationOnce((_input, options: { onSuccess: (rows: DetectedPattern[]) => void }) => options.onSuccess([first]))
      .mockImplementationOnce((_input, options: { onSuccess: (rows: DetectedPattern[]) => void }) => options.onSuccess([replacement]));
    show();
    fireEvent.change(screen.getByLabelText("Destination account for Monthly detected bill"), { target: { value: "real-account-id" } });
    fireEvent.click(screen.getByRole("button", { name: "Scan Again" }));
    expect(screen.queryByText("Monthly detected bill")).not.toBeInTheDocument();
    expect(screen.getByText("Newly detected bill")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Rule" })).toBeDisabled();
  });

  it("shows actionable denomination refusal and distinguishes measured deviation from the rule cap", () => {
    const detected = pattern({ confirmationIssue: "Multi-currency recurring is not supported yet; no conversion was performed.",
      estimatedAmount: { amount: "2.17", currency: "USD" }, amountVariance: 52.125, amountTolerance: 50 });
    mocks.detect.mockImplementation((_input, options: { onSuccess: (rows: DetectedPattern[]) => void }) => options.onSuccess([detected]));
    show();
    expect(screen.getByText(/no conversion was performed/)).toBeInTheDocument();
    expect(screen.getByText(/Measured relative deviation: 52.13%. Rule tolerance: 50%/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Rule" })).toBeDisabled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("withdraws mounted rows and destinations when a fresh rescan fails", () => {
    mocks.detect.mockImplementationOnce((_input, options: { onSuccess: (rows: DetectedPattern[]) => void }) => options.onSuccess([pattern()]))
      .mockImplementationOnce((_input, options: { onError?: (error: Error) => void }) => options.onError?.(new Error("Access withdrawn")));
    show();
    fireEvent.change(screen.getByLabelText("Destination account for Monthly detected bill"), { target: { value: "real-account-id" } });
    fireEvent.click(screen.getByRole("button", { name: "Scan Again" }));
    expect(screen.queryByText("Monthly detected bill")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Rule" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Destination account for Monthly detected bill")).not.toBeInTheDocument();
  });

  it("rescans on reopen and discards a previous successful selection when access is withdrawn", () => {
    mocks.detect.mockImplementationOnce((_input, options: { onSuccess: (rows: DetectedPattern[]) => void }) => options.onSuccess([pattern()]))
      .mockImplementationOnce((_input, options: { onError?: (error: Error) => void }) => options.onError?.(new Error("Access withdrawn")));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Scan recurring history" }));
    expect(mocks.detect).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Monthly detected bill")).not.toBeInTheDocument();
  });

  it("withdraws rows immediately when the mounted actor changes", () => {
    mocks.detect.mockImplementation((_input, options: { onSuccess: (rows: DetectedPattern[]) => void }) => options.onSuccess([pattern()]));
    const view = show();
    expect(screen.getByText("Monthly detected bill")).toBeInTheDocument();
    mocks.actor = "actor-b";
    view.rerender(<RecurringPatternsModal><button>Scan recurring history</button></RecurringPatternsModal>);
    expect(screen.queryByText("Monthly detected bill")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Rule" })).not.toBeInTheDocument();
  });

  it("does not replace a fresh scan with an older late response", () => {
    let finishOlder: ((rows: DetectedPattern[]) => void) | undefined;
    mocks.detect.mockImplementationOnce((_input, options: { onSuccess: (rows: DetectedPattern[]) => void }) => options.onSuccess([pattern()]))
      .mockImplementationOnce((_input, options: { onSuccess: (rows: DetectedPattern[]) => void }) => { finishOlder = options.onSuccess; })
      .mockImplementationOnce((_input, options: { onSuccess: (rows: DetectedPattern[]) => void }) => options.onSuccess([pattern({ name: "Current result" })]));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Scan Again" }));
    fireEvent.click(screen.getByRole("button", { name: "Scan Again" }));
    expect(screen.getByText("Current result")).toBeInTheDocument();
    expect(finishOlder).toBeTypeOf("function");
    act(() => finishOlder?.([pattern({ name: "STALE_PRIVATE_RESULT" })]));
    expect(screen.getByText("Current result")).toBeInTheDocument();
    expect(screen.queryByText("STALE_PRIVATE_RESULT")).not.toBeInTheDocument();
  });

  it("withdraws rows and the chosen destination after confirmation loses access", () => {
    mocks.detect.mockImplementation((_input, options: { onSuccess: (rows: DetectedPattern[]) => void }) => options.onSuccess([pattern()]));
    mocks.confirm.mockImplementation((_input, options: { onError?: (error: Error) => void }) => options.onError?.(new Error("Access withdrawn")));
    show();
    fireEvent.change(screen.getByLabelText("Destination account for Monthly detected bill"), { target: { value: "real-account-id" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Rule" }));
    expect(screen.queryByText("Monthly detected bill")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Destination account for Monthly detected bill")).not.toBeInTheDocument();
  });

  it("cannot submit an old preview after its data lifetime retires before React changes actor", () => {
    mocks.detect.mockImplementation((_input, options: { onSuccess: (rows: DetectedPattern[]) => void }) => options.onSuccess([pattern()]));
    show();
    fireEvent.change(screen.getByLabelText("Destination account for Monthly detected bill"), { target: { value: "real-account-id" } });
    retireOperationLifetime(mocks.operation);
    activateOperationLifetime(createOperationLifetime({ subject: "actor-b" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Rule" }));
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(screen.queryByText("Monthly detected bill")).not.toBeInTheDocument();
  });
});
