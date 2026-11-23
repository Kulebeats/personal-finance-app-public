/**
 * R08 old-caller oracle: normal account CSV import followed by ordinary HTTP edits/deletes.
 * Literal balances implement the owner-approved history-only policy. Imported rows
 * must come from the genuine route; no seeded import rows or posting mocks.
 * Run only through the campaign's protected disposable-database runner.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { transactionRepository } from "../../../repositories/TransactionRepository";
import { accountRepository } from "../../../repositories/AccountRepository";
import { db, pool } from "../../../db";
import {
  accounts,
  accountBalanceSnapshots,
  auditLogs,
  goals,
  householdMembers,
  households,
  merchants,
  outboxEvents,
  transactions,
  users,
} from "@shared/schema";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";

interface AccountState {
  balance: string;
  initialBalance: string;
  currency: string;
  type: string;
  isAsset: boolean;
}
interface TransactionState {
  id: string;
  accountId: string;
  ownerUserId: string | null;
  amount: string;
  currency: string | null;
  type: string;
  source: string | null;
  date: string;
  notes: string | null;
  deletedAt: Date | null;
}

const householdId = randomUUID();
const userId = randomUUID();
const currency = "USD";
let app: Awaited<ReturnType<typeof getTestApp>>;
let cookie: string;

async function readAccount(accountId: string): Promise<AccountState> {
  const result = await pool.query<AccountState>(
    'SELECT balance, initial_balance AS "initialBalance", currency, type, is_asset AS "isAsset" FROM accounts WHERE id = $1 AND household_id = $2',
    [accountId, householdId],
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0];
}

async function readTransactions(accountId: string): Promise<TransactionState[]> {
  const result = await pool.query<TransactionState>(
    'SELECT id, account_id AS "accountId", owner_user_id AS "ownerUserId", amount, currency, type, source, date::text AS date, notes, deleted_at AS "deletedAt" FROM transactions WHERE account_id = $1 AND household_id = $2 ORDER BY id',
    [accountId, householdId],
  );
  return result.rows;
}

async function assertAccount(
  accountId: string,
  balance: string,
  type: "checking" | "credit",
  isAsset: boolean,
): Promise<void> {
  // Keep later lifecycle diagnostics when an earlier admitted posting has wrong signs.
  expect.soft(await readAccount(accountId)).toEqual({
    balance,
    initialBalance: "100.00",
    currency,
    type,
    isAsset,
  });
}

describe("R08 account CSV posting mode over signed HTTP and independent SQL", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const email = "r08-account-import-" + userId + "@example.invalid";
    const password = "SyntheticImportLedger123!";
    await db.insert(households).values({
      id: householdId,
      name: "Synthetic R08 account import",
      currency: "ZMW",
    });
    await db.insert(users).values({
      id: userId,
      email,
      username: "r08-account-import-" + userId,
      passwordHash: await hashPassword(password),
      emailVerified: true,
    });
    await db.insert(householdMembers).values({
      householdId,
      userId,
      role: "owner",
    });
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email, password })
      .expect(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30000);

  afterAll(async () => {
    await db.delete(goals).where(eq(goals.householdId, householdId));
    await db.delete(outboxEvents).where(eq(outboxEvents.householdId, householdId));
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(transactions).where(eq(transactions.householdId, householdId));
    await db.delete(merchants).where(eq(merchants.householdId, householdId));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [userId]);
    await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
    await pool.query("DELETE FROM security_audit_logs WHERE user_id = $1", [userId]);
    await db.delete(users).where(eq(users.id, userId));
  });

  async function newGoalAccount(type: "investment" | "credit") {
    const id = randomUUID();
    await db.insert(accounts).values({ id, householdId, ownerUserId: userId, name: "Goal basis", type,
      currency, isAsset: type === "investment", initialBalance: "100.00", balance: "100.00" });
    return id;
  }

  function createInvestment(accountId: string) {
    return request(app).post("/api/goals").set("Cookie", cookie).send({
      name: "Direct investment", goalType: "other", type: "investment", linkedAccountId: accountId,
      targetAmount: { currency, amount: "250.00" },
    });
  }

  const signed = (sessionCookie = cookie) => ({ Cookie: sessionCookie, "X-Capital-Subject": userId, "X-Capital-Household": householdId });
  const money = (amount: string) => ({ amount, currency });
  const reconcile = (accountId: string, body: object, sessionCookie = cookie) => request(app)
    .post(`/api/accounts/${accountId}/reconcile`).set(signed(sessionCookie)).send(body);

  async function reconciliationState(accountId: string) {
    return {
      account: (await pool.query("SELECT * FROM accounts WHERE id=$1 AND household_id=$2", [accountId, householdId])).rows,
      snapshots: (await pool.query("SELECT * FROM account_balance_snapshots WHERE account_id=$1 ORDER BY id", [accountId])).rows,
      postings: (await pool.query("SELECT * FROM transactions WHERE account_id=$1 ORDER BY id", [accountId])).rows,
      events: (await pool.query("SELECT * FROM outbox_events WHERE household_id=$1 ORDER BY id", [householdId])).rows,
      writes: (await pool.query("SELECT * FROM audit_logs WHERE household_id=$1 AND action IN ('CREATE','UPDATE','DELETE') ORDER BY id", [householdId])).rows,
    };
  }

  async function reconciliationAccount(type: "checking" | "credit" = "checking") {
    const id = randomUUID();
    await db.insert(accounts).values({ id, householdId, ownerUserId: userId, name: "Synthetic forward reconciliation",
      type, currency, isAsset: type === "checking", initialBalance: "100.00", balance: "100.00", isPrivate: false });
    return id;
  }

  async function previewReconciliation(accountId: string, target: string, adjustment: string, key = randomUUID(), reason = "Synthetic statement reconciliation") {
    await request(app).post("/api/settings/security/step-up").set(signed())
      .send({ password: "SyntheticImportLedger123!" }).expect(200);
    const account = (await request(app).get(`/api/accounts/${accountId}`).set(signed()).expect(200)).body.data;
    expect(account).toMatchObject({ currency, updatedAt: expect.any(String) });
    const plan = { targetBalance: money(target), expectedUpdatedAt: account.updatedAt as string,
      reason, idempotencyKey: key };
    const before = await reconciliationState(accountId);
    const preview = await reconcile(accountId, { ...plan, mode: "preview" }).expect(200);
    expect(preview.body).toMatchObject({ success: true, data: {
      currentBalance: money(before.account[0].balance), targetBalance: money(target), adjustment: money(adjustment), previewToken: expect.any(String),
    } });
    expect(preview.body.data.previewToken.length).toBeGreaterThan(0);
    expect(await reconciliationState(accountId)).toEqual(before);
    return { before, plan, apply: { ...plan, mode: "apply", previewToken: preview.body.data.previewToken as string } };
  }

  async function reconciliationEvidence(accountId: string, goalId?: string) {
    return {
      ...await reconciliationState(accountId),
      // Household packets alone miss actor-only audit rows with household_id=NULL.
      actorAudits: (await pool.query("SELECT * FROM audit_logs WHERE household_id=$1 OR user_id=$2 ORDER BY id", [householdId, userId])).rows,
      intents: (await pool.query("SELECT * FROM transaction_create_owner_intents WHERE household_id=$1 ORDER BY transaction_id", [householdId])).rows,
      goal: goalId ? (await pool.query("SELECT * FROM goals WHERE id=$1", [goalId])).rows : [],
      goalActivity: goalId ? (await pool.query("SELECT * FROM goal_activity_log WHERE goal_id=$1 ORDER BY id", [goalId])).rows : [],
    };
  }

  it("R08 reconcile keeps a private owner's correction and lost-ack retry actor-only even after account visibility changes", async () => {
    const accountId = randomUUID(), peerId = randomUUID();
    const secret = "PRIVATE_RECONCILE_REASON_" + accountId;
    await db.insert(accounts).values({ id: accountId, householdId, ownerUserId: userId, isPrivate: true, type: "checking", isAsset: true,
      name: "Private reconciliation custody", currency, balance: "4321.18", initialBalance: "4321.18" });
    const before = await reconciliationEvidence(accountId);
    const draft = await previewReconciliation(accountId, "4387.51", "66.33", randomUUID(), secret);
    expect(await reconciliationEvidence(accountId)).toEqual(before);
    const first = await reconcile(accountId, draft.apply).expect(200);
    const receipt = first.body.data.transactionId as string;
    expect(first.body.data).toMatchObject({ currentBalance: money("4321.18"), targetBalance: money("4387.51"), adjustment: money("66.33"), transactionId: expect.any(String) });
    const posted = await reconciliationEvidence(accountId);
    expect(posted.account[0]).toMatchObject({ balance: "4387.51", initial_balance: "4321.18", is_private: true, owner_user_id: userId });
    expect(posted.postings).toHaveLength(1);
    expect(posted.postings[0]).toMatchObject({ id: receipt, owner_user_id: userId, is_private: true, notes: secret, type: "balance_adjustment",
      amount: "66.33", currency, posted_balance_delta: "66.33", posted_account_is_asset: true, posting_mode: "posted", idempotency_key: draft.plan.idempotencyKey });
    const privateAudits = posted.actorAudits.filter(row => row.entity_type === "transaction" && row.entity_id === receipt && row.action === "CREATE");
    expect(privateAudits).toHaveLength(1);
    expect(privateAudits[0]).toMatchObject({ household_id: null, user_id: userId, action: "CREATE", entity_type: "transaction", entity_id: receipt });
    expect(privateAudits[0].details).toEqual({
      newValue: { accountId, amount: "66.33", currency, date: first.body.data.postingDate, type: "balance_adjustment", source: "manual",
        postedBalanceDelta: "66.33", postedAccountIsAsset: true, postingMode: "posted", isPrivate: true, ownerUserId: userId },
      reason: secret, reconciliation: { postingDate: first.body.data.postingDate, currentBalance: money("4321.18"), targetBalance: money("4387.51"), adjustment: money("66.33") },
    });
    expect(posted.events.filter(row => row.aggregate_id === receipt && row.event_type === "transaction.created")).toHaveLength(1);
    // The first acknowledgement could have been lost; the unchanged packet must
    // recover the same receipt without another posting, audit or outbox event.
    expect((await reconcile(accountId, draft.apply).expect(200)).body.data).toEqual(first.body.data);
    expect(await reconciliationEvidence(accountId)).toEqual(posted);
    try {
      const email = "r08-reconcile-peer-" + peerId + "@example.invalid";
      await db.insert(users).values({ id: peerId, email, username: "r08-reconcile-peer-" + peerId,
        passwordHash: await hashPassword("SyntheticImportLedger123!"), emailVerified: true });
      await db.insert(householdMembers).values({ householdId, userId: peerId, role: "admin" });
      const login = await request(app).post("/api/auth/login").send({ email, password: "SyntheticImportLedger123!" }).expect(200);
      const peer = { Cookie: (login.headers["set-cookie"] as unknown as string[]).join("; "), "X-Capital-Subject": peerId, "X-Capital-Household": householdId };
      await request(app).post("/api/settings/security/step-up").set(peer).send({ password: "SyntheticImportLedger123!" }).expect(200);
      const secrets = [secret, "4321.18", "4387.51", "66.33", receipt];
      const hidden = (body: unknown) => { for (const marker of secrets) expect(JSON.stringify(body)).not.toContain(marker); };
      hidden((await request(app).get(`/api/accounts/${accountId}`).set(peer).expect(404)).body);
      hidden((await request(app).get(`/api/transactions/${receipt}`).set(peer).expect(404)).body);
      hidden((await request(app).get("/api/transactions?limit=100").set(peer).expect(200)).body);
      hidden((await request(app).post(`/api/accounts/${accountId}/reconcile`).set(peer).send(draft.apply).expect(404)).body);
      // There is no household-facing business-audit HTTP reader. Pin the real
      // stored household audience rather than inventing an audit endpoint.
      const householdAudience = (await pool.query("SELECT * FROM audit_logs WHERE household_id=$1 ORDER BY id", [householdId])).rows;
      hidden(householdAudience);
      expect(await reconciliationEvidence(accountId)).toEqual(posted);
      await db.update(accounts).set({ isPrivate: false }).where(eq(accounts.id, accountId));
      const sharedNow = await reconciliationEvidence(accountId);
      expect((await reconcile(accountId, draft.apply).expect(200)).body.data).toEqual(first.body.data);
      expect(await reconciliationEvidence(accountId)).toEqual(sharedNow);
      // Current account visibility may change; its original private posting and
      // actor-only CREATE evidence do not become household-visible retroactively.
      hidden((await request(app).get(`/api/transactions/${receipt}`).set(peer).expect(404)).body);
      hidden((await request(app).get("/api/transactions?limit=100").set(peer).expect(200)).body);
      hidden((await request(app).post(`/api/accounts/${accountId}/reconcile`).set(peer).send(draft.apply).expect(404)).body);
      expect(await reconciliationEvidence(accountId)).toEqual(sharedNow);
    } finally {
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\'=$1', [peerId]);
      await db.delete(auditLogs).where(eq(auditLogs.userId, peerId));
      await pool.query("DELETE FROM security_audit_logs WHERE user_id=$1", [peerId]);
      await db.delete(householdMembers).where(eq(householdMembers.userId, peerId));
      await db.delete(users).where(eq(users.id, peerId));
    }
  }, 15000);

  it("R08 reconcile rejects unsupported net-credit card targets in preview and direct apply without any goal or ledger effect", async () => {
    const accountId = await reconciliationAccount("credit"), goalId = randomUUID();
    await db.insert(goals).values({ id: goalId, householdId, createdBy: userId, type: "pay_down", goalType: "other", name: "Card debt floor",
      debtAccountId: accountId, originalBalance: "100.00", currentAmount: "100.00", targetAmount: "100.00", currency });
    const draft = await previewReconciliation(accountId, "95.00", "-5.00");
    const before = await reconciliationEvidence(accountId, goalId);
    await reconcile(accountId, { ...draft.plan, mode: "preview", targetBalance: money("-0.01") }).expect(400);
    expect(await reconciliationEvidence(accountId, goalId)).toEqual(before);
    await reconcile(accountId, { ...draft.apply, targetBalance: money("-0.01") }).expect(400);
    expect(await reconciliationEvidence(accountId, goalId)).toEqual(before);
  });

  it("R08 reconcile previews an already matching statement but refuses its real-token apply without even an actor-only audit", async () => {
    const accountId = await reconciliationAccount("credit"), goalId = randomUUID();
    await db.insert(goals).values({ id: goalId, householdId, createdBy: userId, type: "pay_down", goalType: "other", name: "Matching card balance",
      debtAccountId: accountId, originalBalance: "100.00", currentAmount: "100.00", targetAmount: "100.00", currency });
    const before = await reconciliationEvidence(accountId, goalId);
    const draft = await previewReconciliation(accountId, "100.00", "0.00");
    expect(await reconciliationEvidence(accountId, goalId)).toEqual(before);
    const refused = await reconcile(accountId, draft.apply).expect(400);
    expect(refused.body.error.message).toMatch(/already match/i);
    expect(await reconciliationEvidence(accountId, goalId)).toEqual(before);
  });

  it("R08 reconcile permits reducing positive owed card debt to zero as a nonzero forward adjustment", async () => {
    const accountId = await reconciliationAccount("credit");
    const draft = await previewReconciliation(accountId, "0.00", "-100.00");
    const applied = await reconcile(accountId, draft.apply).expect(200);
    const state = await reconciliationEvidence(accountId);
    expect(state.account[0]).toMatchObject({ balance: "0.00", initial_balance: "100.00", is_asset: false });
    expect(state.postings).toHaveLength(1);
    expect(state.postings[0]).toMatchObject({ id: applied.body.data.transactionId, amount: "100.00", posted_balance_delta: "-100.00", type: "balance_adjustment" });
  });
  async function readGoalState(goalId: string) {
    return {
      current: (await pool.query("SELECT current_amount FROM goals WHERE id=$1 AND household_id=$2", [goalId, householdId])).rows[0].current_amount,
      activities: (await pool.query("SELECT id, activity_type, previous_balance, new_balance, metadata FROM goal_activity_log WHERE goal_id=$1 ORDER BY id", [goalId])).rows,
    };
  }

  async function assignedSavingsGoal(accountId: string) {
    const created = await request(app).post("/api/goals").set(signed()).send({
      name: "Full-balance assigned savings", type: "save_up", goalType: "other", targetAmount: money("10000.00"),
    }).expect(201);
    const goalId = created.body.data.id as string;
    expect(goalId).toEqual(expect.any(String));
    await request(app).post(`/api/goals/${goalId}/assign-account`).set(signed())
      .send({ accountId, assignmentType: "full_balance", autoUpdate: true }).expect(201);
    expect((await pool.query("SELECT goal_id, account_id, assignment_type, auto_update FROM goal_account_assignments WHERE goal_id=$1", [goalId])).rows)
      .toEqual([{ goal_id: goalId, account_id: accountId, assignment_type: "full_balance", auto_update: true }]);
    expect((await readGoalState(goalId)).current).toBe("100.00");
    return goalId;
  }

  it("R08 reconcile preserves ordinary posting sync for full-balance assigned savings through create, edit and delete", async () => {
    const accountId = await reconciliationAccount();
    const goalId = await assignedSavingsGoal(accountId);
    expect((await readGoalState(goalId)).activities.filter(row => row.activity_type === "balance_synced")).toEqual([]);
    const created = await request(app).post("/api/transactions").set(signed()).send({
      accountId, type: "income", name: "Ordinary savings deposit", date: "2026-01-12", amount: money("25.25"),
    }).expect(201);
    const transactionId = created.body.data.id as string;
    expect(transactionId).toEqual(expect.any(String));
    expect((await readAccount(accountId)).balance).toBe("125.25");
    const deposited = await readGoalState(goalId);
    expect(deposited.current).toBe("125.25");
    expect(deposited.activities.filter(row => row.activity_type === "balance_synced")).toEqual([
      expect.objectContaining({ previous_balance: "100.00", new_balance: "125.25", metadata: { trigger: "transaction_created", accountId } }),
    ]);
    await request(app).put(`/api/transactions/${transactionId}`).set(signed()).send({ notes: "Harmless display edit" }).expect(200);
    expect(await readGoalState(goalId)).toEqual(deposited);
    await request(app).put(`/api/transactions/${transactionId}`).set(signed()).send({ amount: money("30.00") }).expect(200);
    expect((await readAccount(accountId)).balance).toBe("130.00");
    const edited = await readGoalState(goalId);
    expect(edited.current).toBe("130.00");
    expect(edited.activities.filter(row => row.activity_type === "balance_synced")).toHaveLength(2);
    expect(edited.activities).toContainEqual(expect.objectContaining({ previous_balance: "125.25", new_balance: "130.00",
      metadata: { trigger: "transaction_updated", accountId } }));
    await request(app).delete(`/api/transactions/${transactionId}`).set(signed()).expect(200);
    expect((await readAccount(accountId)).balance).toBe("100.00");
    const deleted = await readGoalState(goalId);
    expect(deleted.current).toBe("100.00");
    expect(deleted.activities.filter(row => row.activity_type === "balance_synced")).toHaveLength(3);
    expect(deleted.activities).toContainEqual(expect.objectContaining({ previous_balance: "130.00", new_balance: "100.00",
      metadata: { trigger: "transaction_deleted", accountId } }));
  });

  it("R08 reconcile heals a postcommit assigned-goal activity failure on the same key without posting twice", async () => {
    const accountId = await reconciliationAccount();
    const goalId = await assignedSavingsGoal(accountId);
    const draft = await previewReconciliation(accountId, "125.25", "25.25");
    const goalRow = async () => (await pool.query("SELECT * FROM goals WHERE id=$1", [goalId])).rows[0];
    const beforeGoal = await goalRow(), beforeActivity = await readGoalState(goalId);
    const hook = "r08_goal_sync_" + randomUUID().replace(/-/g, "");
    await pool.query(`CREATE FUNCTION ${hook}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic goal activity failure'; END; $$`);
    try {
      await pool.query(`CREATE TRIGGER ${hook} BEFORE INSERT ON goal_activity_log FOR EACH ROW
        WHEN (NEW.goal_id='${goalId}'::uuid AND NEW.activity_type='balance_synced') EXECUTE FUNCTION ${hook}()`);
      await reconcile(accountId, draft.apply).expect(500);
      expect(await goalRow()).toEqual(beforeGoal);
      expect(await readGoalState(goalId)).toEqual(beforeActivity);
      const committed = await reconciliationState(accountId);
      expect(committed.account[0]).toMatchObject({ balance: "125.25", initial_balance: "100.00" });
      expect(committed.postings).toHaveLength(1);
      const posting = committed.postings[0];
      expect(posting).toMatchObject({ type: "balance_adjustment", amount: "25.25", posted_balance_delta: "25.25", posting_mode: "posted" });
      expect(committed.events.filter(row => row.aggregate_id === posting.id && row.event_type === "transaction.created")).toHaveLength(1);
      expect(committed.writes.filter(row => row.entity_id === posting.id && row.entity_type === "transaction" && row.action === "CREATE")).toHaveLength(1);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${hook} ON goal_activity_log`);
      await pool.query(`DROP FUNCTION IF EXISTS ${hook}()`);
    }
    const committed = await reconciliationState(accountId);
    const recovered = await reconcile(accountId, draft.apply).expect(200);
    expect(recovered.body.data.transactionId).toBe(committed.postings[0].id);
    expect(await reconciliationState(accountId)).toEqual(committed);
    const healed = await readGoalState(goalId);
    expect(healed.current).toBe("125.25");
    expect(healed.activities.filter(row => row.activity_type === "balance_synced")).toEqual([
      expect.objectContaining({ previous_balance: "100.00", new_balance: "125.25", metadata: { trigger: "transaction_created", accountId } }),
    ]);
    await reconcile(accountId, draft.apply).expect(200);
    expect(await reconciliationState(accountId)).toEqual(committed);
    expect(await readGoalState(goalId)).toEqual(healed);
  });

  it("R08 reconcile previews and applies credit 110 -> 105.75, then replays after a later posting without another adjustment", async () => {
    const accountId = await reconciliationAccount("credit");
    await db.insert(accountBalanceSnapshots).values({ accountId, date: "2026-01-09", balance: "100.00" });
    await request(app).post(`/api/accounts/${accountId}/transactions/import`).set(signed()).send({
      adjustBalance: true, transactions: [{ date: "2026-01-10", merchant: "Posted card purchase", amount: "-10.00" }],
    }).expect(200);
    const goalId = randomUUID();
    await db.insert(goals).values({ id: goalId, householdId, createdBy: userId, type: "pay_down", goalType: "other",
      name: "Linked card payoff", debtAccountId: accountId, originalBalance: "110.00", currentAmount: "110.00", targetAmount: "110.00", currency });
    const goalState = () => readGoalState(goalId);
    const draft = await previewReconciliation(accountId, "105.75", "-4.25");
    expect(draft.before.account[0]).toMatchObject({ initial_balance: "100.00", balance: "110.00", is_asset: false });
    const applied = await reconcile(accountId, draft.apply).expect(200);
    expect(applied.body).toMatchObject({ success: true, data: {
      currentBalance: money("110.00"), targetBalance: money("105.75"), adjustment: money("-4.25"), transactionId: expect.any(String),
    } });
    const reconciledGoal = await goalState();
    expect(reconciledGoal.current).toBe("105.75");
    expect(reconciledGoal.activities).toEqual([expect.objectContaining({ activity_type: "balance_synced", previous_balance: "110.00", new_balance: "105.75",
      metadata: { trigger: "transaction_created", accountId } })]);
    const transactionId = applied.body.data.transactionId as string;
    expect(transactionId).toMatch(/^[0-9a-f-]{36}$/i);
    const after = await reconciliationState(accountId);
    expect(after.account[0]).toMatchObject({ balance: "105.75", initial_balance: "100.00", currency, is_asset: false });
    expect(after.postings).toHaveLength(2);
    expect(after.postings).toContainEqual(expect.objectContaining({ id: transactionId, type: "balance_adjustment", amount: "4.25",
      currency, posted_balance_delta: "-4.25", posting_mode: "posted", posted_account_is_asset: false, is_balance_adjustment_increase: false, deleted_at: null }));
    expect(after.snapshots).toEqual(draft.before.snapshots);
    expect(after.postings).toContainEqual(draft.before.postings[0]);
    const events = after.events.filter(row => row.aggregate_id === transactionId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event_type: "transaction.created", household_id: householdId });
    const audits = after.writes.filter(row => row.entity_id === transactionId && row.entity_type === "transaction");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "CREATE", user_id: userId, household_id: householdId });
    await request(app).post("/api/transactions").set(signed()).send({
      accountId, type: "expense", date: "2026-01-11", name: "Ordinary create using the reconciliation key",
      amount: money("4.25"), idempotencyKey: draft.plan.idempotencyKey,
    }).expect(409);
    expect(await reconciliationState(accountId)).toEqual(after);
    await request(app).post("/api/transactions").set(signed()).send({ accountId, type: "expense", name: "Later card purchase",
      date: "2026-01-11", amount: money("2.00") }).expect(201);
    expect((await readAccount(accountId)).balance).toBe("107.75");
    const later = await reconciliationState(accountId);
    const laterGoal = await goalState();
    expect(laterGoal.current).toBe("107.75");
    expect(laterGoal.activities).toHaveLength(2);
    expect(laterGoal.activities).toContainEqual(expect.objectContaining({ activity_type: "balance_synced", previous_balance: "105.75", new_balance: "107.75",
      metadata: { trigger: "transaction_created", accountId } }));
    const replay = await reconcile(accountId, draft.apply).expect(200);
    expect(replay.body.data).toMatchObject({ currentBalance: money("110.00"), targetBalance: money("105.75"), adjustment: money("-4.25"), transactionId });
    expect(await reconciliationState(accountId)).toEqual(later);
    expect(await goalState()).toEqual(laterGoal);
    for (const changed of [{ reason: "A different reason" }, { targetBalance: money("106.00") }]) {
      await reconcile(accountId, { ...draft.apply, ...changed }).expect(409);
      expect(await reconciliationState(accountId)).toEqual(later);
    }
  });

  it("R08 reconcile applies concurrent identical asset requests once and preserves the receipt after archive", async () => {
    const accountId = await reconciliationAccount();
    const draft = await previewReconciliation(accountId, "125.25", "25.25");
    const [applied, concurrent] = await Promise.all([
      reconcile(accountId, draft.apply).expect(200), reconcile(accountId, draft.apply).expect(200),
    ]);
    expect(concurrent.body.data).toEqual(applied.body.data);
    expect(applied.body.data).toMatchObject({ currentBalance: money("100.00"), targetBalance: money("125.25"), adjustment: money("25.25"), transactionId: expect.any(String) });
    const after = await reconciliationState(accountId);
    expect(after.account[0]).toMatchObject({ balance: "125.25", initial_balance: "100.00", currency, is_asset: true });
    expect(after.postings).toHaveLength(1);
    expect(after.postings[0]).toMatchObject({ id: applied.body.data.transactionId, type: "balance_adjustment", amount: "25.25", currency,
      posted_balance_delta: "25.25", posting_mode: "posted", posted_account_is_asset: true, is_balance_adjustment_increase: true });
    await db.update(accounts).set({ isArchived: true }).where(eq(accounts.id, accountId));
    const archived = await reconciliationState(accountId);
    expect((await reconcile(accountId, draft.apply).expect(200)).body.data).toEqual(applied.body.data);
    expect(await reconciliationState(accountId)).toEqual(archived);
  });

  it.each(["direct debt", "full-balance savings"] as const)("R08 reconcile concurrent apply and replay record one %s linked goal change", async kind => {
    const savings = kind === "full-balance savings";
    const accountId = await reconciliationAccount(savings ? "checking" : "credit");
    const goalId = savings ? await assignedSavingsGoal(accountId) : randomUUID();
    if (!savings) await db.insert(goals).values({ id: goalId, householdId, createdBy: userId, type: "pay_down", goalType: "other",
      name: "Concurrent card payoff", debtAccountId: accountId, originalBalance: "100.00", currentAmount: "100.00", targetAmount: "100.00", currency });
    const target = savings ? "125.25" : "95.00";
    const draft = await previewReconciliation(accountId, target, savings ? "25.25" : "-5.00");
    let responses!: Promise<request.Response[]>;
    let finished = 0, overlapped = false;
    await db.transaction(async tx => {
      await tx.select({ id: goals.id }).from(goals).where(eq(goals.id, goalId)).for("update");
      const pid = (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
      responses = Promise.all([1, 2].map(() => reconcile(accountId, draft.apply).then(response => { finished++; return response; })));
      // Either the replay finishes without another sync, or both sync attempts queue
      // behind this lock. Include indirect waiters in PostgreSQL's lock queue.
      for (let i = 0; i < 160 && !overlapped; i++) {
        const waiting = await pool.query(`WITH RECURSIVE blocked(pid) AS (
          SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))
          UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid))
        ) SELECT count(*)::int AS count FROM blocked`, [pid]);
        const count = waiting.rows[0].count;
        overlapped = count > 0 && count + finished >= 2;
        if (!overlapped) await new Promise(resolve => setTimeout(resolve, 25));
      }
    });
    const [first, retry] = await responses;
    expect([first.status, retry.status]).toEqual([200, 200]);
    expect(first.body.data.transactionId).toBe(retry.body.data.transactionId);
    expect(overlapped).toBe(true);
    expect((await readTransactions(accountId))).toHaveLength(1);
    expect((await readAccount(accountId)).balance).toBe(target);
    const state = await readGoalState(goalId);
    expect(state.current).toBe(target);
    expect(state.activities.filter(row => row.activity_type === "balance_synced")).toEqual([
      expect.objectContaining({ previous_balance: "100.00", new_balance: target, metadata: { trigger: "transaction_created", accountId } }),
    ]);
  }, 15000);

  it("R08 reconcile refuses a valid but stale preview and malformed requests without financial effects", async () => {
    const accountId = await reconciliationAccount();
    const draft = await previewReconciliation(accountId, "125.25", "25.25");
    const { previewToken: _token, ...withoutToken } = draft.apply;
    for (const invalid of [withoutToken, { ...draft.apply, previewToken: "not-a-preview-token" },
      { ...draft.apply, targetBalance: { amount: "25.251", currency } },
      { ...draft.plan, mode: "preview", targetBalance: { amount: "125.25", currency: "EUR" } }]) {
      await reconcile(accountId, invalid).expect(400);
      expect(await reconciliationState(accountId)).toEqual(draft.before);
    }
    for (const change of [{ reason: "Edited after preview" }, { targetBalance: money("125.00") },
      { previewToken: "0".repeat(64) }]) {
      await reconcile(accountId, { ...draft.apply, ...change }).expect(409);
      expect(await reconciliationState(accountId)).toEqual(draft.before);
    }
    await request(app).post("/api/transactions").set(signed()).send({ accountId, type: "income", name: "Posting after preview",
      date: "2026-01-11", amount: money("1.00") }).expect(201);
    const changed = await reconciliationState(accountId);
    expect(changed.account[0].balance).toBe("101.00");
    await reconcile(accountId, draft.apply).expect(409);
    expect(await reconciliationState(accountId)).toEqual(changed);
  });

  it.each(["view_only", "professional"] as const)("R08 reconcile rechecks live %s permission before preview and apply", async role => {
    const accountId = await reconciliationAccount();
    const draft = await previewReconciliation(accountId, "125.25", "25.25");
    await db.update(householdMembers).set({ role }).where(eq(householdMembers.userId, userId));
    try {
      await reconcile(accountId, { ...draft.plan, mode: "preview" }).expect(403);
      await reconcile(accountId, draft.apply).expect(403);
      expect(await reconciliationState(accountId)).toEqual(draft.before);
    } finally {
      await db.update(householdMembers).set({ role: "owner" }).where(eq(householdMembers.userId, userId));
    }
  });

  it.each(["private", "archived"] as const)("R08 reconcile rechecks an account made %s after preview", async change => {
    const accountId = await reconciliationAccount();
    const draft = await previewReconciliation(accountId, "125.25", "25.25");
    await db.update(accounts).set(change === "archived" ? { isArchived: true } : { isPrivate: true, ownerUserId: null }).where(eq(accounts.id, accountId));
    const changed = await reconciliationState(accountId);
    await reconcile(accountId, draft.apply).expect(change === "archived" ? 409 : 404);
    expect(await reconciliationState(accountId)).toEqual(changed);
  });

  it.each(["hidden", "deleted"])("R08 reconcile withholds an existing receipt when its posting becomes %s", async state => {
    const accountId = await reconciliationAccount();
    const draft = await previewReconciliation(accountId, "102.00", "2.00");
    const applied = await reconcile(accountId, draft.apply).expect(200);
    const id = applied.body.data.transactionId;
    if (state === "deleted") {
      await request(app).delete("/api/transactions/" + id).set(signed()).expect(200);
    } else {
      await db.update(transactions).set({ isPrivate: true, ownerUserId: null }).where(eq(transactions.id, id));
    }
    const before = await reconciliationState(accountId);
    const denied = await reconcile(accountId, draft.apply).expect(404);
    expect(JSON.stringify(denied.body)).not.toContain(id);
    expect(await reconciliationState(accountId)).toEqual(before);
  });

  it("R08 reconcile prevents parallel corrections on different accounts from claiming the same key", async () => {
    const key = randomUUID();
    const ids = [await reconciliationAccount(), await reconciliationAccount()];
    const drafts = [
      await previewReconciliation(ids[0], "112.00", "12.00", key),
      await previewReconciliation(ids[1], "112.00", "12.00", key),
    ];
    const responses = await Promise.all(ids.map((id, i) => reconcile(id, drafts[i].apply)));
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    for (const [i, id] of ids.entries()) {
      const after = await reconciliationState(id);
      const won = responses[i].status === 200;
      expect(after.account[0].balance).toBe(won ? "112.00" : "100.00");
      expect(after.postings).toHaveLength(won ? 1 : 0);
    }
  });

  it("R08 reconcile requires its own financial step-up session", async () => {
    const accountId = await reconciliationAccount();
    const login = await request(app).post("/api/auth/login").send({ email: "r08-account-import-" + userId + "@example.invalid", password: "SyntheticImportLedger123!" }).expect(200);
    const fresh = (login.headers["set-cookie"] as unknown as string[]).join("; ");
    const account = (await request(app).get(`/api/accounts/${accountId}`).set(signed(fresh)).expect(200)).body.data;
    const before = await reconciliationState(accountId);
    const denied = await reconcile(accountId, { mode: "preview", targetBalance: money("125.25"), expectedUpdatedAt: account.updatedAt,
      reason: "Fresh session has not stepped up", idempotencyKey: randomUUID() }, fresh).expect(401);
    expect(denied.body).toMatchObject({ requiresStepUp: true, level: "FINANCIAL", error: { code: "STEP_UP_REQUIRED" } });
    expect(await reconciliationState(accountId)).toEqual(before);
  });

  it.each(["outbox_events", "audit_logs"] as const)("R08 reconcile rolls the complete adjustment back when PostgreSQL rejects %s", async table => {
    const accountId = await reconciliationAccount();
    const draft = await previewReconciliation(accountId, "125.25", "25.25");
    const hook = "r08_reconcile_" + randomUUID().replace(/-/g, "");
    await pool.query(`CREATE FUNCTION ${hook}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic reconciliation effect failure'; END; $$`);
    try {
      await pool.query(`CREATE TRIGGER ${hook} BEFORE INSERT ON ${table} FOR EACH ROW WHEN (NEW.household_id='${householdId}'::uuid) EXECUTE FUNCTION ${hook}()`);
      await reconcile(accountId, draft.apply).expect(500);
      expect(await reconciliationState(accountId)).toEqual(draft.before);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${hook} ON ${table}`);
      await pool.query(`DROP FUNCTION IF EXISTS ${hook}()`);
    }
    const recovered = await reconcile(accountId, draft.apply).expect(200);
    const after = await reconciliationState(accountId);
    expect(after.account[0]).toMatchObject({ balance: "125.25", initial_balance: "100.00" });
    expect(after.postings).toHaveLength(1);
    expect(after.postings[0].id).toBe(recovered.body.data.transactionId);
  });

  it.each(["investment", "credit"] as const)("protects the account used by a direct %s goal without assignments", async type => {
    const accountId = await newGoalAccount(type);
    if (type === "investment") {
      await createInvestment(accountId).expect(201);
    } else {
      // Historical pay-down records predate fixes to the public goal creation contract.
      await db.insert(goals).values({ householdId, createdBy: userId, type: "pay_down", debtAccountId: accountId,
        name: "Existing debt goal", originalBalance: "100.00", currentAmount: "100.00", targetAmount: "100.00", currency });
    }
    const goalRows = () => pool.query("SELECT * FROM goals WHERE debt_account_id=$1 OR linked_account_id=$1", [accountId]);
    const before = (await goalRows()).rows;
    expect(before).toHaveLength(1);
    expect((await pool.query("SELECT id FROM goal_account_assignments WHERE account_id=$1", [accountId])).rows).toHaveLength(0);
    await request(app).put(`/api/accounts/${accountId}`).set("Cookie", cookie).send({ currency: "EUR" }).expect(409);
    expect((await readAccount(accountId)).currency).toBe(currency);
    expect((await goalRows()).rows).toEqual(before);
  });

  it("checks the account type after an overlapping economic edit before linking an investment goal", async () => {
    const accountId = await newGoalAccount("investment");
    let response!: Promise<number>;
    let waiting = false;
    await db.transaction(async tx => {
      const changed = await accountRepository.update(accountId, householdId, { type: "checking" }, undefined, { userId }, tx);
      expect(changed.account?.type).toBe("checking");
      const pid = (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
      response = createInvestment(accountId).then(r => r.status);
      for (let i = 0; i < 120 && !waiting; i++) {
        const result = await pool.query("SELECT EXISTS (SELECT FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting", [pid]);
        waiting = result.rows[0].waiting;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 25));
      }
    });
    expect(await response).toBe(400);
    expect(waiting).toBe(true);
    expect((await pool.query("SELECT id FROM goals WHERE linked_account_id=$1", [accountId])).rows).toEqual([]);
  });

  it("refuses an account edit queued behind the very first uncommitted posting", async () => {
    const accountId = randomUUID();
    await db.insert(accounts).values({ id: accountId, householdId, ownerUserId: userId, name: "First posting",
      type: "checking", currency, isAsset: true, balance: "100.00", initialBalance: "100.00" });
    let waitForEdit!: Promise<number>, observedWait = false;
    await db.transaction(async tx => {
      await transactionRepository.createWithinTransaction(tx, {
        householdId, ownerUserId: userId, accountId, source: "manual", type: "expense",
        date: "2026-02-01", currency, amount: "12.35", name: "First debit",
      });
      const pid = (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
      waitForEdit = request(app).put(`/api/accounts/${accountId}`).set("Cookie", cookie)
        .send({ currency: "EUR" }).then(result => result.status);
      for (let i = 0; i < 120 && !observedWait; i++) {
        const { rows } = await pool.query<{ blocked: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked", [pid],
        );
        observedWait = rows[0].blocked;
        if (!observedWait) await new Promise(resolve => setTimeout(resolve, 25));
      }
    });
    expect(await waitForEdit).toBe(409);
    expect(observedWait).toBe(true);
    await assertAccount(accountId, "87.65", "checking", true);
    expect(await readTransactions(accountId)).toHaveLength(1);
  });

  it.each([
    { type: "real_estate", values: { estimatedValue: "150000.00" }, edit: { currency: "EUR" } },
    { type: "real_estate", values: { estimatedValue: "150000.00" }, edit: { type: "checking", estimatedValue: null } },
    { type: "credit", values: { creditLimit: "2500.00" }, edit: { currency: "EUR" } },
    { type: "credit", values: { creditLimit: "2500.00" }, edit: { type: "checking" } },
    { type: "checking", values: {}, edit: { currency: "EUR" } },
  ])("preserves account-level money on an otherwise unused $type account: $edit", async ({ type, values, edit }) => {
    const account = await request(app).post("/api/accounts").set("Cookie", cookie)
      .send({ name: "Stored account terms", type, currency, initialBalance: "0.00", ...values }).expect(201);
    const id = account.body.data.id;
    if (type === "checking") {
      // Imported available balances exist in storage but are not a manual create field.
      await db.update(accounts).set({ availableBalance: "85.25" }).where(eq(accounts.id, id));
    }
    const read = async () => (await pool.query(
      "SELECT currency, type, balance, initial_balance, estimated_value, credit_limit, available_balance FROM accounts WHERE id=$1", [id],
    )).rows[0];
    const before = await read();
    expect(before).toMatchObject({ currency, type, balance: "0.00", initial_balance: "0.00",
      estimated_value: type === "real_estate" ? "150000.00" : null,
      credit_limit: type === "credit" ? "2500.00" : null, available_balance: type === "checking" ? "85.25" : null });
    expect(await readTransactions(id)).toHaveLength(0);
    await request(app).put(`/api/accounts/${id}`).set("Cookie", cookie).send(edit).expect(409);
    expect(await read()).toEqual(before);
    await request(app).put(`/api/accounts/${id}`).set("Cookie", cookie).send({ name: "Renamed valued account", type, currency }).expect(200);
    expect(await read()).toEqual(before);
  });

  it("keeps an unused account's opening balance and classification consistent when edited", async () => {
    const accountId = randomUUID();
    await db.insert(accounts).values({ id: accountId, householdId, ownerUserId: userId, name: "Unused account",
      type: "checking", currency, isAsset: true, balance: "100.00", initialBalance: "100.00" });
    await request(app).put(`/api/accounts/${accountId}`).set("Cookie", cookie)
      .send({ type: "credit", initialBalance: "125.00", currency: "EUR" }).expect(200);
    expect(await readAccount(accountId)).toEqual({
      balance: "125.00", initialBalance: "125.00", currency: "EUR", type: "credit", isAsset: false,
    });
  });

  it.each([{ currency: "EUR" }, { type: "credit" }, { initialBalance: "125.00" }])(
    "refuses to reinterpret account history after a posting: %j", async change => {
      const accountId = randomUUID();
      await db.insert(accounts).values({ id: accountId, householdId, ownerUserId: userId,
        name: "Synthetic account history", type: "checking", currency, isAsset: true,
        balance: "100.00", initialBalance: "100.00", isPrivate: false });
      await request(app).post("/api/transactions").set("Cookie", cookie).send({
        accountId, type: "expense", name: "Synthetic posted expense", date: "2026-02-01",
        amount: { amount: "12.35", currency },
      }).expect(201);
      const before = await readAccount(accountId), postings = await readTransactions(accountId);
      expect(before.balance).toBe("87.65");
      expect(postings).toHaveLength(1);
      const updated = await request(app).put(`/api/accounts/${accountId}`).set("Cookie", cookie).send(change);
      expect(updated.status).toBe(409);
      expect(await readAccount(accountId)).toEqual(before);
      expect(await readTransactions(accountId)).toEqual(postings);
      await request(app).put(`/api/accounts/${accountId}`).set("Cookie", cookie).send({ name: "New display name" }).expect(200);
      expect(await readAccount(accountId)).toEqual(before);
    },
  );

  it.each([
    {
      label: "asset history-only",
      accountType: "checking" as const,
      isAsset: true,
      adjustBalance: false,
      afterImport: "100.00",
      afterEdit: "100.00",
    },
    {
      label: "liability history-only",
      accountType: "credit" as const,
      isAsset: false,
      adjustBalance: false,
      afterImport: "100.00",
      afterEdit: "100.00",
    },
    {
      label: "asset balance-updating",
      accountType: "checking" as const,
      isAsset: true,
      adjustBalance: true,
      afterImport: "90.00",
      afterEdit: "85.00",
    },
    {
      label: "liability balance-updating",
      accountType: "credit" as const,
      isAsset: false,
      adjustBalance: true,
      afterImport: "110.00",
      afterEdit: "115.00",
    },
  ])("$label expense 10 -> edit 15 -> delete reverses only its actual effects", async scenario => {
    const accountId = randomUUID();
    await db.insert(accounts).values({
      id: accountId,
      householdId,
      ownerUserId: userId,
      name: "R08 " + scenario.label,
      type: scenario.accountType,
      isAsset: scenario.isAsset,
      isPrivate: false,
      currency,
      balance: "100.00",
      initialBalance: "100.00",
    });
    await assertAccount(accountId, "100.00", scenario.accountType, scenario.isAsset);

    const imported = await request(app)
      .post("/api/accounts/" + accountId + "/transactions/import")
      .set("Cookie", cookie)
      .set("X-Capital-Subject", userId)
      .set("X-Capital-Household", householdId)
      .send({
        adjustBalance: scenario.adjustBalance,
        transactions: [{
          date: "2026-01-10",
          merchant: "Synthetic historical purchase",
          amount: "-10.00",
          notes: "Already-accounted history when balance updates are off",
        }],
      })
      .expect(200);
    expect.soft(imported.body).toMatchObject({
      success: true,
      data: { imported: 1, skipped: 0 },
    });
    const importedRows = await readTransactions(accountId);
    // An importer that silently skips every row cannot satisfy a neutral-balance oracle.
    expect(importedRows).toHaveLength(1);
    const transactionId = importedRows[0].id;
    expect.soft(importedRows[0]).toMatchObject({
      accountId,
      ownerUserId: userId,
      amount: "10.00",
      currency,
      type: "expense",
      source: "csv_import",
      date: "2026-01-10",
      notes: "Already-accounted history when balance updates are off",
      deletedAt: null,
    });
    await assertAccount(accountId, scenario.afterImport, scenario.accountType, scenario.isAsset);

    const edited = await request(app)
      .put("/api/transactions/" + transactionId)
      .set("Cookie", cookie)
      .set("X-Capital-Subject", userId)
      .set("X-Capital-Household", householdId)
      .send({ amount: { amount: "15.00", currency } })
      .expect(200);
    expect.soft(edited.body).toMatchObject({
      success: true,
      data: { id: transactionId, amount: { amount: "15.00", currency } },
    });
    const editedRows = await readTransactions(accountId);
    expect(editedRows).toHaveLength(1);
    expect.soft(editedRows[0]).toMatchObject({
      id: transactionId,
      accountId,
      amount: "15.00",
      currency,
      type: "expense",
      source: "csv_import",
      deletedAt: null,
    });
    await assertAccount(accountId, scenario.afterEdit, scenario.accountType, scenario.isAsset);

    await request(app)
      .delete("/api/transactions/" + transactionId)
      .set("Cookie", cookie)
      .set("X-Capital-Subject", userId)
      .set("X-Capital-Household", householdId)
      .expect(200);
    const deletedRows = await readTransactions(accountId);
    expect(deletedRows).toHaveLength(1);
    expect.soft(deletedRows[0]).toMatchObject({
      id: transactionId,
      accountId,
      amount: "15.00",
      currency,
      type: "expense",
      source: "csv_import",
    });
    expect.soft(deletedRows[0].deletedAt).toBeInstanceOf(Date);
    await assertAccount(accountId, "100.00", scenario.accountType, scenario.isAsset);
  });

  it.each([false, true])("preserves identical purchases on replay and rejects a later mode conflict before writing (adjustBalance=%s)", async posting => {
    const id = randomUUID();
    await db.insert(accounts).values({ id, householdId, ownerUserId: userId, name: "Synthetic replay card",
      type: "credit", isAsset: false, currency, balance: "100.00", initialBalance: "100.00" });
    const row = { date: "2026-02-01", merchant: "Synthetic duplicate purchase", amount: "-10.00" };
    const run = (adjustBalance: boolean, batch: typeof row[]) => request(app)
      .post("/api/accounts/" + id + "/transactions/import").set("Cookie", cookie)
      .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId).send({ adjustBalance, transactions: batch });
    const first = await run(posting, [row, row]).expect(200);
    expect(first.body.data).toMatchObject({ imported: 2, skipped: 0 });
    const snapshot = async () => ({
      account: (await pool.query("SELECT * FROM accounts WHERE id=$1", [id])).rows,
      rows: (await pool.query("SELECT * FROM transactions WHERE account_id=$1 ORDER BY id", [id])).rows,
      audit: (await pool.query("SELECT id FROM audit_logs WHERE entity_type='transaction' AND entity_id IN (SELECT id FROM transactions WHERE account_id=$1) ORDER BY id", [id])).rows,
      events: (await pool.query("SELECT id FROM outbox_events WHERE aggregate_id IN (SELECT id FROM transactions WHERE account_id=$1) ORDER BY id", [id])).rows,
    });
    const saved = await snapshot();
    expect(saved.rows).toHaveLength(2);
    expect(new Set(saved.rows.map(r => r.idempotency_key)).size).toBe(2);
    expect(saved.account[0].balance).toBe(posting ? "120.00" : "100.00");
    for (const r of saved.rows) expect(r.posted_balance_delta).toBe(posting ? "10.00" : "0.00");
    expect(saved.audit).toHaveLength(2);
    expect(saved.events).toHaveLength(2);
    const replay = await run(posting, [row, row]).expect(200);
    expect(replay.body.data).toMatchObject({ imported: 0, skipped: 2 });
    expect(await snapshot()).toEqual(saved);
    // NEW-17: identity is the statement, so the same file in the other mode is the conflict; it is refused before any write.
    await run(!posting, [row, row]).expect(409);
    expect(await snapshot()).toEqual(saved);
  });

  it("reports the committed row when PostgreSQL rejects the batch summary and retries without another debit", async () => {
    const id = randomUUID(), hook = "r08_summary_" + id.replace(/-/g, "");
    await db.insert(accounts).values({ id, householdId, ownerUserId: userId, name: "Synthetic failure card",
      type: "credit", isAsset: false, currency, balance: "100.00", initialBalance: "100.00" });
    const run = () => request(app).post("/api/accounts/" + id + "/transactions/import").set("Cookie", cookie)
      .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId)
      .send({ adjustBalance: true, transactions: [{ date: "2026-02-01", merchant: "Synthetic purchase", amount: "-10.00" }] });
    await pool.query(`CREATE FUNCTION ${hook}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic summary insert failure'; END; $$`);
    try {
      await pool.query(`CREATE TRIGGER ${hook} BEFORE INSERT ON audit_logs FOR EACH ROW
        WHEN (NEW.entity_id='${id}'::uuid AND NEW.entity_type='transaction_import') EXECUTE FUNCTION ${hook}()`);
      const failed = await run().expect(500);
      expect(failed.body.error).toMatchObject({ code: "ACCOUNT_IMPORT_INCOMPLETE",
        details: { stage: "summary", imported: 1, skipped: 0, failedRow: null } });
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${hook} ON audit_logs`);
      await pool.query(`DROP FUNCTION IF EXISTS ${hook}()`);
    }
    await assertAccount(id, "110.00", "credit", false);
    const result = await run().expect(200);
    expect(result.body.data).toMatchObject({ imported: 0, skipped: 1 });
    expect(await readTransactions(id)).toHaveLength(1);
    await assertAccount(id, "110.00", "credit", false);
  });
});
