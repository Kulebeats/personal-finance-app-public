import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, it, vi } from "vitest";
import { processRecurringReminders } from "../householdNoticeRunners";

const { where, triggerRecurringDue } = vi.hoisted(() => ({ where: vi.fn(), triggerRecurringDue: vi.fn() }));
vi.mock("../../../db", () => ({ db: { select: () => ({ from: () => ({ innerJoin: () => ({ where }) }) }) } }));
vi.mock("../../../services/NotificationService", () => ({ notificationService: { triggerRecurringDue } }));

const now = new Date("2026-03-01T00:30:00.000Z");
const fixtures = [
  { id: "due-today", reminderDays: 0, nextDueDate: "2026-03-01" },
  { id: "future-zero", reminderDays: 0, nextDueDate: "2026-03-04" },
  { id: "past-due", reminderDays: 3, nextDueDate: "2026-02-28" },
  { id: "missed-first-day", reminderDays: 3, nextDueDate: "2026-03-03" },
  { id: "default", reminderDays: null, nextDueDate: "2026-03-04" },
  { id: "fifteen", reminderDays: 15, nextDueDate: "2026-03-16" },
  { id: "thirty", reminderDays: 30, nextDueDate: "2026-03-31" },
  { id: "too-early", reminderDays: 30, nextDueDate: "2026-04-01" },
];

beforeEach(() => {
  vi.clearAllMocks();
  triggerRecurringDue.mockResolvedValue(1);
  where.mockImplementation(async (condition: SQL) => {
    const [from, to] = new PgDialect().sqlToQuery(condition).params.slice(-2).map(String);
    return fixtures.filter(rule => rule.nextDueDate >= from && rule.nextDueDate <= to)
      .map(rule => ({ rule: { ...rule, householdId: "household" } }));
  });
});

it("covers missed initial days without going past due or earlier than the configured window", async () => {
  await expect(processRecurringReminders(now)).resolves.toEqual({ checked: 6, sent: 5, failed: 0 });
  expect(triggerRecurringDue.mock.calls.map(([notice]) => notice.recurringId)).toEqual([
    "due-today", "missed-first-day", "default", "fifteen", "thirty",
  ]);
});
