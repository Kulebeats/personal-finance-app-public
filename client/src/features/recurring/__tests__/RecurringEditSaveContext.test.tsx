import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecurringEditModal } from "../components/RecurringEditModal";
import { useRecurringPageData } from "../hooks/useRecurringPageData";
import type { RecurringTransaction } from "@/hooks/useRecurring";

const mocks = vi.hoisted(() => ({ update: vi.fn(), refetch: vi.fn() }));
vi.mock("@/contexts/SettingsContext", () => ({ useFormatters: () => ({ currency: "ZMW" }) }));
vi.mock("@/hooks/useRecurring", () => ({
  useRecurring: () => ({ data: [], isLoading: false, error: null, refetch: mocks.refetch }),
  useRecurringCalendar: () => ({ data: [] }),
  useUpcomingBills: () => ({ data: [] }),
  useUpdateRecurring: () => ({ mutate: mocks.update, isPending: false }),
  useDeleteRecurring: () => ({ mutate: vi.fn() }),
  usePauseRecurring: () => ({ mutate: vi.fn() }),
  useSkipRecurring: () => ({ mutate: vi.fn() }),
}));

const row = (id: string): RecurringTransaction => ({ id, householdId: "household", accountId: "account", name: `Rule ${id}`,
  amount: { amount: "7.25", currency: "ZMW" }, verifiedCurrency: null, definitionToken: id.repeat(64), type: "expense",
  frequency: "monthly", nextDueDate: "2026-11-02", isActive: true, isPaused: false, createdAt: "2026-11-01", updatedAt: "2026-11-01" });
const first = row("a"), second = row("b");

/** The production caller owns form state and mutation callbacks; only its API hooks are substituted. */
function Caller() {
  const data = useRecurringPageData();
  return <>
    <button onClick={() => data.handleEdit(first)}>Edit first</button>
    <button onClick={() => data.handleEdit(second)}>Edit second</button>
    <RecurringEditModal isOpen={!!data.editItem} onClose={() => data.setEditItem(null)} form={data.editForm}
      onFormChange={updates => data.setEditForm({ ...data.editForm, ...updates })} onSave={data.handleSaveEdit}
      isSaving={data.updateRecurring.isPending} currency={data.editItem?.amount.currency} verifiedCurrency={data.editItem?.verifiedCurrency} />
  </>;
}
function enterRecovery(amount: string, name: string) {
  fireEvent.click(screen.getByLabelText("Confirm a newly entered amount in ZMW"));
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: amount } });
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } });
}
function startSave() {
  fireEvent.click(screen.getByRole("button", { name: "Edit first" }));
  enterRecovery("19.50", "Submitted A");
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  expect(mocks.update).toHaveBeenCalledTimes(1);
  expect(mocks.update.mock.calls[0][0]).toMatchObject({ id: first.id, data: { confirmDenomination: true, expectedDefinition: first.definitionToken } });
  return mocks.update.mock.calls[0][1] as { onSuccess: () => void; onError: (error: Error) => void };
}

describe("Recurring edit caller keeps pending save callbacks within their edit session", () => {
  beforeEach(() => { mocks.update.mockReset(); mocks.refetch.mockReset(); });

  for (const outcome of ["success", "error"] as const) {
    it.each(["different rule", "same rule"] as const)(`preserves a reopened %s draft when canceled save A reports late ${outcome}`, target => {
      render(<Caller />);
      const callbacks = startSave();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: target === "same rule" ? "Edit first" : "Edit second" }));
      enterRecovery("88.50", "Unsubmitted B draft");
      fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Keep this new draft" } });
      act(() => { if (outcome === "success") callbacks.onSuccess(); else callbacks.onError(new Error("Late A failure")); });
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByLabelText("Name")).toHaveValue("Unsubmitted B draft");
      expect(screen.getByLabelText("Amount")).toHaveValue(88.5);
      expect(screen.getByLabelText("Notes")).toHaveValue("Keep this new draft");
      expect(screen.getByLabelText("Confirm a newly entered amount in ZMW")).toBeChecked();
      expect(mocks.refetch).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
      const current = target === "same rule" ? first : second;
      expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({ id: current.id,
        data: expect.objectContaining({ name: "Unsubmitted B draft", amount: { amount: "88.50", currency: "ZMW" }, expectedDefinition: current.definitionToken }) }), expect.any(Object));
    });

    it(`retains the active edit's normal ${outcome} completion behavior`, () => {
      render(<Caller />);
      const callbacks = startSave();
      act(() => { if (outcome === "success") callbacks.onSuccess(); else callbacks.onError(new Error("Current recovery failure")); });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(mocks.refetch).toHaveBeenCalledTimes(outcome === "error" ? 1 : 0);
    });
  }
});
