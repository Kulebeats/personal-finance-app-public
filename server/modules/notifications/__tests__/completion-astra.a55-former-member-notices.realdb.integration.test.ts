/**
 * A-55 (Astra full-depth pass): an in-app financial reminder already queued for
 * a member must not be readable once that member has left or been removed from
 * the household. The stored row carries the reminder's source name, amount and
 * due date, so every inbox read (list, unread count, detail, mark read, archive)
 * must recheck membership and visibility of the source.
 *
 * Signed HTTP against real Postgres; synthetic data only. The production
 * recurring publisher writes each reminder from the seeded rule and account.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { accounts, auditLogs, householdMembers, households, notifications, recurringTransactions, users } from "@shared/schema";
import { db, pool } from "../../../db";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { publishRecurringNotice, type RecurringNoticeRef } from "../../../services/notification/recurring-notice";

type Who = "owner" | "removed" | "leaver" | "stayer" | "retained";
type Member = { id: string; cookie: string };

const password = "SyntheticFormerMemberNotice123!";
const householdId = randomUUID();
const people = new Map<Who, Member>();
const reminderOf = new Map<Who, string>();
const REMINDER_TEXT = "Synthetic rent";
const DUE_DATE = "2026-12-01";
let app: Awaited<ReturnType<typeof getTestApp>>;
let systemNoticeId: string;

async function addMember(who: Who, role: "owner" | "member"): Promise<void> {
  const id = randomUUID();
  const email = `a55-${who}-${id}@example.invalid`;
  await db.insert(users).values({ id, email, username: `a55-${who}-${id}`, passwordHash: await hashPassword(password), emailVerified: true });
  await db.insert(householdMembers).values({ householdId, userId: id, role });
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  people.set(who, { id, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") });
}

async function createRule(name: string) {
  const accountId = randomUUID();
  const recurringId = randomUUID();
  await db.insert(accounts).values({
    id: accountId, householdId, type: "checking", name, ownerUserId: people.get("owner")!.id,
    currency: "ZMW", initialBalance: "0.00", balance: "0.00", isPrivate: false,
  });
  await db.insert(recurringTransactions).values({
    id: recurringId, householdId, accountId, name, amount: "750.00", type: "expense", frequency: "monthly",
    startDate: DUE_DATE, nextDueDate: DUE_DATE, reminderDays: 3, detectionMethod: "manual", isActive: true, isPaused: false,
  });
  return { accountId, ref: { householdId, recurringId, dueDate: DUE_DATE } };
}

async function queueReminder(who: Who, ref: RecurringNoticeRef): Promise<string> {
  const published = await publishRecurringNotice(people.get(who)!.id, ref, true);
  if (!published?.notification) throw new Error(`Expected a queued recurring notice for ${who}`);
  return published.notification.id;
}

const inbox = (who: Who) => {
  const cookie = people.get(who)!.cookie;
  return {
    list: () => request(app).get("/api/notifications").query({ includeArchived: "true" }).set("Cookie", cookie).expect(200),
    count: () => request(app).get("/api/notifications/unread-count").set("Cookie", cookie).expect(200),
    detail: (id: string) => request(app).get(`/api/notifications/${id}`).set("Cookie", cookie),
    read: (id: string) => request(app).put(`/api/notifications/${id}/read`).set("Cookie", cookie),
    readAll: () => request(app).put("/api/notifications/read-all").set("Cookie", cookie).expect(200),
    archive: (id: string) => request(app).delete(`/api/notifications/${id}`).set("Cookie", cookie),
  };
};

beforeAll(async () => {
  app = await getTestApp();
  await db.insert(households).values({ id: householdId, name: "Synthetic A-55 household", currency: "ZMW" });
  await addMember("owner", "owner");
  for (const who of ["removed", "leaver", "stayer", "retained"] as const) await addMember(who, "member");
  // Each login leaves a "New login detected" notice; clear them so every inbox holds only this fixture's rows.
  await db.delete(notifications).where(inArray(notifications.userId, [...people.values()].map((member) => member.id)));
  const { ref } = await createRule(REMINDER_TEXT);
  for (const who of ["removed", "leaver", "stayer"] as const) reminderOf.set(who, await queueReminder(who, ref));
  // A notice tied to no household is the user's own and stays readable (positive control).
  const [system] = await db.insert(notifications).values({ userId: people.get("removed")!.id, householdId: null,
    type: "security", title: "Synthetic sign-in notice", body: "A new sign-in to your account" }).returning();
  systemNoticeId = system.id;

  const owner = people.get("owner")!;
  const removal = await request(app).delete(`/api/household/members/${people.get("removed")!.id}`).set("Cookie", owner.cookie);
  expect(removal.status, JSON.stringify(removal.body)).toBeLessThan(300);
  const leaving = await request(app).post("/api/household/leave").set("Cookie", people.get("leaver")!.cookie);
  expect(leaving.status, JSON.stringify(leaving.body)).toBeLessThan(300);
}, 60_000);

afterAll(async () => {
  const userIds = [...people.values()].map((member) => member.id);
  if (userIds.length) await db.delete(notifications).where(inArray(notifications.userId, userIds));
  await db.delete(recurringTransactions).where(eq(recurringTransactions.householdId, householdId));
  await db.delete(accounts).where(eq(accounts.householdId, householdId));
  await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
  await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
  await db.delete(households).where(eq(households.id, householdId));
  for (const userId of userIds) {
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [userId]);
    await pool.query("DELETE FROM security_audit_logs WHERE user_id = $1", [userId]);
    await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
  }
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
});

describe("A-55: a former member cannot read the household's queued reminders", () => {
  it.each(["removed", "leaver"] as const)("the %s member reads none of them in any inbox read", async (who) => {
    const reminderId = reminderOf.get(who)!;
    const reader = inbox(who);

    const list = await reader.list();
    expect(JSON.stringify(list.body)).not.toContain(REMINDER_TEXT);
    expect(list.body.data.map((row: { id: string }) => row.id)).not.toContain(reminderId);
    expect((await reader.count()).body.data.count).toBe(who === "removed" ? 1 : 0);
    for (const response of [await reader.detail(reminderId), await reader.read(reminderId), await reader.archive(reminderId)]) {
      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain(REMINDER_TEXT);
    }
    // Refused reads change nothing on the stored row.
    const [stored] = await db.select().from(notifications).where(eq(notifications.id, reminderId));
    expect(stored).toMatchObject({ isRead: false, isArchived: false });
  });

  it("the removed member still reads their own notice that belongs to no household", async () => {
    const reader = inbox("removed");
    expect((await reader.list()).body.data.map((row: { id: string }) => row.id)).toEqual([systemNoticeId]);
    expect((await reader.detail(systemNoticeId)).status).toBe(200);
  });

  it("a current member still reads, counts, opens and marks their own reminder", async () => {
    const reminderId = reminderOf.get("stayer")!;
    const reader = inbox("stayer");

    const list = await reader.list();
    expect(list.body.data.map((row: { id: string }) => row.id)).toEqual([reminderId]);
    expect(list.body.data[0]).toMatchObject({ title: `Upcoming: ${REMINDER_TEXT}` });
    expect((await reader.count()).body.data.count).toBe(1);
    expect((await reader.detail(reminderId)).status).toBe(200);
    expect((await reader.read(reminderId)).status).toBe(200);
    expect((await reader.count()).body.data.count).toBe(0);
  });

  it("withdraws an existing reminder from the retained member when the source account becomes private", async () => {
    const name = "Synthetic previously shared utility";
    const { accountId, ref } = await createRule(name);
    const reminderId = await queueReminder("retained", ref);
    const ownerReminderId = await queueReminder("owner", ref);
    const reader = inbox("retained");
    expect((await reader.list()).body.data).toEqual([expect.objectContaining({ id: reminderId, title: `Upcoming: ${name}` })]);
    expect((await reader.count()).body.data.count).toBe(1);
    await reader.detail(reminderId).expect(200);

    await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, accountId));
    const [member] = await db.select({ role: householdMembers.role }).from(householdMembers).where(and(
      eq(householdMembers.householdId, householdId), eq(householdMembers.userId, people.get("retained")!.id),
    ));
    expect(member).toEqual({ role: "member" });
    expect((await reader.list()).body.data).toEqual([]);
    expect((await reader.count()).body.data.count).toBe(0);
    expect((await reader.readAll()).body.data.count).toBe(0);
    for (const response of [await reader.detail(reminderId), await reader.read(reminderId), await reader.archive(reminderId)]) {
      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain(name);
    }
    const [stored] = await db.select().from(notifications).where(eq(notifications.id, reminderId));
    expect(stored).toMatchObject({ isRead: false, isArchived: false });
    await inbox("owner").detail(ownerReminderId).expect(200);
  });
});
