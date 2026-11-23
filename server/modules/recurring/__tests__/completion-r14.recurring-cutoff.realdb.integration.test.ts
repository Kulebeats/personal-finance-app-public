import request from "supertest";
import { eq, inArray, or } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accounts, auditLogs, recurringTransactionHistory, recurringTransactionLinks, recurringTransactions, transactions,
} from "@shared/schema";
import { db } from "../../../db";
import { recurringService } from "../../../services/RecurringService";
import { a, actors, app, ids, resetAccountsAndMembership, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const endpoint = "/api/recurring";
const writers = ["owner", "admin", "member"] as const;
const futureRequests = writers.flatMap(role => [[role, false], [role, true]] as const);

function signed(role: Role, path = endpoint) {
  const actor = actors.get(role)!;
  return request(app).post(path).set("Cookie", actor.cookie)
    .set("X-Capital-Subject", actor.id).set("X-Capital-Household", a);
}

function utcDates(now = new Date()) {
  const date = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  return { now, yesterday: date(-1), today: date(0), tomorrow: date(1) };
}

async function processSigned(role: Role, now: Date, body?: { asOfDate?: string; dryRun?: boolean }) {
  // Hold the current UTC date across the request without moving the database
  // clock or expiring the genuine signed session.
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(now);
    const call = signed(role, `${endpoint}/process`).set("Content-Type", "application/json");
    return await (body === undefined ? call : call.send(body));
  } finally { vi.useRealTimers(); }
}

async function createRule(due: string, name = "Synthetic cutoff expense") {
  const response = await signed("member").send({
    accountId: ids.sharedAccount, name, amount: { amount: "7.25", currency: "ZMW" },
    type: "expense", frequency: "daily", nextDueDate: due,
  }).expect(201);
  const id = response.body.data.id as string;
  const [rule] = await db.select().from(recurringTransactions).where(eq(recurringTransactions.id, id));
  expect(rule).toMatchObject({ accountId: ids.sharedAccount, nextDueDate: due, isActive: true, isPaused: false });
  return id;
}

async function readEffects(ruleIds: string[]) {
  const ledger = await db.select().from(transactions).where(eq(transactions.householdId, a)).orderBy(transactions.id);
  return {
    ledger,
    account: await db.select().from(accounts).where(eq(accounts.id, ids.sharedAccount)),
    rules: await db.select().from(recurringTransactions).where(inArray(recurringTransactions.id, ruleIds)).orderBy(recurringTransactions.id),
    links: await db.select().from(recurringTransactionLinks)
      .where(inArray(recurringTransactionLinks.recurringTransactionId, ruleIds)).orderBy(recurringTransactionLinks.id),
    history: await db.select().from(recurringTransactionHistory)
      .where(inArray(recurringTransactionHistory.recurringTransactionId, ruleIds)).orderBy(recurringTransactionHistory.id),
    audits: await db.select().from(auditLogs).where(or(eq(auditLogs.householdId, a),
      inArray(auditLogs.userId, Array.from(actors.values(), actor => actor.id)),
      inArray(auditLogs.entityId, [...ruleIds, ...ledger.map(row => row.id)]))).orderBy(auditLogs.id),
  };
}

async function cleanRules() {
  await db.delete(recurringTransactions).where(eq(recurringTransactions.householdId, a));
}

