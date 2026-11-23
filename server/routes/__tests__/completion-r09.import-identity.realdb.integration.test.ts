/**
 * NEW-17 (R09, decision D13): import row identity and honest import history.
 *
 * Identity is the provider reference when the file maps one, else the batch
 * fingerprint (file rows + mapping version) plus the row ordinal, scoped to the
 * account. A same-day, same-amount row already in the ledger is a duplicate
 * CANDIDATE shown in the preview, never a silent merge. Every import writes one
 * `data_imports` row in the same transaction as its ledger rows; a batch id
 * replayed with the same content returns the recorded result, with changed
 * content it is a 409, and concurrent replays have one effect.
 *
 * Real HTTP against real Postgres. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { reviewedRemovalsFrom } from "../../testing/fixtures/import-overwrite-review";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "../../db";
import {
  accounts, auditLogs, householdMembers, households, merchants, outboxEvents, transactions, users,
} from "@shared/schema";
import { getTestApp } from "../../__tests__/fixtures";
import { hashPassword } from "../../auth";
import { statementRowKey } from "../../services/import/identity";

type CsvRow = Record<string, string>;
interface ImportHistoryRow {
  household_id: string | null;
  account_id: string | null;
  user_id: string | null;
  batch_key: string | null;
  status: string | null;
  record_count: number | null;
  imported_count: number;
  duplicate_count: number;
  skipped_count: number;
  failed_count: number | null;
  successful_count: number | null;
  row_outcomes: Array<{ ordinal: number; outcome: string; transactionId?: string }>;
}

const householdId = randomUUID();
const userId = randomUUID();
/** A second member: the review P1-2 probe runs as Bob against Alice's (userId's) private rows. */
const bobId = randomUUID();
const currency = "USD";
const mapping = { date: "Date", amount: "Amount", merchant: "Merchant", notes: "Memo" };
let app: Awaited<ReturnType<typeof getTestApp>>;
let cookie: string;
let bobCookie: string;

function auth(req: request.Test) {
  return req.set("Cookie", cookie).set("X-Capital-Subject", userId).set("X-Capital-Household", householdId);
}

function asBob(req: request.Test) {
  return req.set("Cookie", bobCookie).set("X-Capital-Subject", bobId).set("X-Capital-Household", householdId);
}

function execute(targetAccountId: string, rows: CsvRow[], extra: Record<string, unknown> = {}, as = auth) {
  return as(request(app).post("/api/import/execute")).send({
    targetAccountId, strategy: "prioritize_coppercoin", mapping, categoryMapping: {}, dateFormat: "auto", rows, ...extra,
  });
}

function preview(targetAccountId: string, rows: CsvRow[], extra: Record<string, unknown> = {}, as = auth) {
  return as(request(app).post("/api/import/preview")).send({
    targetAccountId, strategy: "prioritize_coppercoin", mapping, categoryMapping: {}, dateFormat: "auto", rows, ...extra,
  });
}

async function newAccount(balance = "100.00") {
  const [account] = await db.insert(accounts).values({ householdId, ownerUserId: userId, name: "Synthetic NEW-17 checking",
    type: "checking", isAsset: true, currency, balance, initialBalance: balance }).returning();
  return account.id;
}

async function ledger(accountId: string) {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  const rows = await pool.query<{ id: string; name: string; amount: string; notes: string | null; idempotency_key: string | null }>(
    "SELECT id, name, amount, notes, idempotency_key FROM transactions WHERE account_id=$1 AND deleted_at IS NULL ORDER BY name, id",
    [accountId]);
  return { balance: account.balance, rows: rows.rows };
}

async function history(accountId: string): Promise<ImportHistoryRow[]> {
  const result = await pool.query<ImportHistoryRow>(
    "SELECT * FROM data_imports WHERE account_id=$1 ORDER BY created_at, id", [accountId]);
  return result.rows;
}

const coffee: CsvRow = { Date: "2026-03-02", Amount: "-4.50", Merchant: "Synthetic coffee", Memo: "" };

