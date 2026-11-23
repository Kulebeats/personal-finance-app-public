import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import request from "supertest";
import { accounts, auditLogs, householdMembers, outboxEvents, recurringTransactionHistory, recurringTransactionLinks, recurringTransactions, transactions } from "@shared/schema";
import { db, pool } from "../../../db";
import { a, actors, app, b, ids, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const ruleIds = { shared: randomUUID(), other: randomUUID(), third: randomUUID(), private: randomUUID(), foreign: randomUUID() };
const linkIds = { shared: randomUUID(), privateAccount: randomUUID(), privateTransaction: randomUUID(), privateRule: randomUUID(), foreign: randomUUID(), corruptForeign: randomUUID(), multiA: randomUUID(), multiB: randomUUID() };
const transactionIds = { privateOnShared: randomUUID(), privateRuleVisible: randomUUID(), multi: randomUUID() };
const allRuleIds = Object.values(ruleIds);
const allLinkIds = Object.values(linkIds);
const allTransactionIds = [ids.sharedTx, ids.privateTx, ids.foreignTx, ...Object.values(transactionIds)];
type Viewer = Role | "outsider";

function unlink(ruleId: string, linkId: string, viewer: Viewer) {
  return request(app).delete(`/api/recurring/${ruleId}/link/${linkId}`).set("Cookie", actors.get(viewer)!.cookie);
}

function expectSamePublicError(actual: { status: number; body: { error: Record<string, unknown> } }, missing: { status: number; body: { error: Record<string, unknown> } }) {
  expect(actual.status).toBe(missing.status);
  for (const error of [actual.body.error, missing.body.error]) {
    expect(error.timestamp).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(error.timestamp as string))).toBe(false);
  }
  const actualError = { ...actual.body.error }, missingError = { ...missing.body.error };
  delete actualError.timestamp;
  delete missingError.timestamp;
  expect(actualError).toEqual(missingError);
}

async function clearRules() {
  await db.delete(auditLogs).where(inArray(auditLogs.entityId, allRuleIds));
  await db.delete(outboxEvents).where(inArray(outboxEvents.aggregateId, allRuleIds));
  await db.delete(recurringTransactions).where(inArray(recurringTransactions.id, allRuleIds));
}
async function makeSharedAudienceVisible(owner = false) {
  // Positive/selected-survivor controls need an accessible whole target. The
  // dedicated audience suite independently reproduces inaccessible siblings.
  await db.delete(recurringTransactionLinks).where(inArray(recurringTransactionLinks.id,
    owner ? [linkIds.corruptForeign] : [linkIds.privateAccount, linkIds.privateTransaction, linkIds.corruptForeign]));
  if (!owner) {
    // Removing a synthetic link alone leaves its private direct pointer active.
    // A positive public audience fixture must detach both representations.
    await db.update(transactions).set({ recurringTransactionId: null, isRecurring: false }).where(and(
      inArray(transactions.id, [ids.privateTx, transactionIds.privateOnShared]),
      eq(transactions.householdId, a), eq(transactions.recurringTransactionId, ruleIds.shared)));
  }
}

async function businessState() {
  return {
    rules: await db.select().from(recurringTransactions).where(inArray(recurringTransactions.id, allRuleIds)).orderBy(recurringTransactions.id),
    links: await db.select().from(recurringTransactionLinks).where(inArray(recurringTransactionLinks.transactionId, allTransactionIds)).orderBy(recurringTransactionLinks.id),
    transactions: await db.select().from(transactions).where(inArray(transactions.id, allTransactionIds)).orderBy(transactions.id),
    accounts: await db.select().from(accounts).where(inArray(accounts.id, [ids.sharedAccount, ids.privateAccount, ids.foreignAccount])).orderBy(accounts.id),
    history: await db.select().from(recurringTransactionHistory).where(inArray(recurringTransactionHistory.recurringTransactionId, allRuleIds)).orderBy(recurringTransactionHistory.id),
    audit: await db.select().from(auditLogs).where(inArray(auditLogs.entityId, allRuleIds)).orderBy(auditLogs.id),
    outbox: await db.select().from(outboxEvents).where(inArray(outboxEvents.aggregateId, allRuleIds)).orderBy(outboxEvents.id),
  };
}

