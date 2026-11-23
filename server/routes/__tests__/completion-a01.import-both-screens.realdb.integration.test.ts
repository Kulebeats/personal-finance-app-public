/**
 * A-01: one statement imported through both screens (Account Detail and the
 * import wizard) posts once. The screens key rows in different identity
 * namespaces, so neither replays the other; instead each holds back a row that
 * matches one already on the account until the member decides, and a
 * decision is bound to the match it was shown. Both orders, every wizard
 * strategy: one live posting per statement row and one balance movement.
 *
 * Real HTTP against real Postgres. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "../../db";
import {
  accounts, auditLogs, householdMembers, households, merchants, outboxEvents, transactions, users,
} from "@shared/schema";
import { getTestApp } from "../../__tests__/fixtures";
import { hashPassword } from "../../auth";
import { reviewedRemovalsFrom } from "../../testing/fixtures/import-overwrite-review";
import { accountImportKey, batchImportKey } from "../../services/import/admission";
import { transactionService } from "../../services/TransactionService";

type Strategy = "prioritize_coppercoin" | "prioritize_csv";
interface ReviewItem { row: number; matchesTransactionId: string }
interface Candidate { ordinal: number; candidate: { id: string } }

const householdId = randomUUID();
const userId = randomUUID();
const currency = "USD";
let app: Awaited<ReturnType<typeof getTestApp>>;
let cookie: string;

/** The same statement, in each screen's input shape. */
const detailRows = [
  { date: "2026-06-03", merchant: "Synthetic both-screens grocer", amount: "-30.00" },
  { date: "2026-06-07", merchant: "Synthetic both-screens salary", amount: "250.00" },
];
const wizardRows = detailRows.map(row => ({ Date: row.date, Amount: row.amount, Merchant: row.merchant }));
/** 1000.00 opening, one posting of each row. */
const POSTED_ONCE = "1220.00";

const auth = (req: request.Test) => req.set("Cookie", cookie).set("X-Capital-Subject", userId).set("X-Capital-Household", householdId);
const detailImport = (accountId: string, possibleDuplicateDecisions: Array<ReviewItem & { decision: "post" | "skip" }> = []) =>
  auth(request(app).post(`/api/accounts/${accountId}/transactions/import`))
    .send({ adjustBalance: true, transactions: detailRows, possibleDuplicateDecisions });
const wizardBody = (targetAccountId: string, strategy: Strategy) =>
  ({ targetAccountId, strategy, mapping: { date: "Date", amount: "Amount", merchant: "Merchant" }, categoryMapping: {}, dateFormat: "auto", rows: wizardRows });
const wizardPreview = (accountId: string, strategy: Strategy) =>
  auth(request(app).post("/api/import/preview")).send(wizardBody(accountId, strategy));
const wizardExecute = (accountId: string, strategy: Strategy, extra: Record<string, unknown> = {}) =>
  auth(request(app).post("/api/import/execute")).send({ ...wizardBody(accountId, strategy), ...extra });

/** The wizard as a member who reviewed its preview: its removals under CSV wins; no candidates on a fresh account. */
async function wizardImport(accountId: string, strategy: Strategy) {
  const reviewedRemovals = strategy === "prioritize_csv" ? await reviewedRemovalsFrom(wizardPreview(accountId, strategy)) : [];
  return wizardExecute(accountId, strategy, { reviewedRemovals });
}

async function newAccount() {
  const [account] = await db.insert(accounts).values({ householdId, ownerUserId: userId, name: "Synthetic A-01 cheque",
    type: "checking", isAsset: true, currency, balance: "1000.00", initialBalance: "1000.00" }).returning();
  return account.id;
}

