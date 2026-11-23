import { beforeEach, describe, expect, it, vi } from "vitest";
import { listRecurringCalendar } from "../RecurringCalendarQuery";

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../db")>();
  return {
    ...actual,
    db: { transaction: async (operation: (tx: unknown) => Promise<unknown>) => operation({
      select: () => {
        const query = { from: () => query, innerJoin: () => query, where: read };
        return query;
      },
    }) },
  };
});
vi.mock("../../householdCalendarToday", () => ({ householdToday: async () => "2026-11-22" }));

const rule = { id: "bill", nextDueDate: "2026-11-15", type: "expense", amount: "14.00" };
const scheduled = { rule, currency: "ZMW" };
const skips = [{ ...scheduled, date: "2026-11-14" }, { ...scheduled, date: "2026-11-15" }];
const actor = { userId: "member", householdId: "household", role: "member" as const };
const dateRange = { from: "2026-11-01", to: "2026-11-30" };

describe("Calendar occurrence precedence", () => {
  beforeEach(() => read.mockReset());

  it("shows an edited, reopened date once and retains the other skipped date", async () => {
    read.mockResolvedValueOnce([scheduled]).mockResolvedValueOnce([]).mockResolvedValueOnce(skips);
    expect(await listRecurringCalendar(actor, dateRange)).toMatchObject([
      { date: "2026-11-14", status: "skipped", amount: null },
      { date: "2026-11-15", status: "overdue", amount: { amount: "14.00", currency: "ZMW" } },
    ]);
  });

  it("uses the posted payment ahead of pending, scheduled or skipped evidence for the same date", async () => {
    const posted = { ...scheduled, id: "posted", date: "2026-11-15", posted: true, amount: "23.78", transactionCurrency: "ZMW" };
    const pending = { ...posted, id: "pending", posted: false, amount: "51.00" };
    read.mockResolvedValueOnce([scheduled]).mockResolvedValueOnce([posted, pending]).mockResolvedValueOnce(skips);
    expect(await listRecurringCalendar(actor, dateRange)).toMatchObject([
      { date: "2026-11-14", status: "skipped", amount: null },
      { date: "2026-11-15", status: "paid", amount: { amount: "23.78", currency: "ZMW" } },
    ]);
  });

  it("keeps one paid status without substituting an arbitrary amount for multiple posted links", async () => {
    const posted = { ...scheduled, date: "2026-11-15", posted: true, amount: "23.78", transactionCurrency: "ZMW" };
    read.mockResolvedValueOnce([scheduled])
      .mockResolvedValueOnce([posted, { ...posted, amount: "50.00" }]).mockResolvedValueOnce([]);
    expect(await listRecurringCalendar(actor, dateRange)).toMatchObject([
      { date: "2026-11-15", status: "paid", amount: null },
    ]);
  });
});