describe("R14 signed recurring processing cutoff", () => {
  beforeAll(start, 20_000);
  beforeEach(resetAccountsAndMembership);
  afterEach(cleanRules);
  afterAll(stop);

  it.each(futureRequests)("rejects a future cutoff for %s with dryRun=%s", async (role, dryRun) => {
    const { now, tomorrow } = utcDates();
    const id = await createRule(tomorrow);
    const before = await readEffects([id]);
    const response = await processSigned(role, now, { asOfDate: tomorrow, dryRun });
    expect.soft(response.status).toBe(400);
    expect.soft(response.body).toMatchObject({ success: false, error: {
      code: "VALIDATION_ERROR", fields: [expect.objectContaining({ field: "asOfDate" })],
    } });
    expect(await readEffects([id])).toEqual(before);
  });

  it("keeps invalid dates and non-writers outside recurring processing", async () => {
    const { now, tomorrow } = utcDates();
    const id = await createRule(tomorrow);
    const before = await readEffects([id]);
    const malformed = await processSigned("member", now, { asOfDate: "2027-02-30" });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe("VALIDATION_ERROR");
    for (const role of ["view_only", "professional"] as const) {
      const denied = await processSigned(role, now, { asOfDate: tomorrow });
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe("FORBIDDEN");
    }
    expect(await readEffects([id])).toEqual(before);
  });

  it("keeps a permitted dry run read-only and returns only eligible rules", async () => {
    const { now, today, tomorrow } = utcDates();
    const due = await createRule(today);
    const later = await createRule(tomorrow, "Synthetic later expense");
    const before = await readEffects([due, later]);
    const response = await processSigned("member", now, { asOfDate: today, dryRun: true });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ processed: 1, created: 0, errors: [], dryRun: true,
      dueRules: [{ id: due, nextDueDate: today }] });
    expect(await readEffects([due, later])).toEqual(before);
  });

  it.each(["past", "today", "bodyless"] as const)("materializes only the due occurrence for the %s cutoff", async mode => {
    const { now, yesterday, today, tomorrow } = utcDates();
    const cutoff = mode === "past" ? yesterday : today;
    const occurrence = mode === "bodyless" ? today : yesterday;
    const due = await createRule(occurrence);
    const laterDate = mode === "past" ? today : tomorrow;
    const later = await createRule(laterDate, "Synthetic later expense");
    const before = await readEffects([due, later]);
    const response = await processSigned("member", now, mode === "bodyless" ? undefined : { asOfDate: cutoff });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ processed: 1, created: 1, errors: [], dryRun: false });

    const after = await readEffects([due, later]);
    expect(after.ledger).toEqual([expect.objectContaining({
      accountId: ids.sharedAccount, recurringTransactionId: due, date: occurrence,
      amount: "7.25", currency: "ZMW", isPending: true, status: "pending", postedBalanceDelta: "-7.25", postingMode: "posted",
    })]);
    const [entry] = after.ledger;
    expect(after.account).toEqual([expect.objectContaining({ balance: "981.64" })]);
    expect(after.rules.find(rule => rule.id === due)).toMatchObject({
      nextDueDate: mode === "bodyless" ? tomorrow : today, lastOccurredDate: occurrence, totalOccurrences: 1,
    });
    expect(after.rules.find(rule => rule.id === later)).toEqual(before.rules.find(rule => rule.id === later));
    expect(after.links).toEqual([expect.objectContaining({
      recurringTransactionId: due, transactionId: entry.id, expectedDate: occurrence, actualDate: occurrence,
    })]);
    expect(after.history.filter(row => row.action === "processed")).toEqual([expect.objectContaining({
      recurringTransactionId: due, linkedTransactionId: entry.id,
    })]);
    const addedAudits = after.audits.filter(row => !before.audits.some(previous => previous.id === row.id));
    expect(addedAudits).toHaveLength(2);
    expect(addedAudits).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "CREATE", entityType: "transaction", entityId: entry.id,
        userId: actors.get("member")!.id, details: expect.objectContaining({ occurrenceDate: occurrence }) }),
      expect.objectContaining({ action: "PROCESS", entityType: "recurring_batch", userId: actors.get("member")!.id,
        details: expect.objectContaining({ asOfDate: cutoff, created: 1 }) }),
    ]));
  });

  it("keeps the trusted service caller's existing date argument", async () => {
    const { tomorrow } = utcDates();
    const id = await createRule(tomorrow);
    expect(await recurringService.processRecurring(a, tomorrow)).toMatchObject({ created: 1, errors: [] });
    const after = await readEffects([id]);
    expect(after.ledger).toEqual([expect.objectContaining({ recurringTransactionId: id, date: tomorrow })]);
    expect(after.audits).toContainEqual(expect.objectContaining({
      action: "CREATE", entityType: "transaction", entityId: after.ledger[0].id, userId: null,
    }));
  });
});
