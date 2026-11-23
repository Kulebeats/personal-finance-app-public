import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { accountBalanceSnapshots, accounts, fxRates, transactions } from "@shared/schema";
import { db, pool } from "../../../db";
import { accountService } from "../accounts.service";
import { createFXRateRepository, createFXRateService, setGlobalFXService } from "../../../core/calculations/currency/fxRates";
import { a, b, actors, app, ids, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

// Test-only contract for NEW-32. All requests use the real signed transport;
// the failure trigger is restricted to this fixture's actor and audit kinds.
const trigger = `r08_account_audit_${randomUUID().replaceAll("-", "")}`;
const privateTransactionId = randomUUID();
type Export = "summary" | "history" | "transactions";
const exportKinds: Export[] = ["summary", "history", "transactions"];
const successfulExports = exportKinds.flatMap(kind => [1, 2].map(recordCount => [kind, recordCount] as const));
const signed = (call: request.Test, role: Role = "member") => call
  .set("Cookie", actors.get(role)!.cookie)
  .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a);
function exportPath(kind: Export, accountId = ids.sharedAccount) {
  return kind === "summary" ? "/api/accounts/summary/export"
    : `/api/accounts/${accountId}/${kind === "history" ? "balance-history" : "transactions"}/export`;
}
function download(kind: Export, role: Role = "member", accountId = ids.sharedAccount) {
  return signed(request(app).get(exportPath(kind, accountId)), role);
}
function expectNoFinancialPayload(result: { text: string; body: { data?: unknown } }) {
  expect.soft(result.body.data).toBeUndefined();
  expect.soft(result.text).not.toMatch(/A5 SHARED|A5 PRIVATE|SHAREDTXN coffee|PRIVATE_EXPORT_CANARY|PRIVSECRET|Account Name,Type|Date,Amount|Date,Merchant|123\.45|988\.89|11\.11/);
}
async function addVisibleRow(kind: Export) {
  if (kind === "summary") await db.insert(accounts).values({ householdId: a, name: "SECOND_SHARED_SOURCE",
    type: "checking", currency: "ZMW", balance: "12.34", isPrivate: false, ownerUserId: null });
  if (kind === "history") await db.insert(accountBalanceSnapshots).values({ accountId: ids.sharedAccount,
    date: "2026-10-06", balance: "124.45" });
  if (kind === "transactions") await db.insert(transactions).values({ householdId: a,
    accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id,
    date: "2026-10-06", name: "SECOND_SHARED_SOURCE", amount: "12.34",
    type: "expense", currency: "ZMW", isPrivate: false });
}
async function state() {
  return {
    accounts: (await pool.query("select * from accounts where household_id=any($1::uuid[]) order by id", [[a, b]])).rows,
    transactions: (await pool.query("select * from transactions where household_id=any($1::uuid[]) order by id", [[a, b]])).rows,
    snapshots: (await pool.query("select s.* from account_balance_snapshots s join accounts a on a.id=s.account_id where a.household_id=any($1::uuid[]) order by s.account_id,s.date", [[a, b]])).rows,
    audits: (await pool.query("select * from audit_logs where household_id=any($1::uuid[]) or user_id=any($2::uuid[]) order by id",
      [[a, b], Array.from(actors.values(), actor => actor.id)])).rows,
    outbox: (await pool.query("select * from outbox_events where household_id=any($1::uuid[]) order by id", [[a, b]])).rows,
  };
}
async function dropFailure() {
  await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON audit_logs; DROP FUNCTION IF EXISTS ${trigger}()`);
}
async function rejectAudit(entity: "account" | "data_export") {
  await pool.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.user_id='${actors.get("member")!.id}'::uuid AND NEW.entity_type='${entity}' THEN
        RAISE EXCEPTION 'Synthetic mandatory account audit failure';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
}
function createAccount(isPrivate: boolean, forwardedFor?: string) {
  const call = signed(request(app).post("/api/accounts"));
  if (forwardedFor) call.set("X-Forwarded-For", forwardedFor);
  return call.send({
    name: "Synthetic audited account", type: "savings", currency: "ZMW",
    initialBalance: "123.45", isPrivate,
    ownerUserId: isPrivate ? actors.get("member")!.id : null,
  });
}

describe("R08 NEW-32 signed account exports and creation require exactly one durable audit", () => {
  beforeAll(async () => {
    await start();
    setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates)));
  }, 30_000);
  beforeEach(async () => {
    await dropFailure();
    await reset();
    await db.insert(accountBalanceSnapshots).values({ accountId: ids.sharedAccount, date: "2026-10-05", balance: "123.45" });
    // The shared account has two transactions, but the member may export only
    // the ordinary public one. Audit counts must use that same visible set.
    await db.insert(transactions).values({ id: privateTransactionId, householdId: a,
      accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id,
      date: "2026-10-05", name: "PRIVATE_EXPORT_CANARY", amount: "222.22",
      type: "expense", currency: "ZMW", isPrivate: true });
  });
  afterEach(dropFailure);
  afterAll(async () => { await dropFailure(); await stop(); });

  it.each(successfulExports)("records one actor-bound %s CSV audit for %s visible rows", async (kind, recordCount) => {
    if (recordCount === 2) await addVisibleRow(kind);
    const before = await state();
    const result = await download(kind).expect(200);
    expect(result.headers["content-type"]).toContain("text/csv");
    expect(result.headers["content-disposition"]).toContain("attachment;");
    if (kind === "summary") expect(result.text).toContain("A5 SHARED");
    if (kind === "history") expect(result.text).toContain("2026-10-05,123.45");
    if (kind === "transactions") expect(result.text).toContain("SHAREDTXN coffee");
    if (recordCount === 2) expect(result.text).toContain(kind === "history" ? "2026-10-06,124.45" : "SECOND_SHARED_SOURCE");
    expect(result.text).not.toMatch(/A5 PRIVATE|PRIVATE_EXPORT_CANARY|PRIVSECRET/);
    const after = await state();
    const previous = new Set(before.audits.map(row => row.id));
    const added = after.audits.filter(row => !previous.has(row.id));
    expect.soft(added).toHaveLength(1);
    if (added.length === 1) {
      expect(added[0]).toMatchObject({ household_id: null, user_id: actors.get("member")!.id,
        action: "PROCESS", entity_type: "data_export", details: { recordCount } });
      expect(added[0].entity_id).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
      expect(JSON.stringify(added[0].details)).not.toMatch(/PRIVATE_EXPORT_CANARY|PRIVSECRET|222\.22/);
    }
    expect({ ...after, audits: before.audits }).toEqual(before);
  });

  it.each(exportKinds)("publishes no %s CSV when the mandatory egress audit insert fails", async kind => {
    const before = await state();
    await rejectAudit("data_export");
    const result = await download(kind);
    expect.soft(result.status).toBe(500);
    expect.soft(result.headers["content-type"]).not.toContain("text/csv");
    expect.soft(result.headers["content-disposition"]).toBeUndefined();
    expect.soft(result.body).toHaveProperty("error");
    expectNoFinancialPayload(result);
    expect(await state()).toEqual(before);
  });

  it("records zero visible transactions while a private source remains", async () => {
    await pool.query("delete from transactions where id=$1", [ids.sharedTx]);
    const before = await state();
    const result = await download("transactions").expect(200);
    expect(result.headers["content-type"]).toContain("text/csv");
    expect(result.text.trim()).toBe("Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags");
    const after = await state();
    const added = after.audits.filter(row => !before.audits.some(previous => previous.id === row.id));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ household_id: null, user_id: actors.get("member")!.id,
      action: "PROCESS", entity_type: "data_export", details: { recordCount: 0 } });
    expect({ ...after, audits: before.audits }).toEqual(before);
  });

  for (const role of ["view_only", "professional"] as const) {
    it.each(exportKinds)(`denies ${role} %s egress without a success audit or financial change`, async kind => {
      const before = await state();
      const result = await download(kind, role).expect(403);
      expect(result.headers["content-type"]).not.toContain("text/csv");
      expect(result.headers["content-disposition"]).toBeUndefined();
      expectNoFinancialPayload(result);
      expect(await state()).toEqual(before);
    });
  }

  it.each(["history", "transactions"] as const)("keeps hidden and absent %s sources opaque without a success audit", async kind => {
    const before = await state();
    const hidden = await download(kind, "member", ids.privateAccount).expect(404);
    const absent = await download(kind, "member", randomUUID()).expect(404);
    expect(hidden.body.error.code).toBe(absent.body.error.code);
    for (const result of [hidden, absent]) {
      expect(result.headers["content-type"]).not.toContain("text/csv");
      expect(result.headers["content-disposition"]).toBeUndefined();
      expectNoFinancialPayload(result);
    }
    expect(await state()).toEqual(before);
  });

  it.each([false, true])("creates one account and one mandatory audit, private=%s", async isPrivate => {
    const before = await state();
    const result = await createAccount(isPrivate).expect(201);
    const after = await state();
    const previousAccounts = new Set(before.accounts.map(row => row.id));
    const addedAccounts = after.accounts.filter(row => !previousAccounts.has(row.id));
    expect(addedAccounts).toHaveLength(1);
    expect(addedAccounts[0]).toMatchObject({ household_id: a, is_private: isPrivate, balance: "123.45",
      currency: "ZMW", owner_user_id: isPrivate ? actors.get("member")!.id : null });
    expect(result.body.data.id).toBe(addedAccounts[0].id);
    const previousAudits = new Set(before.audits.map(row => row.id));
    const addedAudits = after.audits.filter(row => !previousAudits.has(row.id));
    expect(addedAudits).toHaveLength(1);
    expect(addedAudits[0]).toMatchObject({ household_id: isPrivate ? null : a, user_id: actors.get("member")!.id,
      action: "CREATE", entity_type: "account", entity_id: addedAccounts[0].id });
    expect(after.transactions).toEqual(before.transactions);
    expect(after.snapshots).toEqual(before.snapshots);
  });

  it.each([false, true])("rolls back account creation when its mandatory audit fails, private=%s", async isPrivate => {
    const before = await state();
    await rejectAudit("account");
    const result = await createAccount(isPrivate);
    expect.soft(result.status).toBe(500);
    expect(await state()).toEqual(before);
  });

  it.each(["203.0.113.10, 10.0.0.1", "not-an-ip"])("does not abort valid creation on forwarded provenance %s", async forwarded => {
    const before = await state();
    const result = await createAccount(false, forwarded).expect(201);
    const after = await state();
    expect(after.accounts.filter(row => !before.accounts.some(previous => previous.id === row.id)))
      .toMatchObject([{ id: result.body.data.id, balance: "123.45" }]);
    const added = after.audits.filter(row => !before.audits.some(previous => previous.id === row.id));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ household_id: a, user_id: actors.get("member")!.id,
      entity_type: "account", entity_id: result.body.data.id, action: "CREATE" });
    expect(added[0].ip_address ?? "").not.toMatch(/,|not-an-ip/);
  });

  it("preserves one mandatory account audit for the ordinary service caller", async () => {
    const before = await state();
    const account = await accountService.createAccount({ name: "Synthetic direct account", type: "savings",
      currency: "ZMW", initialBalance: "123.45", ownerUserId: null }, a, actors.get("member")!.id);
    const after = await state();
    expect(after.accounts.filter(row => !before.accounts.some(previous => previous.id === row.id)))
      .toMatchObject([{ id: account.id, balance: "123.45" }]);
    const added = after.audits.filter(row => !before.audits.some(previous => previous.id === row.id));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ household_id: a, user_id: actors.get("member")!.id,
      entity_type: "account", entity_id: account.id, action: "CREATE" });
  });

  it("rolls back the ordinary service caller when its mandatory account audit fails", async () => {
    const before = await state();
    await rejectAudit("account");
    await expect.soft(accountService.createAccount({ name: "Synthetic direct rejected account", type: "savings",
      currency: "ZMW", initialBalance: "123.45", ownerUserId: null }, a, actors.get("member")!.id)).rejects.toThrow();
    expect(await state()).toEqual(before);
  });
});
