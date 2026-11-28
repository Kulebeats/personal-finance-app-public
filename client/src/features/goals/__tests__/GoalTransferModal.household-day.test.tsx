import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { webcrypto } from "node:crypto";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Goal } from "@/hooks/useGoals";
import { setCalendarTimeZone, setHouseholdCalendarTimeZone } from "@/lib/calendarZone";
import { GoalTransferModal } from "../components/GoalTransferModal";

const mocks = vi.hoisted(() => ({ contribute: vi.fn() }));
const goalRow = (id: string, name: string) => ({ id, name, type: "save_up", currency: "ZMW",
  currentAmount: "0.00", targetAmount: "1000.00", isArchived: false });
vi.mock("@/hooks/useGoals", () => ({
  useGoals: () => ({ data: [goalRow("source", "Rainy day"), goalRow("goal", "Holiday")] }),
  useTransferBetweenGoals: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useAccounts", () => ({ useAccounts: () => ({ data: [{ id: "cash", name: "Cash", type: "cash", currency: "ZMW" }] }) }));
vi.mock("@/hooks/useCategories", () => ({ useCategories: () => ({ data: undefined }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../hooks/useContributeFromAccount", () => ({
  isOverfundRefusal: () => false,
  useContributeFromAccount: () => ({ mutateAsync: mocks.contribute, isPending: false }),
}));
// Radix Select does not open in jsdom; a native select keeps the real form, tabs and date picker under test.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value?: string; onValueChange?: (value: string) => void; children?: ReactNode }) => (
    <select value={value ?? ""} onChange={(event) => onValueChange?.(event.target.value)}><option value="">Choose</option>{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => <option value={value}>{children}</option>,
}));

// NEW-15: 22:30 UTC on 22 November is 00:30 on 23 November in Lusaka (UTC+2). This spec also runs with
// TZ=Africa/Lusaka (client/vitest.config.ts), where a toISOString() of the picked local day is a day early.
async function setZones(household: string | null, display: string | null) {
  setHouseholdCalendarTimeZone(household); setCalendarTimeZone(display); await Promise.resolve();
}
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto); mocks.contribute.mockReset().mockResolvedValue({});
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-22T22:30:00Z"));
  // The existing dialog has no description; keep that unrelated warning explicit.
  globalThis.expectConsoleMessage?.("warn", /Missing `Description` or `aria-describedby/);
});
afterEach(async () => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); await setZones(null, null); });

async function openAccountContribution(sourceGoal?: Goal) {
  const user = userEvent.setup();
  const view = render(<GoalTransferModal open onClose={vi.fn()} sourceGoal={sourceGoal} />);
  await user.click(screen.getByRole("tab", { name: "From Account" }));
  const [account, goal] = screen.getAllByRole("combobox");
  await user.selectOptions(account, "cash");
  await user.selectOptions(goal, "goal");
  await user.type(screen.getByLabelText("Amount"), "10.00");
  return { user, view };
}
async function pickDay(user: ReturnType<typeof userEvent.setup>, shown: string, day: RegExp) {
  await user.click(screen.getByRole("button", { name: shown }));
  await user.click(screen.getByRole("button", { name: day }));
}

it.each([["Africa/Lusaka", null, "2026-11-23"], [null, "Africa/Lusaka", "2026-11-22"]] as const)(
  "NEW-15: an account contribution is dated the server's household day (household %s, display %s)", async (household, display, expected) => {
    await setZones(household, display);
    const { user } = await openAccountContribution();
    await user.click(screen.getByRole("button", { name: "Transfer" }));
    await waitFor(() => expect(mocks.contribute).toHaveBeenCalledOnce());
    expect(mocks.contribute).toHaveBeenCalledWith(expect.objectContaining({ accountId: "cash", date: expected }));
  });

it("NEW-15: a refetched source goal keeps the picked date and the retry's idempotency key", async () => {
  const source = goalRow("source", "Rainy day") as unknown as Goal;
  const { user, view } = await openAccountContribution(source);
  await pickDay(user, "November 22nd, 2026", /^[A-Za-z]+day, November 20th, 2026/);
  mocks.contribute.mockRejectedValueOnce(new Error("Network unreachable"));
  await user.click(screen.getByRole("button", { name: "Transfer" }));
  await waitFor(() => expect(mocks.contribute).toHaveBeenCalledTimes(1));
  view.rerender(<GoalTransferModal open onClose={vi.fn()} sourceGoal={{ ...source }} />); // the same goal, refetched
  expect(screen.getByRole("button", { name: "November 20th, 2026" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Transfer" }));
  await waitFor(() => expect(mocks.contribute).toHaveBeenCalledTimes(2));
  const [first, retry] = mocks.contribute.mock.calls.map(([request]) => request);
  expect(first).toMatchObject({ date: "2026-11-20", accountId: "cash" });
  expect(retry.idempotencyKey).toBe(first.idempotencyKey);
  expect(retry.date).toBe("2026-11-20");
});

it("NEW-15: a household zone arriving while the dialog is open moves an untouched date, never a picked one", async () => {
  const { user } = await openAccountContribution();
  expect(screen.getByRole("button", { name: "November 22nd, 2026" })).toBeVisible();
  await act(() => setZones("Africa/Lusaka", null));
  expect(screen.getByRole("button", { name: "November 23rd, 2026" })).toBeVisible();
  await pickDay(user, "November 23rd, 2026", /^[A-Za-z]+day, November 20th, 2026/);
  await act(() => setZones(null, null));
  expect(screen.getByRole("button", { name: "November 20th, 2026" })).toBeVisible();
});
