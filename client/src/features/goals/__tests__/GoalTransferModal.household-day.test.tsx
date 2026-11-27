import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { setHouseholdCalendarTimeZone } from "@/lib/calendarZone";
import { GoalTransferModal } from "../components/GoalTransferModal";

const mocks = vi.hoisted(() => ({ contribute: vi.fn() }));
vi.mock("@/hooks/useGoals", () => ({
  useGoals: () => ({ data: [{ id: "goal", name: "Holiday", type: "save_up", currency: "ZMW",
    currentAmount: "0.00", targetAmount: "1000.00", isArchived: false }] }),
  useTransferBetweenGoals: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useAccounts", () => ({ useAccounts: () => ({ data: [{ id: "cash", name: "Cash", currency: "ZMW" }] }) }));
vi.mock("@/hooks/useCategories", () => ({ useCategories: () => ({ data: undefined }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/api", () => ({ generateIdempotencyKey: () => "contribution-1" }));
vi.mock("../hooks/useContributeFromAccount", () => ({
  isOverfundRefusal: () => false,
  useContributeFromAccount: () => ({ mutateAsync: mocks.contribute, isPending: false }),
}));
// The form's Radix selects are not under test here: plain buttons drive the modal's own state.
vi.mock("../components/GoalTransferForm", () => ({
  GoalTransferForm: (props: { onModeChange: (mode: string) => void; onFromChange: (id: string) => void;
    onToGoalChange: (id: string) => void; onAmountChange: (amount: string) => void }): ReactNode => (
    <div>
      <button onClick={() => props.onModeChange("account-to-goal")}>From account</button>
      <button onClick={() => props.onFromChange("cash")}>Choose cash</button>
      <button onClick={() => props.onToGoalChange("goal")}>Choose holiday</button>
      <button onClick={() => props.onAmountChange("10.00")}>Enter ten</button>
    </div>
  ),
}));

afterEach(async () => { cleanup(); vi.useRealTimers(); setHouseholdCalendarTimeZone(null); await Promise.resolve(); });

it("NEW-15: a contribution from an account is dated the household's day just after its midnight, not UTC's", async () => {
  // 22:30 UTC on 22 November is 00:30 on 23 November in Lusaka (UTC+2).
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-22T22:30:00Z"));
  setHouseholdCalendarTimeZone("Africa/Lusaka"); await Promise.resolve();
  mocks.contribute.mockResolvedValue({});
  const user = userEvent.setup();
  // The existing dialog has no description; keep that unrelated warning explicit.
  globalThis.expectConsoleMessage?.("warn", /Missing `Description` or `aria-describedby/);
  render(<GoalTransferModal open onClose={vi.fn()} />);
  for (const name of ["From account", "Choose cash", "Choose holiday", "Enter ten", "Transfer"]) {
    await user.click(screen.getByRole("button", { name }));
  }
  await waitFor(() => expect(mocks.contribute).toHaveBeenCalledOnce());
  expect(mocks.contribute).toHaveBeenCalledWith(expect.objectContaining({ accountId: "cash", date: "2026-11-23" }));
});
