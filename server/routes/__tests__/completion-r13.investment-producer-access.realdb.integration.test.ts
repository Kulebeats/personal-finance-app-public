import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { auditLogs, holdings, investmentTransactions, securities, taxLotDisposals, taxLots } from "@shared/schema";
import { db, pool } from "../../db";
import { a, b, actors, app, ids, reset, start, stop, type Role } from "../../modules/tags/__tests__/completion-r04.tags.fixture";

const securityId = randomUUID(), privateHolding = randomUUID(), sharedHolding = randomUUID();
const date = "2031-02-01";
function record(type: string, privateSource: boolean, role: Role = "member", overrides: Record<string, unknown> = {}) {
  return request(app).post("/api/investments/transactions").set("Cookie", actors.get(role)!.cookie)
    .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a).send({
      accountId: privateSource ? ids.privateAccount : ids.sharedAccount, holdingId: privateSource ? privateHolding : sharedHolding,
      securityId, type, amount: type === "interest" ? "34.00" : "100.00", currency: "ZMW", transactionDate: date,
      ...(type === "interest" ? { withholdingTax: "6.00" } : {}),
      ...(type === "buy" || type === "sell" ? { quantity: "1", price: "100.00" } : {}),
      ...overrides,
    });
}
async function clean() {
  await db.delete(taxLotDisposals).where(inArray(taxLotDisposals.householdId, [a, b]));
  await db.delete(taxLots).where(inArray(taxLots.householdId, [a, b]));
  await db.delete(investmentTransactions).where(inArray(investmentTransactions.householdId, [a, b]));
  await db.delete(holdings).where(inArray(holdings.householdId, [a, b]));
  await db.delete(securities).where(eq(securities.id, securityId));
}
async function snapshot() {
  return {
    holdings: await db.select().from(holdings).where(eq(holdings.householdId, a)).orderBy(holdings.id),
    activity: await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, a)).orderBy(investmentTransactions.id),
    lots: await db.select().from(taxLots).where(eq(taxLots.householdId, a)).orderBy(taxLots.id),
    disposals: await db.select().from(taxLotDisposals).where(eq(taxLotDisposals.householdId, a)).orderBy(taxLotDisposals.id),
    audits: await db.select().from(auditLogs).where(eq(auditLogs.entityType, "investment_transaction")).orderBy(auditLogs.id),
  };
}