describe("NEW-17 import identity and history (real Postgres)", () => {
  beforeAll(async () => {
    app = await getTestApp();
    const email = `new17-${userId}@example.invalid`;
    const password = "SyntheticImportIdentity123!";
    await db.insert(households).values({ id: householdId, name: "Synthetic NEW-17", currency: "ZMW" });
    await db.insert(users).values({ id: userId, email, username: `new17-${userId}`,
      passwordHash: await hashPassword(password), emailVerified: true });
    await db.insert(householdMembers).values({ householdId, userId, role: "owner" });
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
    const bobEmail = `new17-bob-${bobId}@example.invalid`;
    await db.insert(users).values({ id: bobId, email: bobEmail, username: `new17-bob-${bobId}`,
      passwordHash: await hashPassword(password), emailVerified: true });
    await db.insert(householdMembers).values({ householdId, userId: bobId, role: "member" });
    const bobLogin = await request(app).post("/api/auth/login").send({ email: bobEmail, password }).expect(200);
    bobCookie = (bobLogin.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 30000);

  afterAll(async () => {
    await pool.query("DELETE FROM data_imports WHERE user_id = ANY($1)", [[userId, bobId]]);
    await db.delete(outboxEvents).where(eq(outboxEvents.householdId, householdId));
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(transactions).where(eq(transactions.householdId, householdId));
    await db.delete(merchants).where(eq(merchants.householdId, householdId));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    for (const id of [userId, bobId]) {
      await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [id]);
      await db.delete(auditLogs).where(eq(auditLogs.userId, id));
      await pool.query("DELETE FROM security_audit_logs WHERE user_id = $1", [id]);
      await db.delete(users).where(eq(users.id, id));
    }
  });

  it("imports two identical same-day purchases from one file and records honest history", async () => {
    const accountId = await newAccount();
    const res = await execute(accountId, [coffee, coffee]).expect(200);
    expect(res.body).toMatchObject({ imported: 2, duplicate: 0, skipped: 0, failed: 0, deleted: 0, replayed: false });
    const saved = await ledger(accountId);
    expect(saved.balance).toBe("91.00");
    expect(saved.rows).toHaveLength(2);
    expect(new Set(saved.rows.map(row => row.idempotency_key)).size).toBe(2);
    const [record] = await history(accountId);
    expect(record).toMatchObject({ household_id: householdId, user_id: userId, status: "completed", record_count: 2,
      imported_count: 2, duplicate_count: 0, skipped_count: 0, failed_count: 0, successful_count: 2 });
    expect(res.body.importId).toBe((await pool.query("SELECT id FROM data_imports WHERE account_id=$1", [accountId])).rows[0].id);
    expect(record.row_outcomes.map(row => row.outcome)).toEqual(["imported", "imported"]);
  });

  it("re-importing the same file adds nothing and records the rows as duplicates", async () => {
    const accountId = await newAccount();
    await execute(accountId, [coffee, coffee]).expect(200);
    const before = await ledger(accountId);
    const again = await execute(accountId, [coffee, coffee]).expect(200);
    expect(again.body).toMatchObject({ imported: 0, duplicate: 2, skipped: 0, failed: 0 });
    expect(await ledger(accountId)).toEqual(before);
    const records = await history(accountId);
    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({ imported_count: 0, duplicate_count: 2 });
  });

  it("does not merge a different purchase that shares date, type and amount with an existing row", async () => {
    const accountId = await newAccount();
    const manual = await auth(request(app).post("/api/transactions")).send({ accountId, date: "2026-03-02", name: "Manual bakery",
      amount: { amount: "4.50", currency }, type: "expense" }).expect(201);
    const candidateId: string = manual.body.data.id;
    const before = await ledger(accountId);
    const lunch = { ...coffee, Merchant: "Synthetic lunch", Memo: "Team lunch" };
    const draft = await preview(accountId, [lunch]).expect(200);
    expect(draft.body.rows).toEqual([expect.objectContaining({ ordinal: 1, date: "2026-03-02", status: "candidate",
      candidate: expect.objectContaining({ id: candidateId, name: before.rows[0].name, amount: "4.50", reason: "same_date_amount" }) })]);

    const held = await execute(accountId, [lunch]).expect(409);
    expect(held.body.error).toMatchObject({ code: "IMPORT_REVIEW_REQUIRED", details: { candidates: [
      { ordinal: 1, candidate: { id: candidateId } },
    ] } });
    expect(await ledger(accountId)).toEqual(before);
    expect(await history(accountId)).toEqual([]);

    const res = await execute(accountId, [lunch], { postRows: [{ ordinal: 1, candidateId }] }).expect(200);
    expect(res.body).toMatchObject({ imported: 1, duplicate: 0, skipped: 0 });
    const saved = await ledger(accountId);
    expect(saved.rows.map(row => [row.name.toLowerCase(), row.notes])).toEqual([["manual bakery", null], ["synthetic lunch", "Team lunch"]]);
    expect(saved.rows.find(row => row.id === candidateId)).toEqual(before.rows[0]);
    expect(saved.balance).toBe("91.00");
    expect((await execute(accountId, [lunch]).expect(200)).body).toMatchObject({ imported: 0, duplicate: 1, skipped: 0 });
    expect(await ledger(accountId)).toEqual(saved);
  });

  it("skips only the candidates the user confirmed as duplicates", async () => {
    const accountId = await newAccount();
    await execute(accountId, [coffee]).expect(200);
    const overlapping = [{ ...coffee, Memo: "re-exported" }, { ...coffee, Merchant: "Second coffee" }];
    const draft = await preview(accountId, overlapping).expect(200);
    expect(draft.body.rows.map((row: { status: string }) => row.status)).toEqual(["candidate", "new"]);
    const res = await execute(accountId, overlapping, {
      skipRowOrdinals: [1], skipRows: [{ ordinal: 1, candidateId: draft.body.rows[0].candidate.id }] }).expect(200);
    expect(res.body).toMatchObject({ imported: 1, duplicate: 0, skipped: 1, failed: 0 });
    expect((await ledger(accountId)).rows.map(row => row.name)).toEqual(["Second coffee", "Synthetic coffee"]);
    const records = await history(accountId);
    expect(records[1].row_outcomes.map(row => row.outcome)).toEqual(["skipped", "imported"]);
  });

  it("uses the provider reference as identity when the file maps one", async () => {
    const accountId = await newAccount();
    const withRef = { ...mapping, reference: "Ref" };
    const a = { ...coffee, Ref: "BANK-001" };
    const b = { ...coffee, Ref: "BANK-002" };
    const first = await execute(accountId, [a, b], { mapping: withRef }).expect(200);
    expect(first.body).toMatchObject({ imported: 2 });
    const before = await ledger(accountId);
    const beforeHistory = await history(accountId);
    const key = (reference: string) => statementRowKey(householdId, accountId, "", { ordinal: 1, reference });
    const savedA = before.rows.find(row => row.idempotency_key === key(a.Ref))!;
    const savedB = before.rows.find(row => row.idempotency_key === key(b.Ref))!;
    expect(savedA).toBeDefined();
    expect(savedB).toBeDefined();
    const c = { ...coffee, Ref: "BANK-003" };
    const next = [{ ...b, Memo: "edited export" }, c];
    // The same reference replays even with an edited memo. The other stored key
    // is opaque, so BANK-003 needs a choice against the remaining candidate.
    const draft = await preview(accountId, next, { mapping: withRef }).expect(200);
    expect(draft.body.rows).toEqual([
      expect.objectContaining({ ordinal: 1, status: "duplicate" }),
      expect.objectContaining({ ordinal: 2, status: "candidate", candidate: expect.objectContaining({ id: savedA.id }) }),
    ]);
    const held = await execute(accountId, next, { mapping: withRef }).expect(409);
    expect(held.body.error).toMatchObject({ code: "IMPORT_REVIEW_REQUIRED", details: { candidates: [
      { ordinal: 2, candidate: { id: savedA.id } },
    ] } });
    expect(await ledger(accountId)).toEqual(before);
    expect(await history(accountId)).toEqual(beforeHistory);

    const later = await execute(accountId, next, {
      mapping: withRef, postRows: [{ ordinal: 2, candidateId: savedA.id }],
    }).expect(200);
    expect(later.body).toMatchObject({ imported: 1, duplicate: 1 });
    const saved = await ledger(accountId);
    expect(saved.rows).toHaveLength(3);
    expect(saved.rows).toEqual(expect.arrayContaining([savedA, savedB, expect.objectContaining({ idempotency_key: key(c.Ref) })]));
    expect(saved.balance).toBe("86.50");
    expect((await execute(accountId, next, { mapping: withRef }).expect(200)).body)
      .toMatchObject({ imported: 0, duplicate: 2, skipped: 0 });
    expect(await ledger(accountId)).toEqual(saved);
  });

  it("previews with the chosen date format and reports row errors as failed", async () => {
    const accountId = await newAccount();
    const rows = [{ ...coffee, Date: "03/04/2026" }, { ...coffee, Date: "2026-02-30" }];
    const draft = await preview(accountId, rows, { dateFormat: "DD/MM/YYYY" }).expect(200);
    expect(draft.body.rows).toEqual([expect.objectContaining({ ordinal: 1, date: "2026-04-03", status: "new" })]);
    expect(draft.body.errors).toEqual([expect.objectContaining({ rowIndex: 2, field: "date" })]);
    const res = await execute(accountId, rows, { dateFormat: "DD/MM/YYYY" }).expect(200);
    expect(res.body).toMatchObject({ imported: 1, failed: 1 });
    const [record] = await history(accountId);
    expect(record).toMatchObject({ imported_count: 1, failed_count: 1, record_count: 2 });
    expect(record.row_outcomes.map(row => [row.ordinal, row.outcome])).toEqual([[1, "imported"], [2, "failed"]]);
  });

  it("replays a lost response once: opening 100, expense 10, income 20 ends at 110", async () => {
    const accountId = await newAccount("100.00");
    const batchId = randomUUID();
    const rows = [{ ...coffee, Amount: "-10.00" }, { ...coffee, Amount: "20.00", Merchant: "Synthetic refund" }];
    const first = await execute(accountId, rows, { batchId }).expect(200);
    const replay = await execute(accountId, rows, { batchId }).expect(200);
    expect(replay.body).toMatchObject({ importId: first.body.importId, replayed: true, imported: 2, duplicate: 0 });
    expect((await ledger(accountId)).balance).toBe("110.00");
    expect(await history(accountId)).toHaveLength(1);
  });

  it("refuses a replayed batch id carrying changed content with 409 and writes nothing", async () => {
    const accountId = await newAccount();
    const batchId = randomUUID();
    await execute(accountId, [coffee], { batchId }).expect(200);
    const before = await ledger(accountId);
    const changed = await execute(accountId, [{ ...coffee, Amount: "-45.00" }], { batchId }).expect(409);
    expect(changed.body.error.code).toBe("CONFLICT");
    expect(await ledger(accountId)).toEqual(before);
    expect(await history(accountId)).toHaveLength(1);
  });

  it("gives two concurrent replays of one batch a single effect", async () => {
    const accountId = await newAccount();
    const batchId = randomUUID();
    const [a, b] = await Promise.all([execute(accountId, [coffee, coffee], { batchId }), execute(accountId, [coffee, coffee], { batchId })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.importId).toBe(b.body.importId);
    expect([a.body.replayed, b.body.replayed].sort()).toEqual([false, true]);
    const saved = await ledger(accountId);
    expect(saved.rows).toHaveLength(2);
    expect(saved.balance).toBe("91.00");
    expect(await history(accountId)).toHaveLength(1);
  });

  it("records account-detail imports in data_imports with the same counts it returns", async () => {
    const accountId = await newAccount();
    const body = { adjustBalance: true, transactions: [
      { date: "2026-03-02", merchant: "Synthetic coffee", amount: "-4.50" },
      { date: "2026-03-02", merchant: "Synthetic coffee", amount: "-4.50" },
    ] };
    const first = await auth(request(app).post(`/api/accounts/${accountId}/transactions/import`)).send(body).expect(200);
    expect(first.body.data).toMatchObject({ imported: 2, skipped: 0 });
    await auth(request(app).post(`/api/accounts/${accountId}/transactions/import`)).send(body).expect(200);
    const records = await history(accountId);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ household_id: householdId, status: "completed", record_count: 2, imported_count: 2, duplicate_count: 0 });
    expect(records[1]).toMatchObject({ imported_count: 0, duplicate_count: 2 });
  });

  it("refuses a file that repeats a provider reference with different content, naming both rows (review P1-1)", async () => {
    const accountId = await newAccount();
    const withRef = { ...mapping, reference: "Ref" };
    const rows = [{ ...coffee, Amount: "-10.00", Ref: "BANK-DUP" }, { ...coffee, Amount: "-20.00", Ref: "BANK-DUP" }];
    const draft = await preview(accountId, rows, { mapping: withRef }).expect(200);
    expect(draft.body.rows.map((row: { status: string }) => row.status)).toEqual(["new", "conflict"]);
    expect(draft.body.rows[1]).toMatchObject({ repeatsOrdinal: 1 });
    expect(draft.body.counts).toMatchObject({ new: 1, conflict: 1 });
    for (const strategy of ["prioritize_coppercoin", "prioritize_csv"]) {
      const refused = await execute(accountId, rows, { mapping: withRef, strategy }).expect(409);
      expect(refused.body.error.details.errors).toEqual([expect.objectContaining({ rowIndex: 2, field: "row",
        reason: "Row 2 repeats the reference of row 1 with different content" })]);
    }
    expect((await ledger(accountId)).rows).toEqual([]);
    expect(await history(accountId)).toEqual([]);
    // A byte-identical repeat stays an ordinary in-file duplicate.
    const same = await execute(accountId, [rows[0], rows[0]], { mapping: withRef }).expect(200);
    expect(same.body).toMatchObject({ imported: 1, duplicate: 1 });
  });

  it("previews changed history under a known reference as a conflict, as execute refuses it (review P2-1)", async () => {
    const accountId = await newAccount();
    const withRef = { ...mapping, reference: "Ref" };
    await execute(accountId, [{ ...coffee, Amount: "-10.00", Ref: "BANK-CHG" }], { mapping: withRef }).expect(200);
    const changed = [{ ...coffee, Amount: "-20.00", Ref: "BANK-CHG" }];
    const draft = await preview(accountId, changed, { mapping: withRef }).expect(200);
    expect(draft.body.rows.map((row: { status: string }) => row.status)).toEqual(["conflict"]);
    expect(draft.body.counts).toMatchObject({ conflict: 1, duplicate: 0 });
    await execute(accountId, changed, { mapping: withRef }).expect(409);
  });

  it("previews a changed description under a known reference as a conflict and writes nothing (A-22)", async () => {
    const accountId = await newAccount();
    const withRef = { ...mapping, reference: "Ref" };
    const first = { ...coffee, Merchant: "Synthetic corner cafe", Ref: "BANK-DESC" };
    await execute(accountId, [first], { mapping: withRef }).expect(200);
    // The member (or a rule) renames the posting; the statement's own description stays in originalName.
    await pool.query("UPDATE transactions SET name = 'Coffee (renamed)' WHERE account_id = $1", [accountId]);
    const before = await ledger(accountId);
    const beforeHistory = await history(accountId);

    // The unchanged statement still replays as a duplicate, because a rename is not a statement change.
    const replay = await preview(accountId, [first], { mapping: withRef }).expect(200);
    expect(replay.body.rows.map((row: { status: string }) => row.status)).toEqual(["duplicate"]);

    const changed = [{ ...first, Merchant: "Synthetic different shop" }];
    const draft = await preview(accountId, changed, { mapping: withRef }).expect(200);
    expect(draft.body.rows.map((row: { status: string }) => row.status)).toEqual(["conflict"]);
    expect(draft.body.counts).toMatchObject({ conflict: 1, duplicate: 0 });
    const refused = await execute(accountId, changed, { mapping: withRef }).expect(409);
    expect(refused.body.error.code).toBe("CONFLICT");
    expect(await ledger(accountId)).toEqual(before);
    expect(await history(accountId)).toEqual(beforeHistory);
  });

  it("answers another member's private reference exactly like a visible duplicate and writes nothing (review P1-2)", async () => {
    const accountId = await newAccount();
    const withRef = { ...mapping, reference: "Ref" };
    const alicePrivate = { ...coffee, Ref: "ALICE-PRIVATE" };
    const aliceShared = { ...coffee, Merchant: "Synthetic shared", Ref: "ALICE-SHARED" };
    await execute(accountId, [alicePrivate, aliceShared], { mapping: withRef }).expect(200);
    await pool.query("UPDATE transactions SET is_private = true WHERE account_id=$1 AND name ILIKE 'synthetic coffee'", [accountId]);
    const privateCount = await pool.query("SELECT id FROM transactions WHERE account_id=$1 AND is_private", [accountId]);
    expect(privateCount.rows).toHaveLength(1);
    const before = await ledger(accountId);

    // Bob submits the private reference with a DIFFERENT amount, and the visible one unchanged.
    const hidden = { ...alicePrivate, Amount: "-99.00" };
    const shape = (row: Record<string, unknown>) => ({ ...row, ordinal: 0, amount: "", merchant: "", reference: "" });
    const hiddenPreview = await preview(accountId, [hidden], { mapping: withRef }, asBob).expect(200);
    const visiblePreview = await preview(accountId, [aliceShared], { mapping: withRef }, asBob).expect(200);
    expect(hiddenPreview.body.rows[0].status).toBe("duplicate");
    expect(shape(hiddenPreview.body.rows[0])).toEqual(shape(visiblePreview.body.rows[0]));
    expect(hiddenPreview.body.counts).toEqual(visiblePreview.body.counts);
    expect(hiddenPreview.body.errors).toEqual(visiblePreview.body.errors);

    const hiddenRun = await execute(accountId, [hidden], { mapping: withRef }, asBob).expect(200);
    const visibleRun = await execute(accountId, [aliceShared], { mapping: withRef }, asBob).expect(200);
    const result = (body: Record<string, unknown>) => ({ ...body, importId: "" });
    expect(result(hiddenRun.body)).toEqual(result(visibleRun.body));
    expect(hiddenRun.body).toMatchObject({ imported: 0, duplicate: 1, replayed: false });
    expect(await ledger(accountId)).toEqual(before);
    const bobHistory = await pool.query<{ id: string; row_outcomes: ImportHistoryRow["row_outcomes"] }>(
      "SELECT id, row_outcomes FROM data_imports WHERE user_id=$1 AND account_id=$2", [bobId, accountId]);
    expect(bobHistory.rows.find(row => row.id === hiddenRun.body.importId)?.row_outcomes).toEqual([{ ordinal: 1, outcome: "duplicate" }]);
  });

  it("records an account-detail import that stops part-way as one partial history row (review P2-2)", async () => {
    const accountId = await newAccount("100.00");
    const res = await auth(request(app).post(`/api/accounts/${accountId}/transactions/import`)).send({ adjustBalance: true, transactions: [
      { date: "2026-03-02", merchant: "Synthetic coffee", amount: "-10.00" },
      { date: "2026-03-03", merchant: "Synthetic overdraft", amount: "-500.00" },
    ] });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.error).toMatchObject({ code: "ACCOUNT_IMPORT_INCOMPLETE", details: { imported: 1, failedRow: 2 } });
    expect((await ledger(accountId)).rows).toHaveLength(1);
    const records = await history(accountId);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: "partial", record_count: 2, imported_count: 1, failed_count: 1, duplicate_count: 0 });
    expect(records[0].row_outcomes.map(row => [row.ordinal, row.outcome])).toEqual([[1, "imported"], [2, "failed"]]);
  });

  it("refuses changed history under an UPPERCASE account id with a 409 and deletes nothing (review r2 P2)", async () => {
    const accountId = await newAccount();
    const withRef = { ...mapping, reference: "Ref" };
    await execute(accountId, [{ ...coffee, Amount: "-10.00", Ref: "BANK-CASE" },
      { ...coffee, Merchant: "Synthetic other", Ref: "BANK-OTHER" }], { mapping: withRef }).expect(200);
    const before = await ledger(accountId);
    const upper = accountId.toUpperCase();
    const changed = [{ ...coffee, Amount: "-20.00", Ref: "BANK-CASE" }];
    const draft = await preview(upper, changed, { mapping: withRef }).expect(200);
    expect(draft.body.rows.map((row: { status: string }) => row.status)).toEqual(["conflict"]);
    for (const strategy of ["prioritize_coppercoin", "prioritize_csv"]) {
      // A-02: BANK-OTHER is reviewed for removal, so the overwrite runs and the changed history is what refuses.
      const reviewedRemovals = await reviewedRemovalsFrom(preview(upper, changed, { mapping: withRef, strategy }));
      const refused = await execute(upper, changed, { mapping: withRef, strategy, reviewedRemovals }).expect(409);
      expect(refused.body.error.code).not.toBe("IMPORT_OVERWRITE_CHANGED");
      // Overwrite would have deleted BANK-OTHER first; the 409 must roll that back.
      expect(await ledger(accountId)).toEqual(before);
    }
    expect(await history(accountId)).toHaveLength(1);
  });

  it("stores identical outcomes for a hidden match and a visible duplicate (review r2 P1, partial)", async () => {
    const accountId = await newAccount();
    const withRef = { ...mapping, reference: "Ref" };
    const alicePrivate = { ...coffee, Ref: "R2-PRIVATE" };
    const aliceShared = { ...coffee, Merchant: "Synthetic shared", Ref: "R2-SHARED" };
    await execute(accountId, [alicePrivate, aliceShared], { mapping: withRef }).expect(200);
    await pool.query("UPDATE transactions SET is_private = true WHERE account_id=$1 AND name ILIKE 'synthetic coffee'", [accountId]);
    const hiddenRun = await execute(accountId, [alicePrivate], { mapping: withRef }, asBob).expect(200);
    const visibleRun = await execute(accountId, [aliceShared], { mapping: withRef }, asBob).expect(200);
    const stored = async (id: string) => (await pool.query<Pick<ImportHistoryRow, "row_outcomes" | "duplicate_count" | "imported_count" | "status">>(
      "SELECT row_outcomes, duplicate_count, imported_count, status FROM data_imports WHERE id=$1", [id])).rows[0];
    const hiddenStored = await stored(hiddenRun.body.importId);
    expect(hiddenStored).toEqual(await stored(visibleRun.body.importId));
    expect(hiddenStored.row_outcomes).toEqual([{ ordinal: 1, outcome: "duplicate" }]);
  });

  it("replays an overwrite identically whether the kept reference is visible or another member's private row (review r3 P1)", async () => {
    const withRef = { ...mapping, reference: "Ref" };
    const run = async (hidden: boolean) => {
      const accountId = await newAccount();
      const kept = { ...coffee, Ref: `R3-KEPT-${hidden}` };
      await execute(accountId, [kept], { mapping: withRef, strategy: "prioritize_csv" }).expect(200);
      if (hidden) await pool.query("UPDATE transactions SET is_private = true WHERE account_id=$1", [accountId]);
      // A visible expense added later in the same date range: an exact replay must leave it intact.
      await execute(accountId, [{ ...coffee, Merchant: "Synthetic later", Amount: "-7.00", Ref: `R3-LATER-${hidden}` }],
        { mapping: withRef }).expect(200);
      const replayed = await execute(accountId, [kept],
        { mapping: withRef, strategy: "prioritize_csv", batchId: randomUUID() }, asBob).expect(200);
      const deletes = await pool.query("SELECT id FROM audit_logs WHERE entity_type='transaction' AND action='DELETE' AND details->'oldValue'->>'accountId'=$1", [accountId]);
      const stored = await pool.query<Pick<ImportHistoryRow, "row_outcomes" | "duplicate_count" | "imported_count" | "status"> & { deleted_count: number }>(
        "SELECT row_outcomes, duplicate_count, imported_count, deleted_count, status FROM data_imports WHERE id=$1", [replayed.body.importId]);
      const saved = await ledger(accountId);
      return { body: { ...replayed.body, importId: "" }, deletes: deletes.rows.length, stored: stored.rows[0],
        balance: saved.balance, names: saved.rows.map(row => [row.name, row.amount]) };
    };
    const visible = await run(false);
    const hiddenRun = await run(true);
    expect(visible).toMatchObject({ deletes: 0, body: { deleted: 0, duplicate: 1, imported: 0 } });
    expect(hiddenRun).toEqual(visible);
  });
});