async function ledger(accountId: string) {
  const [account] = await db.select({ balance: accounts.balance }).from(accounts).where(eq(accounts.id, accountId));
  const live = await pool.query<{ id: string; name: string; amount: string; type: string }>(
    "SELECT id, name, amount, type FROM transactions WHERE account_id=$1 AND deleted_at IS NULL ORDER BY date, id", [accountId]);
  const imports = await pool.query("SELECT id FROM data_imports WHERE account_id=$1", [accountId]);
  return { balance: account.balance, live: live.rows, imports: imports.rowCount };
}

function expectPostedOnce(state: Awaited<ReturnType<typeof ledger>>) {
  expect(state.live.map(row => [row.name, row.amount, row.type])).toEqual([
    ["Synthetic both-screens grocer", "30.00", "expense"], ["Synthetic both-screens salary", "250.00", "income"]]);
  expect(state.balance).toBe(POSTED_ONCE);
}

describe("A-01 one statement through both import screens posts once (real Postgres)", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const email = `a01-both-${userId}@example.invalid`;
    const password = "SyntheticBothScreens123!";
    await db.insert(households).values({ id: householdId, name: "Synthetic A-01 both screens", currency: "ZMW" });
    await db.insert(users).values({ id: userId, email, username: `a01-both-${userId}`,
      passwordHash: await hashPassword(password), emailVerified: true });
    await db.insert(householdMembers).values({ householdId, userId, role: "owner" });
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30000);

  afterAll(async () => {
    await pool.query("DELETE FROM data_imports WHERE user_id=$1", [userId]);
    await db.delete(outboxEvents).where(eq(outboxEvents.householdId, householdId));
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(transactions).where(eq(transactions.householdId, householdId));
    await db.delete(merchants).where(eq(merchants.householdId, householdId));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [userId]);
    await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
    await pool.query("DELETE FROM security_audit_logs WHERE user_id = $1", [userId]);
    await db.delete(users).where(eq(users.id, userId));
  });

  for (const strategy of ["prioritize_coppercoin", "prioritize_csv"] as const) {
    it(`wizard (${strategy}) first: Account Detail holds both rows for review, and a skip posts nothing`, async () => {
      const accountId = await newAccount();
      const first = await wizardImport(accountId, strategy);
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      expect(first.body).toMatchObject({ imported: 2 });
      const posted = await ledger(accountId);
      expectPostedOnce(posted);

      const held = await detailImport(accountId).expect(409);
      expect(held.body.error.code).toBe("IMPORT_REVIEW_REQUIRED");
      const review: ReviewItem[] = held.body.error.details.possibleDuplicates;
      expect(review.map(item => item.row)).toEqual([1, 2]);
      expect(review.map(item => item.matchesTransactionId)).toEqual(posted.live.map(row => row.id));
      expect(await ledger(accountId)).toEqual(posted);

      // A decision made against a different transaction than the row matches now is no decision.
      const swapped = review.map((item, index) => ({ row: item.row, matchesTransactionId: review[1 - index].matchesTransactionId, decision: "skip" as const }));
      expect((await detailImport(accountId, swapped).expect(409)).body.error.code).toBe("IMPORT_REVIEW_REQUIRED");
      expect(await ledger(accountId)).toEqual(posted);

      // The review has display metadata. Only the selected action and its binding belong in the request.
      const echoed = review.map(item => ({ ...item, decision: "skip" as const }));
      expect((await detailImport(accountId, echoed).expect(400)).body.error.code).toBe("VALIDATION_ERROR");
      expect(await ledger(accountId)).toEqual(posted);

      const skips = review.map(({ row, matchesTransactionId }) => ({ row, matchesTransactionId, decision: "skip" as const }));
      const skipped = await detailImport(accountId, skips).expect(200);
      expect(skipped.body.data).toMatchObject({ imported: 0, reviewSkipped: 2, possibleDuplicates: [] });
      const after = await ledger(accountId);
      expect(after.live).toEqual(posted.live);
      expect(after.balance).toBe(POSTED_ONCE);
    });
  }

  it("Account Detail first, wizard keeps the ledger: execute refuses undecided candidates, a skip posts nothing", async () => {
    const accountId = await newAccount();
    await detailImport(accountId).expect(200);
    const posted = await ledger(accountId);
    expectPostedOnce(posted);

    const draft = await wizardPreview(accountId, "prioritize_coppercoin").expect(200);
    expect(draft.body.rows.map((row: { status: string }) => row.status)).toEqual(["candidate", "candidate"]);
    const refused = await wizardExecute(accountId, "prioritize_coppercoin").expect(409);
    expect(refused.body.error.code).toBe("IMPORT_REVIEW_REQUIRED");
    expect(refused.body.error.details.candidates.map((item: Candidate) => item.candidate.id)).toEqual(posted.live.map(row => row.id));
    expect(await ledger(accountId)).toEqual(posted);

    // A post decision must name the candidate the row matches; the other row's candidate does not count.
    const wrong = [{ ordinal: 1, candidateId: posted.live[1].id }, { ordinal: 2, candidateId: posted.live[0].id }];
    expect((await wizardExecute(accountId, "prioritize_coppercoin", { postRows: wrong }).expect(409)).body.error.code).toBe("IMPORT_REVIEW_REQUIRED");
    expect(await ledger(accountId)).toEqual(posted);

    // R2-01: each skip names the candidate it was reviewed against, like a post.
    const skipRows = draft.body.rows.map((row: Candidate) => ({ ordinal: row.ordinal, candidateId: row.candidate.id }));
    const skipped = await wizardExecute(accountId, "prioritize_coppercoin", { skipRowOrdinals: [1, 2], skipRows }).expect(200);
    expect(skipped.body).toMatchObject({ imported: 0, skipped: 2 });
    const after = await ledger(accountId);
    expect(after.live).toEqual(posted.live);
    expect(after.balance).toBe(POSTED_ONCE);
  });

  it("Account Detail first, wizard CSV wins: the reviewed overwrite replaces the rows, one live posting and one net movement", async () => {
    const accountId = await newAccount();
    await detailImport(accountId).expect(200);
    const posted = await ledger(accountId);
    const reviewedRemovals = await reviewedRemovalsFrom(wizardPreview(accountId, "prioritize_csv"));
    expect(reviewedRemovals.map(row => row.id).sort()).toEqual(posted.live.map(row => row.id).sort());

    const replaced = await wizardExecute(accountId, "prioritize_csv", { reviewedRemovals }).expect(200);
    expect(replaced.body).toMatchObject({ imported: 2, deleted: 2 });
    const after = await ledger(accountId);
    expectPostedOnce(after);
    expect(after.live.map(row => row.id)).not.toEqual(posted.live.map(row => row.id));
    const history = await pool.query<{ source: string; deleted_count: number; imported_count: number }>(
      "SELECT source, deleted_count, imported_count FROM data_imports WHERE id=$1", [replaced.body.importId]);
    expect(history.rows).toEqual([{ source: "global_csv", deleted_count: 2, imported_count: 2 }]);
  });

  it("refuses a wizard execute whose rows became candidates after its preview (Account Detail imported in between)", async () => {
    const accountId = await newAccount();
    const draft = await wizardPreview(accountId, "prioritize_coppercoin").expect(200);
    expect(draft.body.counts).toMatchObject({ new: 2, candidate: 0 });
    await detailImport(accountId).expect(200);
    const posted = await ledger(accountId);

    // The member reviewed no candidates, so none may post now.
    const refused = await wizardExecute(accountId, "prioritize_coppercoin").expect(409);
    expect(refused.body.error.code).toBe("IMPORT_REVIEW_REQUIRED");
    expect(await ledger(accountId)).toEqual(posted);
    expectPostedOnce(posted);
  });

  it("serializes overlapping signed Detail and wizard requests before either can plan a duplicate", async () => {
    const accountId = await newAccount();
    let enterDetail!: () => void;
    const detailEntered = new Promise<void>(resolve => { enterDetail = resolve; });
    let letDetailPost!: () => void;
    const mayPost = new Promise<void>(resolve => { letDetailPost = resolve; });
    const create = transactionService.createTransaction.bind(transactionService);
    const pause = vi.spyOn(transactionService, "createTransaction").mockImplementationOnce(async (...args) => {
      enterDetail();
      await mayPost;
      return create(...args);
    });
    const detail = detailImport(accountId).timeout(10_000).then(response => response);
    void detail.catch(() => undefined);
    let wizard: Promise<request.Response> | undefined;
    try {
      await Promise.race([detailEntered, detail.then(response => { throw new Error(`Detail exited early: ${response.status}`); })]);
      const { rows: [holder] } = await pool.query<{ pid: number }>(
        `SELECT pid FROM pg_locks WHERE locktype='advisory' AND granted AND objsubid=1
          AND classid::bigint = ((hashtextextended($1, 0) >> 32) & 4294967295)
          AND objid::bigint = (hashtextextended($1, 0) & 4294967295)`, [accountImportKey(accountId)]);
      expect(holder).toBeDefined();
      const batchId = randomUUID();
      wizard = wizardExecute(accountId, "prioritize_coppercoin", { batchId }).timeout(10_000)
        .then(response => response);
      void wizard.catch(() => undefined);
      let waiter = false;
      let firstAttempt: string | undefined;
      const deadline = Date.now() + 3_000;
      while (!waiter && Date.now() < deadline) {
        const { rows: [row] } = await pool.query<{ attempt: string }>(
          `SELECT activity.query_start::text AS attempt FROM pg_stat_activity AS activity
           JOIN pg_locks AS held_lock ON held_lock.pid=activity.pid AND held_lock.locktype='advisory'
             AND held_lock.granted AND held_lock.objsubid=1
           WHERE activity.datname=current_database() AND activity.application_name='capital-import-admission' AND activity.pid<>$1
           AND activity.query LIKE '%pg_try_advisory_lock%'
           AND held_lock.classid::bigint = ((hashtextextended($2, 0) >> 32) & 4294967295)
           AND held_lock.objid::bigint = (hashtextextended($2, 0) & 4294967295)`, [holder.pid, batchImportKey(householdId, batchId)]);
        // Once the wizard holds this batch key, a later lock query is for the account.
        if (row) {
          waiter = firstAttempt !== undefined && row.attempt !== firstAttempt;
          firstAttempt ??= row.attempt;
        }
        if (!waiter) await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(waiter).toBe(true);
      expect(await ledger(accountId)).toMatchObject({ balance: "1000.00", live: [], imports: 0 });
      letDetailPost();
      expect((await detail).status).toBe(200);
      const refused = await wizard;
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe("IMPORT_REVIEW_REQUIRED");
      expectPostedOnce(await ledger(accountId));
    } finally {
      letDetailPost();
      pause.mockRestore();
      await Promise.allSettled(wizard ? [detail, wizard] : [detail]);
    }
  }, 15_000);

  it("replays a recorded wizard batch even while another session owns the account admission key", async () => {
    const accountId = await newAccount();
    const batchId = randomUUID();
    const first = await wizardExecute(accountId, "prioritize_coppercoin", { batchId }).expect(200);
    const original = await ledger(accountId);
    const holder = await pool.connect();
    const key = accountImportKey(accountId);
    let released = false;
    try {
      await holder.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [key]);
      const replay = await wizardExecute(accountId, "prioritize_coppercoin", { batchId }).timeout(3_000).expect(200);
      expect(replay.body).toMatchObject({ importId: first.body.importId, replayed: true, imported: 2 });
      expect(await ledger(accountId)).toEqual(original);
    } finally {
      try {
        const { rows: [row] } = await holder.query<{ released: boolean }>(
          "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS released", [key]);
        released = row?.released === true;
      } finally { holder.release(!released); }
    }
  });
});
