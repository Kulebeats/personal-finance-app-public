/**
 * N8 (b)2: a new household is on the flex system before it has a flex
 * budget. Its first flex amount used to be dropped without a word; now the
 * flex budget is created and the amount written to it, or the failure shown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { BudgetWithProgress, useCreateBudget } from "@/hooks/useBudgets";
import type { Category, CategoryGroup } from "@/hooks/use-settings";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";

const { ensureFlexBudget, toast, useUpdateBudget } = vi.hoisted(() => ({
  ensureFlexBudget: vi.fn(), toast: vi.fn(), useUpdateBudget: vi.fn(),
}));

vi.mock("@/hooks/useBudgets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useBudgets")>()),
  ensureFlexBudget,
  useUpdateBudget,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import { useBudgetGroups } from "../hooks/useBudgetGroups";

const FLEX_GROUP = "flexible-expenses";
const CREATED = { id: "flex-1", householdId: "h-1", name: "Flexible Budget", amount: { amount: "0.00", currency: "ZMW" }, isFlexBucket: true };
const WITHHELD = { id: "flex-1", name: "Flexible Budget", categoryId: null, categoryGroupId: null, currency: "USD",
  reason: { code: "BUDGET_CURRENCY_MISMATCH", message: "The flexible limit is unavailable." } };
const money = (amount: string, currency = "ZMW") => ({ amount, currency });

type GroupProps = Parameters<typeof useBudgetGroups>[0];
const activateHousehold = (household = "h-1") => activateOperationLifetime(createOperationLifetime({ subject: "actor", household }));

beforeEach(() => activateHousehold());
afterEach(() => retireOperationLifetime());

function setup(overrides: Partial<GroupProps> = {}) {
  const updateBudget = { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue(CREATED) };
  useUpdateBudget.mockReturnValue(updateBudget);
  const createBudget = { mutate: vi.fn() } as unknown as ReturnType<typeof useCreateBudget>;
  // One props object for every render: fresh arrays would re-run the hook's
  // effects on each render and never settle.
  let props: GroupProps = {
    apiBudgets: [], categories: [], categoryGroups: [], budgetSystem: "flex", householdId: "h-1", householdCurrency: "ZMW", reportingCurrency: "ZMW",
    selectedYear: 2026, selectedMonth: 11, isBudgetView: true,
    createBudget, setLocation: vi.fn(), ...overrides,
  };
  const view = renderHook(useBudgetGroups, { initialProps: props });
  return { ...view, updateBudget,
    changeScope(next: Partial<GroupProps>) { props = { ...props, ...next }; view.rerender(props); },
  };
}

function progress(fields: Partial<BudgetWithProgress>): BudgetWithProgress {
  return { id: "limit", name: "Synthetic limit", householdId: "h-1", amount: money("500.00"),
    spent: money("0.00"), remaining: money("500.00"), percentUsed: 0, period: "monthly",
    rolloverEnabled: false, isActive: true, createdAt: "", updatedAt: "", ...fields };
}

describe("useBudgetGroups flex amount on a household with no flex budget", () => {
  beforeEach(() => {
    ensureFlexBudget.mockReset();
    toast.mockReset();
  });

  it("creates the flex budget, then writes the amount to it in its currency", async () => {
    ensureFlexBudget.mockResolvedValue(CREATED);
    const { result, updateBudget } = setup();
    act(() => result.current.commitGroupBudget(FLEX_GROUP, 1500));
    await waitFor(() => expect(updateBudget.mutateAsync).toHaveBeenCalledTimes(1));
    expect(ensureFlexBudget).toHaveBeenCalledTimes(1);
    expect(updateBudget.mutateAsync.mock.calls[0][0]).toMatchObject({
      id: "flex-1",
      data: { amount: { amount: "1500.00", currency: "ZMW" } },
    });
  });

  it("says the budget was not saved, in plain copy, when the flex budget cannot be created", async () => {
    // A server message is never shown; with no code or status the fallback is.
    ensureFlexBudget.mockRejectedValue(new Error("Synthetic server failure"));
    const { result, updateBudget } = setup();
    act(() => result.current.commitGroupBudget(FLEX_GROUP, 1500));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Budget not saved", description: "The flex budget could not be created.", variant: "destructive",
    })));
    expect(updateBudget.mutateAsync).not.toHaveBeenCalled();
  });

  it("does not reinterpret the draft when ensure returns an already existing foreign bucket", async () => {
    ensureFlexBudget.mockResolvedValue({ ...CREATED, currency: "USD", amount: money("500.00", "USD") });
    const { result, updateBudget } = setup();
    act(() => result.current.updateGroupBudget(FLEX_GROUP, 1500));
    act(() => result.current.commitGroupBudget(FLEX_GROUP, 1500));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Budget not saved", description: expect.stringMatching(/different currency/i), variant: "destructive",
    })));
    expect(ensureFlexBudget).toHaveBeenCalledOnce();
    expect(updateBudget.mutateAsync).not.toHaveBeenCalled();
    expect(result.current.totalExpenseBudget).toBeNull();
  });

  it("does not ensure a bucket when the household write denomination is unknown", () => {
    const { result, updateBudget } = setup({ householdCurrency: undefined });
    act(() => result.current.commitGroupBudget(FLEX_GROUP, 1500));
    expect(ensureFlexBudget).not.toHaveBeenCalled();
    expect(updateBudget.mutateAsync).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Budget not saved", variant: "destructive" }));
  });

  it("never ensures or updates a configured flexible bucket that progress withheld", () => {
    const { result, updateBudget } = setup({ unavailableBudgets: [WITHHELD] });
    expect(result.current.displayGroups.find(group => group.id === FLEX_GROUP)).toMatchObject({ budget: null, hasWithheldLimit: true });
    act(() => result.current.updateGroupBudget(FLEX_GROUP, 1500));
    act(() => result.current.commitGroupBudget(FLEX_GROUP, 1500));
    expect(ensureFlexBudget).not.toHaveBeenCalled();
    expect(updateBudget.mutateAsync).not.toHaveBeenCalled();
    expect(result.current.totalExpenseBudget).toBeNull();
  });

  it("keeps direct updates on the known native denomination of an available flex bucket", async () => {
    const { result, updateBudget } = setup({ householdCurrency: "USD", reportingCurrency: "USD", apiBudgets: [
      progress({ id: CREATED.id, isFlexBucket: true, currency: "USD", amount: money("500.00", "USD"),
        spent: money("0.00", "USD"), remaining: money("500.00", "USD") }),
    ] });
    await act(async () => result.current.commitGroupBudget(FLEX_GROUP, 625.5));
    expect(ensureFlexBudget).not.toHaveBeenCalled();
    expect(updateBudget.mutateAsync.mock.calls[0][0]).toMatchObject({ id: CREATED.id, data: { amount: money("625.50", "USD") } });
  });

  it.each(["currency", "month", "target", "withheld row", "household", "mode", "view"] as const)(
    "retires the draft and saved handler when %s changes without changing the amount", change => {
      const original = progress({ id: CREATED.id, isFlexBucket: true });
      const { result, updateBudget, changeScope } = setup({ apiBudgets: [original] });
      act(() => result.current.updateGroupBudget(FLEX_GROUP, 725.5));
      expect(result.current.flexBudgetDraft).toBe(725.5);
      const previousCommit = result.current.commitGroupBudget;
      switch (change) {
        case "currency": changeScope({ householdCurrency: "USD", reportingCurrency: "USD", apiBudgets: [
          { ...original, currency: "USD", amount: money("500.00", "USD"), spent: money("0.00", "USD"), remaining: money("500.00", "USD") },
        ] }); break;
        case "month": changeScope({ selectedMonth: 12 }); break;
        case "target": changeScope({ apiBudgets: [{ ...original, id: "different-flex" }] }); break;
        case "withheld row": changeScope({ unavailableBudgets: [WITHHELD] }); break;
        case "household":
          activateHousehold("h-2");
          changeScope({ householdId: "h-2", apiBudgets: [{ ...original, householdId: "h-2" }] });
          break;
        case "mode": changeScope({ budgetSystem: "category" }); break;
        case "view": changeScope({ isBudgetView: false }); break;
      }
      expect(result.current.flexBudgetDraft).not.toBe(725.5);
      act(() => previousCommit(FLEX_GROUP, 725.5));
      expect(updateBudget.mutateAsync).not.toHaveBeenCalled();
      expect(ensureFlexBudget).not.toHaveBeenCalled();
    },
  );

  it.each(["month", "target", "household", "unmount"] as const)("ignores a delayed ensure after %s changes", async change => {
    let finish!: (row: typeof CREATED) => void;
    const ensure = new Promise<typeof CREATED>(resolve => { finish = resolve; });
    ensureFlexBudget.mockReturnValueOnce(ensure);
    const { result, updateBudget, changeScope, unmount } = setup();
    act(() => result.current.updateGroupBudget(FLEX_GROUP, 725.5));
    act(() => result.current.commitGroupBudget(FLEX_GROUP, 725.5));
    expect(ensureFlexBudget).toHaveBeenCalledOnce();

    if (change === "unmount") unmount();
    if (change === "month") changeScope({ selectedMonth: 12 });
    if (change === "target") changeScope({ apiBudgets: [progress({ id: "other-flex", isFlexBucket: true })] });
    if (change === "household") {
      activateHousehold("h-2");
      changeScope({ householdId: "h-2" });
    }
    if (change !== "unmount") {
      expect(result.current.flexBudgetDraft).not.toBe(725.5);
      act(() => result.current.updateGroupBudget(FLEX_GROUP, 850));
    }
    await act(async () => { finish(CREATED); await ensure; });
    expect(updateBudget.mutateAsync).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    if (change !== "unmount") expect(result.current.flexBudgetDraft).toBe(850);
  });
});

describe("single admitted flexible save", () => {
  beforeEach(() => { ensureFlexBudget.mockReset(); toast.mockReset(); });

  it.each(["new", "existing"] as const)("keeps the admitted value and refuses overlapping commits for a %s bucket", async target => {
    const existing = target === "existing";
    const { result, updateBudget } = setup({ apiBudgets: existing ? [progress({ id: CREATED.id, isFlexBucket: true })] : [] });
    let finishEnsure!: (row: typeof CREATED) => void;
    const ensure = new Promise<typeof CREATED>(resolve => { finishEnsure = resolve; });
    ensureFlexBudget.mockReturnValueOnce(ensure);
    let finishUpdate!: (row: typeof CREATED) => void;
    const write = new Promise<typeof CREATED>(resolve => { finishUpdate = resolve; });
    updateBudget.mutateAsync.mockReturnValueOnce(write);

    act(() => {
      result.current.updateGroupBudget(FLEX_GROUP, 620.5);
      result.current.commitGroupBudget(FLEX_GROUP, 620.5);
      result.current.updateGroupBudget(FLEX_GROUP, 850);
      result.current.commitGroupBudget(FLEX_GROUP, 850);
    });
    const editor = () => result.current.displayGroups.find(group => group.id === FLEX_GROUP);
    expect(editor()).toMatchObject({ budgetDraft: 620.5, budgetEditPending: true });
    expect(ensureFlexBudget).toHaveBeenCalledTimes(existing ? 0 : 1);
    expect(updateBudget.mutateAsync).toHaveBeenCalledTimes(existing ? 1 : 0);
    await act(async () => { finishEnsure(CREATED); await ensure; });

    act(() => result.current.commitGroupBudget(FLEX_GROUP, 940));
    expect(updateBudget.mutateAsync).toHaveBeenCalledOnce();
    expect(updateBudget.mutateAsync.mock.calls[0][0]).toMatchObject({ id: CREATED.id, data: { amount: money("620.50") } });
    expect(editor()).toMatchObject({ budgetDraft: 620.5, budgetEditPending: true });
    await act(async () => { finishUpdate(CREATED); await write; });
    expect(editor()).toMatchObject({ budgetDraft: 620.5, budgetEditPending: false });
  });

  it("keeps an old ensure retired when the same scope is visited again", async () => {
    const { result, changeScope, updateBudget } = setup();
    let finishOld!: (row: typeof CREATED) => void;
    let finishCurrent!: (row: typeof CREATED) => void;
    const oldEnsure = new Promise<typeof CREATED>(resolve => { finishOld = resolve; });
    const currentEnsure = new Promise<typeof CREATED>(resolve => { finishCurrent = resolve; });
    ensureFlexBudget.mockReturnValueOnce(oldEnsure).mockReturnValueOnce(currentEnsure);
    act(() => result.current.commitGroupBudget(FLEX_GROUP, 620.5));
    expect(ensureFlexBudget).toHaveBeenCalledOnce();
    const retiredCommit = result.current.commitGroupBudget;
    changeScope({ selectedMonth: 12 });
    changeScope({ selectedMonth: 11 });
    expect(result.current.flexBudgetDraft).toBeUndefined();
    act(() => result.current.commitGroupBudget(FLEX_GROUP, 725.5));
    expect(ensureFlexBudget).toHaveBeenCalledTimes(2);

    await act(async () => { finishOld(CREATED); await oldEnsure; });
    act(() => retiredCommit(FLEX_GROUP, 660));
    expect(ensureFlexBudget).toHaveBeenCalledTimes(2);
    expect(updateBudget.mutateAsync).not.toHaveBeenCalled();
    expect(result.current.displayGroups.find(group => group.id === FLEX_GROUP))
      .toMatchObject({ budgetDraft: 725.5, budgetEditPending: true });
    await act(async () => { finishCurrent(CREATED); await currentEnsure; });
    expect(updateBudget.mutateAsync).toHaveBeenCalledOnce();
    expect(updateBudget.mutateAsync.mock.calls[0][0]).toMatchObject({ id: CREATED.id, data: { amount: money("725.50") } });
    expect(result.current.displayGroups.find(group => group.id === FLEX_GROUP))
      .toMatchObject({ budgetDraft: 725.5, budgetEditPending: false });
  });

  it("retires already-dispatched write feedback when its editor scope changes", async () => {
    const { result, changeScope, updateBudget } = setup({ apiBudgets: [progress({ id: CREATED.id, isFlexBucket: true })] });
    let reject!: (reason: Error) => void;
    const write = new Promise<typeof CREATED>((_resolve, fail) => { reject = fail; });
    updateBudget.mutateAsync.mockReturnValueOnce(write);
    act(() => result.current.commitGroupBudget(FLEX_GROUP, 620.5));
    const { canShowFeedback } = updateBudget.mutateAsync.mock.calls[0][0];
    expect(canShowFeedback()).toBe(true);
    changeScope({ selectedMonth: 12 });
    expect(canShowFeedback()).toBe(false);
    await act(async () => { reject(new Error("Synthetic rejection for the previous period")); await write.catch(() => undefined); });
    expect(toast).not.toHaveBeenCalled();
    expect(result.current.displayGroups.find(group => group.id === FLEX_GROUP)).toMatchObject({ budgetEditPending: false });
  });
});

it("uses one authoritative flex limit in the page plan and counts only detailed and unbudgeted actuals", () => {
  const categoryGroup = (id: string, name: string, budgetMode: CategoryGroup["budgetMode"], type = "expense"): CategoryGroup => ({
    id, householdId: "h-1", name, budgetMode, type, isArchived: false, displayOrder: 0,
    rolloverEnabled: false, createdAt: "", updatedAt: "",
  });
  const variable: Category = { id: "variable", householdId: "h-1", groupId: "daily", name: "Groceries", includeInBudget: true,
    icon: null, color: null, isArchived: false, displayOrder: 0, createdAt: "", updatedAt: "" };
  const { result } = setup({
    categoryGroups: [categoryGroup("fixed", "Fixed", "by_group"), categoryGroup("annual", "Non-Monthly", "by_group"),
      categoryGroup("daily", "Daily", "by_category"), categoryGroup("income", "Income", "by_group", "income")],
    categories: [variable],
    apiBudgets: [progress({ id: "fixed-limit", categoryGroupId: "fixed", amount: money("200.00"), spent: money("100.00"), remaining: money("100.00") }),
      progress({ id: "annual-limit", categoryGroupId: "annual", amount: money("300.00"), spent: money("50.00"), remaining: money("250.00") }),
      progress({ id: "legacy-limit", categoryId: "variable", amount: money("400.00"), spent: money("70.00"), remaining: money("330.00") }),
      progress({ id: "income-limit", categoryGroupId: "income", amount: money("1800.00"), spent: money("1000.00"), remaining: money("800.00") }),
      progress({ id: CREATED.id, isFlexBucket: true, amount: money("500.00"), spent: money("410.00"), remaining: money("90.00") })],
    unbudgetedSpend: { expense: money("42.50") },
  });
  expect(result.current.displayGroups.filter(group => group.type === "expense").map(group => [group.name, group.budget]))
    .toEqual([["Fixed", 200], ["Flexible", 500], ["Non-Monthly", 300]]);
  expect(result.current.displayGroups.find(group => group.id === FLEX_GROUP)).toMatchObject({ budget: 500, actual: 70, hasWithheldLimit: false });
  expect(result.current).toMatchObject({ totalIncomeBudget: 1800, totalIncomeActual: 1000,
    totalExpenseBudget: 1000, totalExpenseActual: 262.5, expenseRemaining: 737.5 });
});
