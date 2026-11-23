import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { accounts, auditLogs, dataImports, transactions } from "@shared/schema";
import { createSignedHousehold, insertAccount, type SignedHousehold } from "../../__tests__/signed-household-fixture";
import { db, pool } from "../../db";
import { accountRepository } from "../../repositories/AccountRepository";
import { businessAuditService } from "../../services/BusinessAuditService";

type Strategy = "prioritize_coppercoin" | "prioritize_csv";
const date = "2026-07-10";
const name = "Synthetic currency-cut grocery";
const initialCurrency = "USD";
const nextCurrency = "EUR";
let owner: SignedHousehold;

const wizard = (accountId: string, batchId: string, strategy: Strategy, currency?: string) =>
  request(owner.app).post("/api/import/execute").set(owner.headers).send({
    targetAccountId: accountId, batchId, strategy, categoryMapping: {}, dateFormat: "auto",
    mapping: { date: "Date", amount: "Amount", merchant: "Merchant", ...(currency && { currency: "Currency" }) },
    rows: [{ Date: date, Amount: "-30.00", Merchant: name, ...(currency && { Currency: currency }) }],
  });

const detail = (accountId: string) => request(owner.app).post(`/api/accounts/${accountId}/transactions/import`)
  .set(owner.headers).send({ adjustBalance: true, transactions: [{ date, merchant: name, amount: "-30.00" }] });

function changeCurrency(accountId: string, currency: string) {
  return request(owner.app).put(`/api/accounts/${accountId}`).set(owner.headers).send({ currency });
}

async function accountLedger(accountId: string) {
  const [account] = await db.select({ currency: accounts.currency, balance: accounts.balance }).from(accounts)
    .where(eq(accounts.id, accountId));
  const rows = await db.select({
    id: transactions.id, currency: transactions.currency, amount: transactions.amount, source: transactions.source,
  }).from(transactions).where(eq(transactions.accountId, accountId));
  return { account, rows };
}

async function expectNoWizardHistory(accountId: string) {
  expect(await db.select({ id: dataImports.id }).from(dataImports).where(eq(dataImports.accountId, accountId))).toEqual([]);
  expect(await db.select({ id: auditLogs.id }).from(auditLogs).where(and(
    eq(auditLogs.entityType, "transaction_import"), eq(auditLogs.entityId, accountId),
  ))).toEqual([]);
}

/** Pause the real signed import after it reads the old denomination, and let the real account update commit. */
async function currencyWins(accountId: string, readToPause: number, start: () => request.Test) {
  let allowImport!: () => void;
  const resumed = new Promise<void>(resolve => { allowImport = resolve; });
  let observed!: () => void;
  const captured = new Promise<void>(resolve => { observed = resolve; });
  const original = accountRepository.findByIdWithVisibility.bind(accountRepository);
  let reads = 0;
  const cut = vi.spyOn(accountRepository, "findByIdWithVisibility").mockImplementation(async (...args) => {
    const selected = await original(...args);
    if (args[0] === accountId && ++reads === readToPause) {
      expect(selected?.currency).toBe(initialCurrency);
      observed();
      await resumed;
    }
    return selected;
  });
  const pending = start().timeout(10_000).then(response => response);
  void pending.catch(() => undefined);
  try {
    await Promise.race([captured, pending.then(response => { throw new Error(`Import exited before currency cut: ${response.status}`); })]);
    const edited = await changeCurrency(accountId, nextCurrency).expect(200);
    expect(edited.body.data.currency).toBe(nextCurrency);
    expect(await accountLedger(accountId)).toEqual({ account: { currency: nextCurrency, balance: "100.00" }, rows: [] });
    allowImport();
    return await pending;
  } finally {
    allowImport();
    await Promise.allSettled([pending]);
    cut.mockRestore();
  }
}