async function whileRuleLocked<T>(ruleId: string, operation: () => Promise<T>): Promise<T> {
  const blocker = await pool.connect();
  let pending: Promise<T> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM recurring_transactions WHERE id = $1 FOR UPDATE", [ruleId]);
    pending = operation();
    return await pending;
  } finally {
    try { await blocker.query("ROLLBACK"); }
    finally {
      blocker.release();
      if (pending) await Promise.allSettled([pending]);
    }
  }
}

async function whileAccountKeyShared<T>(accountId: string, operation: () => Promise<T>): Promise<T> {
  const blocker = await pool.connect();
  let pending: Promise<T> | undefined;
  try {
    await blocker.query("BEGIN");
    const held = await blocker.query("SELECT id FROM accounts WHERE id = $1 FOR KEY SHARE", [accountId]);
    expect(held.rowCount).toBe(1);
    pending = operation();
    return await pending;
  } finally {
    try { await blocker.query("ROLLBACK"); }
    finally {
      blocker.release();
      if (pending) await Promise.allSettled([pending]);
    }
  }
}

describe("R04 recurring unlink parent and source privacy on marked PostgreSQL", () => {
  beforeAll(start, 20_000);
  beforeEach(async () => {
    await clearRules();
    await reset();
    await db.insert(recurringTransactions).values([
      { id: ruleIds.shared, householdId: a, accountId: ids.sharedAccount, name: "SHARED_RULE", amount: "15.00", type: "expense", frequency: "monthly", startDate: "2026-10-01", nextDueDate: "2026-12-01" },
      { id: ruleIds.other, householdId: a, accountId: ids.sharedAccount, name: "OTHER_RULE", amount: "25.00", type: "expense", frequency: "monthly", startDate: "2026-10-01", nextDueDate: "2026-12-01" },
      { id: ruleIds.third, householdId: a, accountId: ids.sharedAccount, name: "THIRD_RULE", amount: "27.00", type: "expense", frequency: "monthly", startDate: "2026-10-01", nextDueDate: "2026-12-01" },
      { id: ruleIds.private, householdId: a, accountId: ids.privateAccount, name: "PRIVATE_RULE", amount: "35.00", type: "expense", frequency: "monthly", startDate: "2026-10-01", nextDueDate: "2026-12-01" },
      { id: ruleIds.foreign, householdId: b, accountId: ids.foreignAccount, name: "FOREIGN_RULE", amount: "45.00", type: "expense", frequency: "monthly", startDate: "2026-10-01", nextDueDate: "2026-12-01" },
    ]);
    await db.insert(transactions).values([
      { id: transactionIds.privateOnShared, householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id, date: "2026-10-05", name: "PRIVATE_TRANSACTION", amount: "31.00", type: "expense", isPrivate: true },
      { id: transactionIds.privateRuleVisible, householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id, date: "2026-10-05", name: "VISIBLE_PRIVATE_RULE_TRANSACTION", amount: "32.00", type: "expense" },
      { id: transactionIds.multi, householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id, date: "2026-10-05", name: "MULTI_LINK_TRANSACTION", amount: "33.00", type: "expense" },
    ]);
    await db.insert(recurringTransactionLinks).values([
      { id: linkIds.shared, recurringTransactionId: ruleIds.shared, transactionId: ids.sharedTx },
      { id: linkIds.privateAccount, recurringTransactionId: ruleIds.shared, transactionId: ids.privateTx },
      { id: linkIds.privateTransaction, recurringTransactionId: ruleIds.shared, transactionId: transactionIds.privateOnShared },
      { id: linkIds.privateRule, recurringTransactionId: ruleIds.private, transactionId: transactionIds.privateRuleVisible },
      { id: linkIds.foreign, recurringTransactionId: ruleIds.foreign, transactionId: ids.foreignTx },
      { id: linkIds.corruptForeign, recurringTransactionId: ruleIds.shared, transactionId: ids.foreignTx },
      { id: linkIds.multiA, recurringTransactionId: ruleIds.shared, transactionId: transactionIds.multi },
      { id: linkIds.multiB, recurringTransactionId: ruleIds.other, transactionId: transactionIds.multi },
    ]);
    for (const [id, recurringTransactionId] of [
      [ids.sharedTx, ruleIds.shared], [ids.privateTx, ruleIds.shared],
      [transactionIds.privateOnShared, ruleIds.shared], [transactionIds.privateRuleVisible, ruleIds.private],
      [transactionIds.multi, ruleIds.other], [ids.foreignTx, ruleIds.foreign],
    ] as const) {
      await db.update(transactions).set({ isRecurring: true, recurringTransactionId }).where(eq(transactions.id, id));
    }
  });
  afterEach(clearRules);
  afterAll(async () => { await clearRules(); await stop(); });

  it("does not unlink a private-account link through another same-household parent", async () => {
    const before = await businessState();
    const missing = await unlink(ruleIds.other, randomUUID(), "owner").expect(404);
    const response = await unlink(ruleIds.other, linkIds.privateAccount, "owner").expect(404);
    expectSamePublicError(response, missing);
    expect(await businessState()).toEqual(before);
  });

  it("does not unlink a visible link through another same-household parent", async () => {
    const before = await businessState();
    await unlink(ruleIds.other, linkIds.shared, "admin").expect(404);
    expect(await businessState()).toEqual(before);
  });

  it("rejects invisible rule and source references before any link, flag, history or audit change", async () => {
    const before = await businessState();
    const missing = await unlink(ruleIds.shared, randomUUID(), "admin").expect(404);
    for (const [ruleId, linkId] of [
      [ruleIds.shared, linkIds.privateAccount],
      [ruleIds.shared, linkIds.privateTransaction],
      [ruleIds.private, linkIds.privateRule],
      [ruleIds.foreign, linkIds.foreign],
      [ruleIds.shared, linkIds.corruptForeign],
    ] as const) {
      const response = await unlink(ruleId, linkId, "admin").expect(404);
      expectSamePublicError(response, missing);
    }
    await unlink(ruleIds.shared, linkIds.shared, "outsider").expect(404);
    expect(await businessState()).toEqual(before);
  });

  it("rejects missing parent or link and a stale membership without mutations", async () => {
    const before = await businessState();
    await unlink(randomUUID(), linkIds.shared, "owner").expect(404);
    await unlink(ruleIds.shared, randomUUID(), "owner").expect(404);
    await db.delete(householdMembers).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actors.get("member")!.id)));
    const afterMembershipRemoval = await businessState();
    const response = await unlink(ruleIds.shared, linkIds.shared, "member");
    expect([403, 404]).toContain(response.status);
    expect(await businessState()).toEqual(afterMembershipRemoval);
    expect(afterMembershipRemoval).toEqual(before);
  });

  it("rejects malformed parent and link IDs without mutations", async () => {
    const before = await businessState();
    await unlink("invalid-uuid", linkIds.shared, "owner").expect(400);
    await unlink(ruleIds.shared, "invalid-uuid", "owner").expect(400);
    expect(await businessState()).toEqual(before);
  });

  it("unlinks an authorized sole source and records the existing history and audit contract", async () => {
    await makeSharedAudienceVisible();
    await request(app).get(`/api/recurring/${ruleIds.shared}`).set("Cookie", actors.get("admin")!.cookie).expect(200);
    const response = await unlink(ruleIds.shared, linkIds.shared, "admin").expect(200);
    expect(response.body).toMatchObject({ success: true, data: { message: "Unlinked successfully" } });
    const state = await businessState();
    expect(state.links.some(link => link.id === linkIds.shared)).toBe(false);
    expect(state.links).toHaveLength(allLinkIds.length - 4);
    const source = state.transactions.find(transaction => transaction.id === ids.sharedTx);
    expect(source).toMatchObject({ isRecurring: false, recurringTransactionId: null, amount: "11.11", accountId: ids.sharedAccount });
    expect(state.history).toHaveLength(1);
    expect(state.history[0]).toMatchObject({ recurringTransactionId: ruleIds.shared, action: "unlinked", linkedTransactionId: ids.sharedTx, performedBy: actors.get("admin")!.id });
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0]).toMatchObject({ action: "UNLINK", entityType: "recurring_rule", entityId: ruleIds.shared, userId: actors.get("admin")!.id, householdId: a, details: { transactionId: ids.sharedTx, linkId: linkIds.shared } });
  });

  it("keeps recurrence flags and the unrelated link when one of two links is removed", async () => {
    await makeSharedAudienceVisible();
    await request(app).get(`/api/recurring/${ruleIds.shared}`).set("Cookie", actors.get("member")!.cookie).expect(200);
    await unlink(ruleIds.shared, linkIds.multiA, "member").expect(200);
    const state = await businessState();
    expect(state.links.some(link => link.id === linkIds.multiA)).toBe(false);
    expect(state.links.find(link => link.id === linkIds.multiB)).toMatchObject({ recurringTransactionId: ruleIds.other, transactionId: transactionIds.multi });
    expect(state.transactions.find(transaction => transaction.id === transactionIds.multi)).toMatchObject({ isRecurring: true, recurringTransactionId: ruleIds.other });
    expect(state.history).toHaveLength(1);
    expect(state.audit).toHaveLength(1);
  });

  it("moves a removed primary pointer to the one valid surviving rule", async () => {
    await makeSharedAudienceVisible(true);
    await db.update(transactions).set({ recurringTransactionId: ruleIds.shared }).where(eq(transactions.id, transactionIds.multi));
    await unlink(ruleIds.shared, linkIds.multiA, "owner").expect(200);
    const state = await businessState();
    expect(state.links.some(link => link.id === linkIds.multiA)).toBe(false);
    expect(state.links.find(link => link.id === linkIds.multiB)).toMatchObject({ recurringTransactionId: ruleIds.other, transactionId: transactionIds.multi });
    expect(state.transactions.find(transaction => transaction.id === transactionIds.multi)).toMatchObject({ isRecurring: true, recurringTransactionId: ruleIds.other });
    expect(state.history).toHaveLength(1);
    expect(state.audit).toHaveLength(1);
  });

  it("fails closed when a foreign-household rule also links the local source", async () => {
    await makeSharedAudienceVisible(true);
    await db.update(transactions).set({ recurringTransactionId: ruleIds.shared }).where(eq(transactions.id, transactionIds.multi));
    await db.insert(recurringTransactionLinks).values({ recurringTransactionId: ruleIds.foreign, transactionId: transactionIds.multi });
    const before = await businessState();
    const missing = await unlink(ruleIds.shared, randomUUID(), "owner").expect(404);
    const response = await unlink(ruleIds.shared, linkIds.multiA, "owner").expect(404);
    expectSamePublicError(response, missing);
    expect(await businessState()).toEqual(before);
  });

  it("fails closed when a peer-private rule also links the visible source", async () => {
    await makeSharedAudienceVisible();
    await db.update(transactions).set({ recurringTransactionId: ruleIds.shared }).where(eq(transactions.id, transactionIds.multi));
    await db.insert(recurringTransactionLinks).values({ recurringTransactionId: ruleIds.private, transactionId: transactionIds.multi });
    const before = await businessState();
    await unlink(ruleIds.shared, linkIds.multiA, "admin").expect(404);
    expect(await businessState()).toEqual(before);
  });

  it("does not choose among two valid survivors when the removed rule was primary", async () => {
    await makeSharedAudienceVisible(true);
    await db.update(transactions).set({ recurringTransactionId: ruleIds.shared }).where(eq(transactions.id, transactionIds.multi));
    await db.insert(recurringTransactionLinks).values({ recurringTransactionId: ruleIds.third, transactionId: transactionIds.multi });
    const before = await businessState();
    await unlink(ruleIds.shared, linkIds.multiA, "owner").expect(409);
    expect(await businessState()).toEqual(before);
  });

  it("preserves an already-valid primary pointer with two other valid links", async () => {
    await makeSharedAudienceVisible(true);
    await db.insert(recurringTransactionLinks).values({ recurringTransactionId: ruleIds.third, transactionId: transactionIds.multi });
    await unlink(ruleIds.shared, linkIds.multiA, "owner").expect(200);
    const state = await businessState();
    expect(state.links.some(link => link.id === linkIds.multiA)).toBe(false);
    expect(state.transactions.find(transaction => transaction.id === transactionIds.multi)).toMatchObject({ isRecurring: true, recurringTransactionId: ruleIds.other });
  });

  it("does not race a writer holding a surviving rule", async () => {
    await makeSharedAudienceVisible(true);
    const before = await businessState();
    const response = await whileRuleLocked(ruleIds.other, () => unlink(ruleIds.shared, linkIds.multiA, "owner").timeout({ deadline: 3000 }).then(response => response));
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CONFLICT");
    expect(await businessState()).toEqual(before);
  });

  it("unlinks while another transaction holds the source account FK key-share lock", async () => {
    await makeSharedAudienceVisible(true);
    const before = await businessState();
    const response = await whileAccountKeyShared(ids.sharedAccount, () =>
      unlink(ruleIds.shared, linkIds.shared, "owner").timeout({ deadline: 3000 }).then(response => response));
    expect(response.status).toBe(200);
    const after = await businessState();
    expect(after.links.some(link => link.id === linkIds.shared)).toBe(false);
    expect(after.transactions.find(transaction => transaction.id === ids.sharedTx)).toMatchObject({ isRecurring: false, recurringTransactionId: null });
    expect(after.accounts).toEqual(before.accounts);
    expect(after.history).toHaveLength(before.history.length + 1);
    expect(after.audit).toHaveLength(before.audit.length + 1);
  });

  it("conceals a private requested rule even when a survivor is locked", async () => {
    await db.insert(recurringTransactionLinks).values({ recurringTransactionId: ruleIds.other, transactionId: transactionIds.privateRuleVisible });
    const before = await businessState();
    const response = await whileRuleLocked(ruleIds.other, () => unlink(ruleIds.private, linkIds.privateRule, "admin").timeout({ deadline: 3000 }).then(response => response));
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(await businessState()).toEqual(before);
  });

  it("conceals a peer-private surviving rule even while that rule is locked", async () => {
    await makeSharedAudienceVisible();
    await db.insert(recurringTransactionLinks).values({ recurringTransactionId: ruleIds.private, transactionId: transactionIds.multi });
    const before = await businessState();
    const response = await whileRuleLocked(ruleIds.private, () => unlink(ruleIds.shared, linkIds.multiA, "admin").timeout({ deadline: 3000 }).then(response => response));
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(await businessState()).toEqual(before);
  });

  it("lets the owner unlink a private-account source and a private transaction on a shared account", async () => {
    await makeSharedAudienceVisible(true);
    await unlink(ruleIds.shared, linkIds.privateAccount, "owner").expect(200);
    await unlink(ruleIds.shared, linkIds.privateTransaction, "owner").expect(200);
    const state = await businessState();
    expect(state.links.some(link => link.id === linkIds.privateAccount || link.id === linkIds.privateTransaction)).toBe(false);
    for (const id of [ids.privateTx, transactionIds.privateOnShared]) {
      expect(state.transactions.find(transaction => transaction.id === id)).toMatchObject({ isRecurring: false, recurringTransactionId: null });
    }
    expect(state.history).toHaveLength(2);
    expect(state.audit).toHaveLength(2);
  });
});