describe("R13 investment producer authorizes the current actor and private source at the actual write", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await clean(); await reset();
    await db.insert(securities).values({ id: securityId, symbol: "R13_WRITE_SOURCE", name: "Synthetic investment admission source", type: "stock", currency: "ZMW" });
    await db.insert(holdings).values([
      { id: privateHolding, householdId: a, accountId: ids.privateAccount, securityId, quantity: "0", costBasis: "0", acquiredDate: "2030-01-01" },
      { id: sharedHolding, householdId: a, accountId: ids.sharedAccount, securityId, quantity: "0", costBasis: "0", acquiredDate: "2030-01-01" },
    ]);
    // Actual normal acquisitions establish spendable quantity and FIFO basis.
    await record("buy", true, "owner").expect(201);
    await record("buy", false, "owner").expect(201);
  });
  afterEach(clean);
  afterAll(async () => { await clean(); await stop(); });

  it.each(["interest", "buy", "sell", "fee"])("rejects a peer's normal %s write against another member's private custody", async type => {
    const before = await snapshot();
    const response = await record(type, true);
    expect.soft(response.status).toBe(404);
    expect.soft(response.text).not.toContain(privateHolding);
    expect(await snapshot()).toEqual(before);
  });
  it.each(["interest", "buy", "sell", "fee"])("permits the owner %s with an actor-only private proof", async type => {
    const created = await record(type, true, "owner").expect(201);
    const original = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "investment_transaction"), eq(auditLogs.entityId, created.body.data.id), eq(auditLogs.action, "CREATE")));
    expect(original).toHaveLength(1); expect(original[0]).toMatchObject({ householdId: null, userId: actors.get("owner")!.id });
  });
  it.each(["interest", "buy", "sell", "fee"])("retains the current member's normal shared %s writer", async type => {
    const created = await record(type, false).expect(201);
    expect(created.body.data).toMatchObject({ type, accountId: ids.sharedAccount, holdingId: sharedHolding, currency: "ZMW" });
  });
  it.each(["Account", "Holding"])("keeps missing and inaccessible %s responses equal without a doubled suffix", async resource => {
    const before = await snapshot();
    const hidden = resource === "Account" ? await record("interest", true) : await record("interest", false, "member", { holdingId: privateHolding });
    const missing = await record("interest", false, "member", resource === "Account" ? { accountId: randomUUID() } : { holdingId: randomUUID() });
    for (const response of [hidden, missing]) {
      expect.soft(response.status).toBe(404); expect.soft(response.body.error).toMatchObject({ code: "NOT_FOUND", message: `${resource} not found` });
      expect.soft(response.text).not.toContain(privateHolding); expect.soft(response.text).not.toContain(ids.privateAccount);
    }
    expect(await snapshot()).toEqual(before);
  });
  it("rejects a mismatched private holding without waiting for its row lock, just as for an absent holding", async () => {
    const before = await snapshot(), editor = await pool.connect();
    let attempt: Promise<request.Response> | undefined;
    try {
      await editor.query("BEGIN");
      const { rows: [backend] } = await editor.query("SELECT pg_backend_pid() AS pid");
      await editor.query("SELECT 1 FROM holdings WHERE id=$1 FOR UPDATE", [privateHolding]);
      const missing = await record("interest", false, "member", { holdingId: randomUUID() });
      let completed = false, waited = false;
      attempt = record("interest", false, "member", { holdingId: privateHolding }).then(response => { completed = true; return response; });
      const deadline = Date.now() + 5_000;
      while (!completed && !waited && Date.now() < deadline) {
        const { rows: [lock] } = await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting", [backend.pid]);
        waited = lock.waiting;
        if (!completed && !waited) await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect.soft(completed).toBe(true); expect.soft(waited).toBe(false);
      await editor.query("COMMIT");
      for (const response of [missing, await attempt]) {
        expect.soft(response.status).toBe(404); expect.soft(response.body.error).toMatchObject({ code: "NOT_FOUND", message: "Holding not found" });
      }
      expect(await snapshot()).toEqual(before);
    } finally {
      try { await editor.query("ROLLBACK"); } finally { editor.release(); }
      if (attempt) await Promise.allSettled([attempt]);
    }
  });

  it.each(["grant", "privacy", "holding account"])("waits for an earlier %s withdrawal and rechecks before storing financial history or proof", async withdrawal => {
    const editor = await pool.connect();
    let attempt: Promise<request.Response> | undefined;
    try {
      await editor.query("BEGIN");
      const { rows: [backend] } = await editor.query("SELECT pg_backend_pid() AS pid");
      if (withdrawal === "grant") await editor.query("UPDATE household_members SET role='view_only' WHERE household_id=$1 AND user_id=$2", [a, actors.get("member")!.id]);
      else if (withdrawal === "privacy") await editor.query("UPDATE accounts SET is_private=true,owner_user_id=$2 WHERE id=$1", [ids.sharedAccount, actors.get("owner")!.id]);
      else await editor.query("UPDATE holdings SET account_id=$2 WHERE id=$1", [sharedHolding, ids.privateAccount]);
      attempt = record("interest", false).then(response => response);
      let waited = false;
      const deadline = Date.now() + 5_000;
      while (!waited && Date.now() < deadline) {
        const { rows: [lock] } = await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting", [backend.pid]);
        waited = lock.waiting;
        if (!waited) await new Promise(resolve => setTimeout(resolve, 25));
      }
      await editor.query("COMMIT");
      const response = await attempt;
      expect.soft(waited).toBe(true); expect.soft(response.status).toBe(withdrawal === "grant" ? 403 : 404);
      expect(await db.select().from(investmentTransactions).where(and(eq(investmentTransactions.householdId, a), eq(investmentTransactions.type, "interest")))).toEqual([]);
      expect(await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "investment_transaction"), eq(auditLogs.userId, actors.get("member")!.id)))).toEqual([]);
    } finally {
      try { await editor.query("ROLLBACK"); } finally { editor.release(); }
      if (attempt) await Promise.allSettled([attempt]);
    }
  });
});