describe("A-48 account denomination versus first import, signed HTTP and real Postgres", () => {
  beforeAll(async () => { owner = await createSignedHousehold("import-currency-race", initialCurrency); }, 30_000);
  afterAll(async () => { await owner.cleanup(async () => {
    await db.delete(dataImports).where(eq(dataImports.householdId, owner.householdId));
  }); });

  it.each([
    ["prioritize_coppercoin", initialCurrency],
    ["prioritize_csv", initialCurrency],
    ["prioritize_coppercoin", undefined],
  ] as const)("refuses stale wizard validation in %s with file currency %s", async (strategy, fileCurrency) => {
    const accountId = await insertAccount(owner);
    const batchId = randomUUID();
    const raced = await currencyWins(accountId, 1, () => wizard(accountId, batchId, strategy, fileCurrency));
    expect(raced.status, JSON.stringify(raced.body)).toBe(409);
    expect(raced.body.error).toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/account currency changed/i) });
    expect(await accountLedger(accountId)).toEqual({ account: { currency: nextCurrency, balance: "100.00" }, rows: [] });
    await expectNoWizardHistory(accountId);

    const retry = await wizard(accountId, batchId, strategy, nextCurrency).expect(200);
    expect(retry.body).toMatchObject({ imported: 1, replayed: false, errors: [] });
    expect(await accountLedger(accountId)).toEqual({
      account: { currency: nextCurrency, balance: "70.00" },
      rows: [{ id: expect.any(String), currency: nextCurrency, amount: "30.00", source: "csv_import" }],
    });
    const replay = await wizard(accountId, batchId, strategy, nextCurrency).expect(200);
    expect(replay.body).toMatchObject({ importId: retry.body.importId, imported: 1, replayed: true });
    await changeCurrency(accountId, initialCurrency).expect(409);
  }, 15_000);

  it("does not record an all-failed proof validated against the old currency", async () => {
    const accountId = await insertAccount(owner);
    const batchId = randomUUID();
    const raced = await currencyWins(accountId, 1,
      () => wizard(accountId, batchId, "prioritize_coppercoin", nextCurrency));
    expect(raced.status, JSON.stringify(raced.body)).toBe(409);
    await expectNoWizardHistory(accountId);
    const retry = await wizard(accountId, batchId, "prioritize_coppercoin", nextCurrency).expect(200);
    expect(retry.body).toMatchObject({ imported: 1, failed: 0, replayed: false });
  }, 15_000);

  it("commits the first wizard import in the original currency when the signed edit waits behind it", async () => {
    const accountId = await insertAccount(owner);
    const batchId = randomUUID();
    let announce!: (pid: number) => void;
    const held = new Promise<number>(resolve => { announce = resolve; });
    let release!: () => void;
    const commit = new Promise<void>(resolve => { release = resolve; });
    const makeAudit = businessAuditService.logCreate.bind(businessAuditService);
    const pause = vi.spyOn(businessAuditService, "logCreate").mockImplementation(async params => {
      const result = await makeAudit(params);
      if (params.entityType === "transaction_import" && params.entityId === accountId) {
        if (!params.tx) throw new Error("The import audit did not share the posting transaction");
        const { rows: [row] } = await params.tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
        announce(row.pid);
        await commit;
      }
      return result;
    });
    const startWizard = () => wizard(accountId, batchId, "prioritize_coppercoin", initialCurrency);
    const pendingImport = startWizard().timeout(12_000).then(response => response);
    void pendingImport.catch(() => undefined);
    let pendingEdit: Promise<request.Response> | undefined;
    try {
      const pid = await Promise.race([held, pendingImport.then(response => {
        throw new Error(`Import exited before the commit cut: ${response.status}`);
      })]);
      pendingEdit = changeCurrency(accountId, nextCurrency).timeout(12_000).then(response => response);
      void pendingEdit.catch(() => undefined);
      let waiting = false;
      const deadline = Date.now() + 5_000;
      while (!waiting && Date.now() < deadline) {
        const { rows: [row] } = await pool.query<{ blocked: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
           AND $1=ANY(pg_blocking_pids(pid)) AND query ILIKE '%accounts%' AND query ILIKE '%for update%') AS blocked`, [pid]);
        waiting = row.blocked;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(waiting).toBe(true);
      expect(await accountLedger(accountId)).toEqual({ account: { currency: initialCurrency, balance: "100.00" }, rows: [] });
      await expectNoWizardHistory(accountId);
      release();
      const [imported, refused] = await Promise.all([pendingImport, pendingEdit]);
      expect(imported.status, JSON.stringify(imported.body)).toBe(200);
      expect(imported.body).toMatchObject({ imported: 1, duplicate: 0, skipped: 0, failed: 0, deleted: 0, replayed: false });
      expect(refused.status, JSON.stringify(refused.body)).toBe(409);
      expect(refused.body.error).toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/account activity prevents changes to currency/i) });

      const saved = await accountLedger(accountId);
      expect(saved).toEqual({
        account: { currency: initialCurrency, balance: "70.00" },
        rows: [{ id: expect.any(String), currency: initialCurrency, amount: "30.00", source: "csv_import" }],
      });
      const replay = await startWizard().expect(200);
      expect(replay.body).toEqual({ ...imported.body, replayed: true });
      expect(await accountLedger(accountId)).toEqual(saved);
      const history = await db.select().from(dataImports).where(eq(dataImports.accountId, accountId));
      expect(history).toMatchObject([{
        id: imported.body.importId, accountId, batchKey: batchId, source: "global_csv", status: "completed",
        recordCount: 1, successfulCount: 1, importedCount: 1, duplicateCount: 0, skippedCount: 0, failedCount: 0, deletedCount: 0,
        rowOutcomes: [{ ordinal: 1, outcome: "imported", transactionId: saved.rows[0].id }],
      }]);
      const audits = await db.select({ action: auditLogs.action, entityType: auditLogs.entityType }).from(auditLogs)
        .where(eq(auditLogs.entityId, accountId));
      expect(audits).toEqual([{ action: "CREATE", entityType: "transaction_import" }]);
    } finally {
      release();
      await Promise.allSettled(pendingEdit ? [pendingImport, pendingEdit] : [pendingImport]);
      pause.mockRestore();
    }
  }, 20_000);

  it("keeps the Detail row writer's existing locked-denomination rejection", async () => {
    const accountId = await insertAccount(owner);
    // Its batch and ordinary row service both read USD. The change lands
    // after the second read, so only the writer's account lock can catch it.
    const raced = await currencyWins(accountId, 2, () => detail(accountId));
    expect(raced.status, JSON.stringify(raced.body)).toBe(400);
    expect(raced.body.error).toMatchObject({ code: "ACCOUNT_IMPORT_INCOMPLETE", details: {
      imported: 0, failedRow: 1, cause: { code: "VALIDATION_ERROR", message: expect.stringMatching(/locked account currency/i) },
    } });
    expect(await accountLedger(accountId)).toEqual({ account: { currency: nextCurrency, balance: "100.00" }, rows: [] });

    const retry = await detail(accountId).expect(200);
    expect(retry.body.data).toMatchObject({ imported: 1, skipped: 0 });
    expect(await accountLedger(accountId)).toEqual({
      account: { currency: nextCurrency, balance: "70.00" },
      rows: [{ id: expect.any(String), currency: nextCurrency, amount: "30.00", source: "csv_import" }],
    });
    await changeCurrency(accountId, initialCurrency).expect(409);
  }, 15_000);
});
