import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { recurringTransactions, transactions } from "@shared/schema";
import { db } from "../../../db";
import { recurringRepository } from "../../../repositories/RecurringRepository";
import { a, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const sourceIds = [randomUUID(), randomUUID(), randomUUID()];
const seriesName = "Sunday calendar rehearsal";

beforeAll(start, 20_000);
beforeEach(async () => {
  await reset();
  vi.stubEnv("TZ", "America/Los_Angeles");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await db.delete(recurringTransactions).where(eq(recurringTransactions.householdId, a));
  await db.delete(transactions).where(inArray(transactions.id, sourceIds));
});
afterAll(stop);

it("persists the Sunday on the posted transaction when creating a weekly rule", async () => {
  await db.update(transactions).set({ date: "2026-03-08" }).where(eq(transactions.id, ids.sharedTx));
  await request(app).post(`/api/recurring/transaction/${ids.sharedTx}`)
    .set("Cookie", actors.get("owner")!.cookie).send({ frequency: "weekly" }).expect(200);
  const [rule] = await db.select().from(recurringTransactions).where(eq(recurringTransactions.householdId, a));
  expect(rule).toMatchObject({ dayOfWeek: 0, dayOfMonth: 8, nextDueDate: "2026-03-15" });
});

it("retains a stored Sunday anchor when skipping an off-anchor due date", async () => {
  const cookie = actors.get("owner")!.cookie;
  await request(app).post(`/api/recurring/transaction/${ids.sharedTx}`)
    .set("Cookie", cookie).send({ frequency: "weekly" }).expect(200);
  const [rule] = await db.update(recurringTransactions).set({ dayOfWeek: 0, nextDueDate: "2026-03-06" })
    .where(eq(recurringTransactions.householdId, a)).returning({ id: recurringTransactions.id });
  await request(app).post(`/api/recurring/${rule.id}/skip`).set("Cookie", cookie).expect(200);
  const [after] = await db.select().from(recurringTransactions).where(eq(recurringTransactions.id, rule.id));
  expect(after.nextDueDate).toBe("2026-03-15");
});

it("detects Sunday from stored date-only transactions on a negative-offset host", async () => {
  const lastSunday = new Date();
  lastSunday.setUTCDate(lastSunday.getUTCDate() - lastSunday.getUTCDay() - 7);
  const dates = [14, 7, 0].map(daysAgo => {
    const date = new Date(lastSunday);
    date.setUTCDate(date.getUTCDate() - daysAgo);
    return date.toISOString().slice(0, 10);
  });
  await db.insert(transactions).values(sourceIds.map((id, index) => ({
    id, householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id,
    name: seriesName, type: "expense" as const, amount: "15.00", currency: "ZMW", date: dates[index],
  })));
  const response = await request(app).post("/api/recurring/detect")
    .set("Cookie", actors.get("owner")!.cookie).send({}).expect(200);
  const pattern = response.body.data.find((row: { name: string }) => row.name === seriesName);
  const nextSunday = new Date(lastSunday);
  nextSunday.setUTCDate(nextSunday.getUTCDate() + 7);
  expect(pattern).toMatchObject({ frequency: "weekly", dayOfWeek: 0, suggestedNextDueDate: nextSunday.toISOString().slice(0, 10) });
});

it("confirms a detected 31st, clamps February and recovers the March anchor", async () => {
  const now = new Date();
  const year = now.getUTCFullYear() - (now.getUTCMonth() === 0 ? 1 : 0);
  const dates = [`${year - 1}-11-30`, `${year - 1}-12-31`, `${year}-01-31`];
  await db.insert(transactions).values(sourceIds.map((id, index) => ({
    id, householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id,
    name: seriesName, type: "expense" as const, amount: "15.00", currency: "ZMW", date: dates[index],
  })));
  const cookie = actors.get("owner")!.cookie;
  const detection = await request(app).post("/api/recurring/detect")
    .set("Cookie", cookie).send({ lookbackMonths: 24 }).expect(200);
  const pattern = detection.body.data.find((row: { name: string }) => row.name === seriesName);
  expect(pattern).toMatchObject({ frequency: "monthly", dayOfMonth: 31 });
  await request(app).post("/api/recurring/confirm").set("Cookie", cookie)
    .send({ accountId: ids.sharedAccount, pattern: { ...pattern, dayOfMonth: 32 } }).expect(400);
  const confirmation = await request(app).post("/api/recurring/confirm").set("Cookie", cookie)
    .send({ accountId: ids.sharedAccount, pattern }).expect(201);
  const [stored] = await db.select().from(recurringTransactions).where(eq(recurringTransactions.id, confirmation.body.data.id));
  expect(stored.dayOfMonth).toBe(31);
  expect(stored.nextDueDate).toBe(new Date(Date.UTC(year, 2, 0)).toISOString().slice(0, 10));
  expect(recurringRepository.nextDateAfter(stored)).toBe(`${year}-03-31`);
});
