import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { accounts, auditLogs, fxRates, holdings, householdFxRateOverrides, investmentTransactions, recurringInvestments,
  securities, taxLotDisposals, taxLots } from "@shared/schema";
import { db, pool } from "../../db";
import { logger } from "../../utils/logger";
import { a, b, actors, app, ids, reset, start, stop } from "../../modules/tags/__tests__/completion-r04.tags.fixture";
import { processDueInvestments } from "../../services/investment/processDueInvestments";
import { resolvedFxRate } from "../../repositories/reports/fxRateExpr";
import { convertInvestmentEventToZmw } from "../../modules/investments/investmentDatedFx";
import { Money } from "../../core/money";

// Lane 3 (NEW-21 F3/F4, #242 review P2-2/P2-4): every stored ZMW base comes
// from the dated rate, the audit names the rate row it came from, a stale
// provider rate is refused, a SIP keeps the holding's known ZMW base, and a
// missing-rate refusal is logged with the pair and date only.
const year = 2031, securityId = randomUUID(), holdingId = randomUUID(), zmwSecurityId = randomUUID(), zmwHoldingId = randomUUID();
const policy = "dated_household_then_provider_fx_v1";
let dueDate: string;
function signed(path: string) {
  const actor = actors.get("member")!;
  return request(app).post(path).set("Cookie", actor.cookie).set("X-Capital-Subject", actor.id).set("X-Capital-Household", a);
}
function record(body: Record<string, unknown>) {
  return signed("/api/investments/transactions").send({ accountId: ids.sharedAccount, holdingId, securityId, currency: "USD",
    type: "buy", quantity: "4", price: "205.00", amount: "820.00", transactionDate: `${year}-01-10`, ...body });
}
function zmwIncome(body: Record<string, unknown>) {
  return signed("/api/investments/transactions").send({ accountId: ids.sharedAccount, holdingId: zmwHoldingId, securityId: zmwSecurityId,
    currency: "ZMW", type: "dividend", amount: "34.00", withholdingTax: "6.00", transactionDate: `${year}-02-01`, ...body });
}
async function householdRate(rate: string, window: { effectiveDate?: string; validThrough?: string } = {}) {
  const [row] = await db.insert(householdFxRateOverrides).values({ householdId: a, actorUserId: actors.get("owner")!.id,
    fromCurrency: "USD", toCurrency: "ZMW", effectiveDate: window.effectiveDate ?? "2000-01-01",
    validThrough: window.validThrough ?? "2099-12-31", rate }).returning();
  return row;
}
async function providerRate(date: string, rate = "3.2500") {
  const [row] = await db.insert(fxRates).values({ id: randomUUID(), fromCurrency: "XTS", toCurrency: "ZMW", rate, date, source: "synthetic_lane3" }).returning();
  return row;
}
async function useCurrency(currency: string) {
  await db.update(securities).set({ currency }).where(eq(securities.id, securityId));
}
async function createAudit(entityId: string) {
  const [row] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "investment_transaction"),
    eq(auditLogs.entityId, entityId), eq(auditLogs.action, "CREATE")));
  return row;
}
const activity = () => db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, a));
const holding = async (id: string) => (await db.select().from(holdings).where(eq(holdings.id, id)))[0];
async function heldSip(currency = "USD", amount = "4.00") {
  const created = await signed("/api/investments/recurring").send({ operationId: randomUUID(), accountId: ids.sharedAccount, securityId,
    type: "sip", frequency: "monthly", amount, currency, nextExecutionDate: dueDate }).expect(200);
  expect(await processDueInvestments()).toMatchObject({ success: 0, held: 1, failed: 0 });
  return created.body.data.id as string;
}
const ONE_FILL = [{ executionDate: "", quantity: "2.00000000", price: "2.0000", fees: "0.00" }];
function confirmSip(planId: string, fills = ONE_FILL) {
  return signed(`/api/investments/recurring/${planId}/occurrences/${dueDate}/confirm`).send({ operationId: randomUUID(),
    expectedRevision: 0, finalStatement: true, outcome: "filled",
    fills: fills.map(fill => ({ ...fill, executionDate: fill.executionDate || dueDate })) });
}
function opening(body: Record<string, unknown>) {
  return signed("/api/investments/holdings").send({ operationId: randomUUID(), expectedCurrency: "USD",
    accountId: ids.sharedAccount, securityId, acquiredDate: "2020-01-01", ...body });
}
const removeHolding = (id: string) => request(app).delete(`/api/investments/holdings/${id}`).set("Cookie", actors.get("member")!.cookie);
const migration = (file: string) => readFileSync(fileURLToPath(new URL(`../../../migrations/${file}`, import.meta.url)), "utf8");
/** Apply 0047 as the migrator would: each statement in order. Idempotent. */
async function apply0047() {
  for (const statement of migration("0047_r13_sip_fill_fx_source.sql").split("--> statement-breakpoint")) {
    if (statement.replace(/--.*$/gm, "").trim()) await pool.query(statement);
  }
}
/** 0042's own evidence function, loaded under pg_temp so both versions run side by side. */
function evidenceFrom0042() {
  const text = migration("0042_r13_sip_fill_dated_fx.sql"), head = "CREATE OR REPLACE FUNCTION public.c306_sip_fill_evidence(";
  const begin = text.indexOf(head), end = text.indexOf("$body$;", begin);
  if (begin < 0 || end < 0) throw new Error("0042 has no c306_sip_fill_evidence");
  return text.slice(begin, end + "$body$;".length).replace("public.c306_sip_fill_evidence(", "pg_temp.c306_sip_fill_evidence_0042(");
}
const FILL_JOIN = `from investment_transactions p join investment_sip_confirmed_fills f on f.purchase_id=p.id
  join investment_sip_confirmations c on c.id=f.confirmation_id
  join investment_sip_occurrences o on o.plan_id=c.plan_id and o.original_due_date=c.original_due_date`;
async function evidence(purchaseId: string) {
  const client = await pool.connect();
  try {
    await client.query(evidenceFrom0042());
    const result = await client.query(`select public.c306_sip_fill_evidence(p.id) as now, pg_temp.c306_sip_fill_evidence_0042(p.id) as was,
      public.c306_sip_fill_digest(p.id,o.authorized_frequency,o.authorized_initial_date) as digest, proof.authorized_terms_digest as stored
      ${FILL_JOIN} join investment_purchase_authorization_proofs proof on proof.purchase_id=p.id where p.id=$1`, [purchaseId]);
    return result.rows[0] as { now: boolean; was: boolean; digest: string | null; stored: string };
  } finally { client.release(true); }
}
/** A later, separate transaction rewriting the fill's CREATE audit details. */
async function rewriteAudit(purchaseId: string, details: unknown) {
  await pool.query(`update audit_logs set details=$2::jsonb where entity_id=$1 and action='CREATE' and entity_type='investment_transaction'`,
    [purchaseId, JSON.stringify(details)]);
}

async function clean() {
  await db.delete(recurringInvestments).where(eq(recurringInvestments.householdId, a));
  await db.delete(taxLotDisposals).where(eq(taxLotDisposals.householdId, a));
  await db.delete(taxLots).where(eq(taxLots.householdId, a));
  await db.delete(investmentTransactions).where(eq(investmentTransactions.householdId, a));
  await db.delete(holdings).where(eq(holdings.householdId, a));
  await db.delete(securities).where(inArray(securities.id, [securityId, zmwSecurityId]));
  await db.delete(auditLogs).where(eq(auditLogs.householdId, a));
  await db.delete(householdFxRateOverrides).where(eq(householdFxRateOverrides.householdId, a));
  await db.delete(fxRates).where(eq(fxRates.fromCurrency, "XTS"));
  await db.delete(householdFxRateOverrides).where(eq(householdFxRateOverrides.householdId, b));
}

describe("Lane 3 investment FX residuals: dated bases, rate provenance, SIP holding base, logged refusals", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await clean(); await reset();
    dueDate = new Date().toISOString().slice(0, 10);
    await db.update(accounts).set({ type: "investment" }).where(eq(accounts.id, ids.sharedAccount));
    await db.insert(securities).values([
      { id: securityId, symbol: "LN3F" + securityId.slice(0, 8), name: "Synthetic lane 3 USD", type: "stock", currency: "USD", currentPrice: "2.00" },
      { id: zmwSecurityId, symbol: "LN3Z" + zmwSecurityId.slice(0, 8), name: "Synthetic lane 3 ZMW", type: "stock", currency: "ZMW", currentPrice: "2.00" },
    ]);
    await db.insert(holdings).values({ id: zmwHoldingId, householdId: a, accountId: ids.sharedAccount, securityId: zmwSecurityId, quantity: "1", costBasis: "100.00" });
    const owner = actors.get("owner")!;
    await request(app).put("/api/investments/calendar").set("Cookie", owner.cookie)
      .set("X-Capital-Subject", owner.id).set("X-Capital-Household", a).send({ timeZone: "UTC" }).expect(200);
  });
  afterEach(async () => { vi.restoreAllMocks(); await clean(); });
  afterAll(async () => { await clean(); await stop(); });

  describe("F3: a ZMW income row cannot carry a caller-typed base or rate", () => {
    it("refuses a ZMW dividend whose typed ZMW amount differs from its native amount, and stores nothing", async () => {
      expect((await zmwIncome({ amountZmw: "35.00" })).status).toBe(400);
      expect(await activity()).toEqual([]);
    });
    it("refuses a ZMW dividend with a non-unit typed rate, and stores nothing", async () => {
      expect((await zmwIncome({ fxRate: "26.5" })).status).toBe(400);
      expect(await activity()).toEqual([]);
    });
    it("keeps a ZMW dividend that types its own native amount and a unit rate", async () => {
      await zmwIncome({ amountZmw: "34.00", fxRate: "1" }).expect(201);
      expect((await activity())[0]).toMatchObject({ currency: "ZMW", amount: "34.00", amountZmw: "34.00" });
    });
  });

  describe("F4: the audit names the rate row used, and a stale provider rate is refused", () => {
    beforeEach(async () => {
      await db.insert(holdings).values({ id: holdingId, householdId: a, accountId: ids.sharedAccount, securityId, quantity: "0", costBasis: "0" });
    });
    it("records the household rate row, its effective date and kind in the buy's CREATE audit", async () => {
      const rate = await householdRate("26.5", { effectiveDate: `${year}-01-01`, validThrough: `${year}-01-31` });
      const created = await record({}).expect(201);
      expect((await createAudit(created.body.data.id)).details).toMatchObject({ fxRateBasis: policy,
        fxRateSource: { kind: "household", id: rate.id, date: `${year}-01-01` } });
    });
    it("records the provider rate row when the household has none and it is at most 7 days old", async () => {
      await useCurrency("XTS");
      const rate = await providerRate(`${year}-01-03`);
      const created = await record({ currency: "XTS" }).expect(201);
      expect(created.body.data).toMatchObject({ fxRate: "3.25000000", amountZmw: "2665.00" });
      expect((await createAudit(created.body.data.id)).details).toMatchObject({ fxRateBasis: policy,
        fxRateSource: { kind: "provider", id: rate.id, date: `${year}-01-03` } });
    });
    it("refuses a provider rate more than 7 days older than the event as a 422 naming the pair and both dates", async () => {
      await useCurrency("XTS");
      await providerRate(`${year}-01-02`);
      const refused = await record({ currency: "XTS" });
      expect(refused.status).toBe(422);
      expect(refused.body.error).toMatchObject({ code: "FX_RATE_STALE",
        details: { from: "XTS", to: "ZMW", date: `${year}-01-10`, rateDate: `${year}-01-02` } });
      expect(JSON.stringify(refused.body)).not.toContain("820");
      expect(await activity()).toEqual([]);
    });
    it("records the rate row on a verified declared opening's purchase audit", async () => {
      const rate = await householdRate("25");
      const created = await signed("/api/investments/holdings").send({ operationId: randomUUID(), expectedCurrency: "USD",
        accountId: ids.sharedAccount, securityId, quantity: "5", costBasis: "10.00", costBasisZmw: "250.00", acquisitionFxRate: "25",
        acquiredDate: "2020-01-01" }).expect(201);
      const purchase = (await activity()).find(row => row.holdingId === created.body.data.id)!;
      expect((await createAudit(purchase.id)).details).toMatchObject({ fxRateBasis: policy,
        fxRateSource: { kind: "household", id: rate.id, date: "2000-01-01" } });
    });
  });

  describe("investments and reports pick the same dated rate (datedRateRow mirrors resolvedFxRate)", () => {
    async function override(rate: string, effectiveDate: string, validThrough: string) {
      await db.insert(householdFxRateOverrides).values({ householdId: a, actorUserId: actors.get("owner")!.id,
        fromCurrency: "XTS", toCurrency: "ZMW", effectiveDate, validThrough, rate });
    }
    async function bothRates(date: string) {
      return db.transaction(async tx => {
        const report = await tx.execute<{ rate: string | null }>(
          sql`select (${resolvedFxRate(a, sql`${"XTS"}::text`, "ZMW", sql`${date}::date`)})::text as rate`);
        const investment = await convertInvestmentEventToZmw(tx, a, "XTS", date, "1.00", {});
        return { report: report.rows[0].rate, investment: investment!.fxRate, kind: investment!.source.kind, id: investment!.source.id };
      });
    }
    it.each([
      ["two valid overrides: the newer effective date wins", `${year}-02-15`, "3.5", "household"],
      ["the newer override's valid_through has ended: the older still-valid one", `${year}-03-03`, "3.4", "household"],
      ["the last day of valid_through is still valid", `${year}-03-05`, "3.4", "household"],
      ["every override has ended: the provider rate dated on or before, not a later one", `${year}-03-06`, "3.25", "provider"],
    ] as const)("%s", async (_name, date, expected, kind) => {
      await override("3.40", `${year}-01-01`, `${year}-03-05`);
      await override("3.50", `${year}-02-01`, `${year}-02-28`);
      await providerRate(`${year}-03-01`, "3.25");
      await providerRate(`${year}-03-10`, "9.99");
      const rates = await bothRates(date);
      expect(rates.kind).toBe(kind);
      expect(new Money(rates.investment).equals(expected)).toBe(true);
      expect(rates.report).not.toBeNull();
      expect(new Money(rates.report!).equals(rates.investment)).toBe(true);
    });
    it("breaks a tie between two provider rows on one date the same way, by the lower id", async () => {
      // fx_rates has no unique (from, to, date): two sources can record one day.
      const [low, high] = [randomUUID(), randomUUID()].sort();
      await db.insert(fxRates).values([
        { id: high, fromCurrency: "XTS", toCurrency: "ZMW", rate: "3.3000", date: `${year}-03-01`, source: "synthetic_lane3" },
        { id: low, fromCurrency: "XTS", toCurrency: "ZMW", rate: "3.2000", date: `${year}-03-01`, source: "synthetic_lane3_b" },
      ]);
      for (let run = 0; run < 3; run++) {
        const rates = await bothRates(`${year}-03-02`);
        expect(rates).toMatchObject({ kind: "provider", id: low });
        expect(new Money(rates.investment).equals("3.2")).toBe(true);
        expect(new Money(rates.report!).equals(rates.investment)).toBe(true);
      }
    });
  });

  describe("#254 r4: a SIP fill dated before the holding's acquiredDate never strands the plan", () => {
    const daysBefore = (days: number) => new Date(Date.parse(`${dueDate}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
    const fillOn = (executionDate: string) => [{ ...ONE_FILL[0], executionDate }];

    it("keeps confirming a SIP-opened USD holding after an earlier-dated fill (three occurrences)", async () => {
      await householdRate("26.5");
      const first = await confirmSip(await heldSip(), fillOn(daysBefore(4)));
      expect(first.status).toBe(200);
      const holdingId: string = (await activity())[0].holdingId!;
      // Occurrence 2 is filled before occurrence 1's execution date.
      expect((await confirmSip(await heldSip(), fillOn(daysBefore(8)))).status).toBe(200);
      expect((await holding(holdingId)).acquiredDate).toBe(daysBefore(8));
      const third = await confirmSip(await heldSip(), fillOn(dueDate));
      expect(third.status).toBe(200);
      expect((await activity()).map(row => row.transactionDate).sort()).toEqual([daysBefore(8), daysBefore(4), dueDate]);
      const after = await holding(holdingId);
      expect(after.quantity).toBe("6.00000000");
      expect(after.costBasisZmw).toBe("318.00");
    });

    it("refuses a fill dated before a declared opening with a named 409, writing nothing, and still confirms a later fill", async () => {
      await householdRate("26.5");
      const opened = await signed("/api/investments/holdings").send({ operationId: randomUUID(), expectedCurrency: "USD",
        accountId: ids.sharedAccount, securityId, quantity: "5", costBasis: "10.00", acquiredDate: daysBefore(4),
        costBasisZmw: "265.00", acquisitionFxRate: "26.5" });
      expect(opened.status).toBe(201);
      const planId = await heldSip();
      const refused = await confirmSip(planId, fillOn(daysBefore(8)));
      expect(refused.status).toBe(409);
      expect(refused.body.error).toMatchObject({ code: "CONFLICT", details: { reason: "FILL_BEFORE_DECLARED_OPENING" } });
      expect((await activity()).map(row => row.transactionDate)).toEqual([daysBefore(4)]);
      expect((await confirmSip(planId, fillOn(dueDate))).status).toBe(200);
      expect((await holding(opened.body.data.id)).acquiredDate).toBe(daysBefore(4));
    });

    it("names FILL_BEFORE_DECLARED_OPENING even when the fill's date has no rate, changing nothing (#261 review)", async () => {
      // The only USD rate starts on the declared opening date: the earlier fill has none.
      await householdRate("26.5", { effectiveDate: daysBefore(4) });
      const opened = await signed("/api/investments/holdings").send({ operationId: randomUUID(), expectedCurrency: "USD",
        accountId: ids.sharedAccount, securityId, quantity: "5", costBasis: "10.00", acquiredDate: daysBefore(4),
        costBasisZmw: "265.00", acquisitionFxRate: "26.5" });
      expect(opened.status).toBe(201);
      const planId = await heldSip();
      const actorIds = Array.from(actors.values()).map(actor => actor.id);
      const state = async () => ({
        occurrences: (await pool.query("select * from investment_sip_occurrences where household_id=$1 order by plan_id", [a])).rows,
        confirmations: (await pool.query("select * from investment_sip_confirmations where household_id=$1 order by id", [a])).rows,
        fills: (await pool.query(`select f.* from investment_sip_confirmed_fills f join investment_sip_confirmations c
          on c.id=f.confirmation_id where c.household_id=$1`, [a])).rows,
        plans: await db.select().from(recurringInvestments).where(eq(recurringInvestments.id, planId)),
        holdings: await db.select().from(holdings).where(eq(holdings.householdId, a)),
        activity: await activity(),
        audits: await db.select().from(auditLogs).where(inArray(auditLogs.userId, actorIds)).orderBy(auditLogs.id),
      });
      const before = await state();
      const refused = await confirmSip(planId, fillOn(daysBefore(8)));
      expect(refused.status).toBe(409);
      expect(refused.body.error).toMatchObject({ code: "CONFLICT", details: { reason: "FILL_BEFORE_DECLARED_OPENING" } });
      expect(await state()).toEqual(before);
    });
  });

  describe("#254 r3: the locked rate row must still be eligible for the event", () => {
    /** Hold the chosen row, let the write queue on it, change it, commit, and expect a 409 with nothing written. */
    async function refusedAfterChange(table: string, rowId: string, send: () => Promise<request.Response>, change: string[]) {
      const holder = await pool.connect();
      try {
        await holder.query("BEGIN");
        await holder.query(`select id from ${table} where id=$1 for update`, [rowId]);
        const response = send();
        let waiting = false;
        for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
          waiting = (await pool.query(`select 1 from pg_stat_activity where wait_event_type='Lock'
            and query ilike $1 and pid<>pg_backend_pid()`, [`%${table}%`])).rows.length > 0;
          if (!waiting) await new Promise(resolve => setTimeout(resolve, 100));
        }
        expect(waiting, "the write never waited on the chosen rate row's lock").toBe(true);
        for (const statement of change) await holder.query(statement, statement.includes("$1") ? [rowId] : []);
        await holder.query("COMMIT");
        const refused = await response;
        expect(refused.status).toBe(409);
        expect(refused.body.error).toMatchObject({ code: "CONFLICT" });
        expect(await activity()).toEqual([]);
      } finally {
        await holder.query("ROLLBACK").catch(() => undefined);
        holder.release(true);
      }
    }

    it("refuses with a 409, writing nothing, when the chosen override's valid_through is cut short at the same rate", async () => {
      await db.insert(holdings).values({ id: holdingId, householdId: a, accountId: ids.sharedAccount, securityId, quantity: "0", costBasis: "0" });
      const rate = await householdRate("26.5");
      // The 0032 guard forbids any in-place change to an override; bypass it to prove
      // the converter's own re-check does not depend on that guard.
      await refusedAfterChange("household_fx_rate_overrides", rate.id, () => record({}).then(result => result), [
        "SET LOCAL session_replication_role = replica",
        // Same rate, but the override no longer covers the trade date (2031-01-10).
        "update household_fx_rate_overrides set valid_through='2001-01-01' where id=$1",
      ]);
    });

    it("refuses with a 409, writing nothing, when the chosen provider row is re-dated past the event at the same rate", async () => {
      await useCurrency("XTS");
      const rate = await providerRate(dueDate, "3.2500");
      const planId = await heldSip("XTS");
      await refusedAfterChange("fx_rates", rate.id, () => confirmSip(planId).then(result => result),
        ["update fx_rates set date = date + 1 where id=$1"]);
    });

    it("refuses with a 409, writing nothing, when a newer provider row is committed while the write waits on the chosen one", async () => {
      await useCurrency("XTS");
      const dayBefore = new Date(Date.parse(`${dueDate}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      const rate = await providerRate(dayBefore, "3.2500");
      const planId = await heldSip("XTS");
      await refusedAfterChange("fx_rates", rate.id, () => confirmSip(planId).then(result => result),
        [`insert into fx_rates (id, from_currency, to_currency, rate, date, source)
          select gen_random_uuid(), from_currency, to_currency, rate, date + 1, source from fx_rates where id=$1`]);
    });

    it("refuses with a 409, writing nothing, when a newer provider row appears after the lock-time check, before the fill proof (#254 r4)", async () => {
      await useCurrency("XTS");
      const dayBefore = new Date(Date.parse(`${dueDate}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      await providerRate(dayBefore, "3.2500");
      const planId = await heldSip("XTS");
      // Test-only trigger: the purchase INSERT (after conversion and its lock-time
      // check, before the proof) records a newer rate for the fill's date.
      await pool.query(`create function public.lane3_r4_newer_rate() returns trigger language plpgsql as $$ begin
          insert into fx_rates (id, from_currency, to_currency, rate, date, source)
            values (gen_random_uuid(), 'XTS', 'ZMW', 3.3000, new.transaction_date, 'synthetic_lane3');
          return new; end $$`);
      await pool.query(`create trigger lane3_r4_newer_rate after insert on investment_transactions for each row
          when (new.household_id = '${a}'::uuid and new.currency = 'XTS') execute function public.lane3_r4_newer_rate()`);
      try {
        const refused = await confirmSip(planId);
        expect(refused.status).toBe(409);
        expect(refused.body.error).toMatchObject({ code: "CONFLICT" });
        expect(await activity()).toEqual([]);
      } finally {
        await pool.query("drop trigger if exists lane3_r4_newer_rate on investment_transactions");
        await pool.query("drop function if exists public.lane3_r4_newer_rate()");
      }
      // The trigger's row rolled back with the refusal, so a retry confirms at the original row.
      expect((await confirmSip(planId)).status).toBe(200);
    });
  });

  describe("P2-4: a missing-rate refusal is logged with the pair and date only", () => {
    it("warns with the pair, date and route, and nothing about the amount or account", async () => {
      await db.insert(holdings).values({ id: holdingId, householdId: a, accountId: ids.sharedAccount, securityId, quantity: "0", costBasis: "0" });
      const warn = vi.spyOn(logger, "warn");
      expect((await record({})).status).toBe(422);
      const calls = warn.mock.calls.filter(([message]) => message === "Missing exchange rate");
      expect(calls).toEqual([["Missing exchange rate", { route: "/api/investments/transactions", from: "USD", to: "ZMW", date: `${year}-01-10` }]]);
      const logged = JSON.stringify(calls);
      for (const secret of ["820", ids.sharedAccount, holdingId, securityId]) expect(logged).not.toContain(secret);
    });
    const confirmTemplate = "/api/investments/recurring/:planId/occurrences/:scheduledDate/confirm";
    it("logs the trusted route template, never the real ids (#254 review)", async () => {
      const planId = await heldSip();
      const warn = vi.spyOn(logger, "warn");
      expect((await confirmSip(planId)).status).toBe(422);
      const calls = warn.mock.calls.filter(([message]) => message === "Missing exchange rate");
      expect(calls).toEqual([["Missing exchange rate", { route: confirmTemplate, from: "USD", to: "ZMW", date: dueDate }]]);
      expect(JSON.stringify(calls)).not.toContain(planId);
    });
    it("logs the template for a percent-encoded id, never its encoded form (#254 r3)", async () => {
      const planId = await heldSip();
      const encoded = `%${planId.charCodeAt(0).toString(16)}${planId.slice(1)}`;
      const warn = vi.spyOn(logger, "warn");
      const response = await signed(`/api/investments/recurring/${encoded}/occurrences/${dueDate}/confirm`).send({ operationId: randomUUID(),
        expectedRevision: 0, finalStatement: true, outcome: "filled", fills: [{ ...ONE_FILL[0], executionDate: dueDate }] });
      expect(response.status).toBe(422);
      const calls = warn.mock.calls.filter(([message]) => message === "Missing exchange rate");
      expect(calls).toEqual([["Missing exchange rate", { route: confirmTemplate, from: "USD", to: "ZMW", date: dueDate }]]);
      expect(JSON.stringify(calls)).not.toContain(planId.slice(1));
    });
  });

  describe("P2-2: a foreign SIP fill keeps the holding's known ZMW base", () => {
    it("opens a new holding with the first fill's dated base", async () => {
      await householdRate("26.5");
      const confirmed = await confirmSip(await heldSip()).expect(200);
      const purchaseId: string = confirmed.body.data.occurrence.result.fills[0].purchaseId;
      const [purchase] = await db.select().from(investmentTransactions).where(eq(investmentTransactions.id, purchaseId));
      // 2 @ 2.0000 = USD 4.00 at 26.5 = ZMW 106.00.
      expect(await holding(purchase.holdingId!)).toMatchObject({ quantity: "2.00000000", costBasis: "4.00", costBasisZmw: "106.00", acquisitionFxRate: null });
    });
    it("adds the fill's dated base to a holding whose base is known", async () => {
      await householdRate("25");
      const opened = await signed("/api/investments/holdings").send({ operationId: randomUUID(), expectedCurrency: "USD",
        accountId: ids.sharedAccount, securityId, quantity: "5", costBasis: "10.00", costBasisZmw: "250.00", acquisitionFxRate: "25",
        acquiredDate: "2020-01-01" }).expect(201);
      await confirmSip(await heldSip()).expect(200);
      // 250.00 declared + 4.00 x 25 = 100.00.
      expect(await holding(opened.body.data.id)).toMatchObject({ quantity: "7.00000000", costBasis: "14.00", costBasisZmw: "350.00", acquisitionFxRate: null });
    });
  });

  describe("#254 review: a SIP's aggregate ZMW base must fit its column", () => {
    it("refuses two fills whose dated bases sum past NUMERIC(15,2) with a 400, writing nothing", async () => {
      await householdRate("2");
      // Each fill: 1,500,000,000 @ 2,000.0000 = USD 3,000,000,000,000.00, at rate 2 = ZMW 6,000,000,000,000.00.
      // The native total (6e12) fits; the ZMW total (1.2e13) does not.
      const fill = { executionDate: "", quantity: "1500000000.00000000", price: "2000.0000", fees: "0.00" };
      const planId = await heldSip("USD", "6000000000000.00");
      const refused = await confirmSip(planId, [fill, fill]);
      expect(refused.status).toBe(400);
      expect(refused.body.error).toMatchObject({ code: "VALIDATION_ERROR" });
      expect(await activity()).toEqual([]);
      expect(await db.select().from(holdings).where(eq(holdings.securityId, securityId))).toEqual([]);
    });
  });

  describe("0047: a SIP fill's audit names its rate row, and only a real one in scope is evidence", () => {
    it("records the household rate row on the fill's CREATE audit and accepts it as evidence", async () => {
      const rate = await householdRate("26.5");
      const confirmed = await confirmSip(await heldSip()).expect(200);
      const purchaseId: string = confirmed.body.data.occurrence.result.fills[0].purchaseId;
      expect((await createAudit(purchaseId)).details).toMatchObject({ fxRateBasis: policy,
        fxRateSource: { kind: "household", id: rate.id, date: "2000-01-01" } });
      expect(await evidence(purchaseId)).toMatchObject({ now: true, was: false });
    });

    it("refuses a rate row of another household, or one that does not exist, and still accepts the 0042 audit form", async () => {
      const own = await householdRate("26.5");
      const purchaseId: string = (await confirmSip(await heldSip()).expect(200)).body.data.occurrence.result.fills[0].purchaseId;
      const details = (await createAudit(purchaseId)).details as Record<string, unknown>;
      const [foreign] = await db.insert(householdFxRateOverrides).values({ householdId: b, actorUserId: actors.get("outsider")!.id,
        fromCurrency: "USD", toCurrency: "ZMW", effectiveDate: "2000-01-01", validThrough: "2099-12-31", rate: "26.5" }).returning();
      await rewriteAudit(purchaseId, { ...details, fxRateSource: { kind: "household", id: foreign.id, date: "2000-01-01" } });
      expect((await evidence(purchaseId)).now).toBe(false);
      await rewriteAudit(purchaseId, { ...details, fxRateSource: { kind: "provider", id: own.id, date: "2000-01-01" } });
      expect((await evidence(purchaseId)).now).toBe(false);
      // #254 review: a new foreign fill must name its source. The 0042 form is
      // refused; a fill confirmed before the migration is never judged again
      // (every caller runs only in the fill's own creation transaction).
      const { fxRateSource: _dropped, ...form0042 } = details;
      await rewriteAudit(purchaseId, form0042);
      expect(await evidence(purchaseId)).toMatchObject({ now: false, was: true });
    });

    it("refuses a real, in-scope, equal-rate row that is not the one the converter chose (#254 review)", async () => {
      await useCurrency("XTS");
      const [low, high] = [randomUUID(), randomUUID()].sort();
      await db.insert(fxRates).values([
        { id: high, fromCurrency: "XTS", toCurrency: "ZMW", rate: "3.2500", date: dueDate, source: "synthetic_lane3" },
        { id: low, fromCurrency: "XTS", toCurrency: "ZMW", rate: "3.2500", date: dueDate, source: "synthetic_lane3_b" },
      ]);
      const purchaseId: string = (await confirmSip(await heldSip("XTS")).expect(200)).body.data.occurrence.result.fills[0].purchaseId;
      const details = (await createAudit(purchaseId)).details as Record<string, unknown>;
      expect(details).toMatchObject({ fxRateSource: { kind: "provider", id: low, date: dueDate } });
      expect((await evidence(purchaseId)).now).toBe(true);
      await rewriteAudit(purchaseId, { ...details, fxRateSource: { kind: "provider", id: high, date: dueDate } });
      expect((await evidence(purchaseId)).now).toBe(false);
    });

    it("refuses an older still-valid household rate when a newer one was in force (#254 review)", async () => {
      const older = await householdRate("26.5", { effectiveDate: "2000-01-01" });
      await householdRate("26.5", { effectiveDate: "2010-01-01" });
      const purchaseId: string = (await confirmSip(await heldSip()).expect(200)).body.data.occurrence.result.fills[0].purchaseId;
      const details = (await createAudit(purchaseId)).details as Record<string, unknown>;
      expect(details).toMatchObject({ fxRateSource: { kind: "household", date: "2010-01-01" } });
      await rewriteAudit(purchaseId, { ...details, fxRateSource: { kind: "household", id: older.id, date: "2000-01-01" } });
      expect((await evidence(purchaseId)).now).toBe(false);
    });

    it("refuses a foreign fill carrying a null pair, which 0042 accepted (#254 r2)", async () => {
      await householdRate("26.5");
      const purchaseId: string = (await confirmSip(await heldSip()).expect(200)).body.data.occurrence.result.fills[0].purchaseId;
      const details = (await createAudit(purchaseId)).details as { newValue: Record<string, unknown> };
      const { fxRate: _rate, amountZmw: _zmw, ...nullPairValue } = details.newValue;
      const client = await pool.connect();
      try {
        // Forge the null-pair shape on a USD fill; triggers are bypassed only to build the case.
        await client.query("BEGIN");
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query("update investment_transactions set fx_rate=null, amount_zmw=null where id=$1", [purchaseId]);
        await client.query("update tax_lots set acquisition_fx_rate=null, cost_basis_zmw=null where transaction_id=$1", [purchaseId]);
        await client.query("update audit_logs set details=$2::jsonb where entity_id=$1 and action='CREATE' and entity_type='investment_transaction'",
          [purchaseId, JSON.stringify({ newValue: nullPairValue })]);
        await client.query(evidenceFrom0042());
        const row = (await client.query(`select public.c306_sip_fill_evidence($1::uuid) as now,
          pg_temp.c306_sip_fill_evidence_0042($1::uuid) as was`, [purchaseId])).rows[0];
        expect(row).toEqual({ now: false, was: true });
      } finally {
        await client.query("ROLLBACK");
        client.release(true);
      }
    });

    it("never re-judges a fill whose audit has the 0042 form: its replay and a later sale succeed (#254 r2)", async () => {
      await householdRate("26.5");
      const planId = await heldSip(), operationId = randomUUID();
      const body = { operationId, expectedRevision: 0, finalStatement: true, outcome: "filled",
        fills: [{ executionDate: dueDate, quantity: "2.00000000", price: "2.0000", fees: "0.00" }] };
      const confirm = () => signed(`/api/investments/recurring/${planId}/occurrences/${dueDate}/confirm`).send(body);
      const confirmed = await confirm().expect(200);
      const purchaseId: string = confirmed.body.data.occurrence.result.fills[0].purchaseId;
      const [purchase] = await db.select().from(investmentTransactions).where(eq(investmentTransactions.id, purchaseId));
      // As a fill confirmed before the migration: the 0042 audit form, no fxRateSource.
      const { fxRateSource: _dropped, ...form0042 } = (await createAudit(purchaseId)).details as Record<string, unknown>;
      await rewriteAudit(purchaseId, form0042);
      expect((await evidence(purchaseId)).now).toBe(false);
      expect((await confirm().expect(200)).body.data).toEqual(confirmed.body.data);
      await signed("/api/investments/transactions").send({ accountId: ids.sharedAccount, holdingId: purchase.holdingId, securityId,
        type: "sell", quantity: "1", price: "3.00", amount: "3.00", currency: "USD", transactionDate: dueDate }).expect(201);
      expect((await activity()).map(row => row.type).sort()).toEqual(["buy", "sell"]);
    });

    it("locks the chosen rate row: an in-place change while the fill is posting is a retryable 409, nothing written (#254 r2)", async () => {
      await useCurrency("XTS");
      const rate = await providerRate(dueDate, "3.2500");
      const planId = await heldSip("XTS");
      const holder = await pool.connect();
      try {
        await holder.query("BEGIN");
        await holder.query("select id from fx_rates where id=$1 for update", [rate.id]);
        const response = confirmSip(planId).then(result => result);
        let waiting = false;
        for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
          const rows = (await pool.query(`select 1 from pg_stat_activity where wait_event_type='Lock'
            and query ilike '%fx_rates%' and pid<>pg_backend_pid()`)).rows;
          waiting = rows.length > 0;
          if (!waiting) await new Promise(resolve => setTimeout(resolve, 100));
        }
        expect(waiting, "the confirmation never waited on the chosen rate row's lock").toBe(true);
        await holder.query("update fx_rates set rate='3.3000' where id=$1", [rate.id]);
        await holder.query("COMMIT");
        const refused = await response;
        expect(refused.status).toBe(409);
        expect(refused.body.error).toMatchObject({ code: "CONFLICT" });
        expect(await activity()).toEqual([]);
      } finally {
        await holder.query("ROLLBACK").catch(() => undefined);
        holder.release(true);
      }
    });

    it("keeps a null-pair (ZMW) fill's evidence and digest byte-identical to 0042", async () => {
      await db.update(securities).set({ currency: "ZMW" }).where(eq(securities.id, securityId));
      const created = await signed("/api/investments/recurring").send({ operationId: randomUUID(), accountId: ids.sharedAccount, securityId,
        type: "sip", frequency: "monthly", amount: "4.00", currency: "ZMW", nextExecutionDate: dueDate }).expect(200);
      expect(await processDueInvestments()).toMatchObject({ held: 1 });
      const purchaseId: string = (await confirmSip(created.body.data.id).expect(200)).body.data.occurrence.result.fills[0].purchaseId;
      const row = await evidence(purchaseId);
      expect(row.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(row).toEqual({ now: true, was: true, digest: row.stored, stored: row.digest });
      expect((await createAudit(purchaseId)).details).not.toHaveProperty("fxRateSource");
    });
  });

  describe("an opening's rate is accepted at the dated rate's 8 places", () => {
    const rate8 = "25.12345678";
    it("stores an 8-place opening rate exactly, with base = cost x rate, and replays it", async () => {
      await householdRate(rate8);
      // 10.00 x 25.12345678 = 251.2345678, so the base is 251.23.
      const body = { operationId: randomUUID(), quantity: "5", costBasis: "10.00", costBasisZmw: "251.23", acquisitionFxRate: rate8 };
      const created = await opening(body).expect(201);
      expect(await holding(created.body.data.id)).toMatchObject({ costBasisZmw: "251.23", acquisitionFxRate: rate8 });
      const purchase = (await activity()).find(row => row.holdingId === created.body.data.id)!;
      expect(purchase).toMatchObject({ fxRate: rate8, amountZmw: "251.23" });
      expect((await opening(body).expect(201)).body.data).toEqual(created.body.data);
      expect(await activity()).toHaveLength(1);
    });
    it("refuses the 4-place rounding of an 8-place dated rate", async () => {
      await householdRate(rate8);
      expect((await opening({ quantity: "5", costBasis: "10.00", costBasisZmw: "251.24", acquisitionFxRate: "25.1235" })).status).toBe(400);
      expect(await activity()).toEqual([]);
    });
    it("deletes a zero-share shell that declared an 8-place rate", async () => {
      await householdRate(rate8);
      const shell = await opening({ quantity: "0", costBasis: null, acquisitionFxRate: rate8 }).expect(201);
      expect(await holding(shell.body.data.id)).toMatchObject({ acquisitionFxRate: rate8 });
      await removeHolding(shell.body.data.id).expect(204);
      expect(await holding(shell.body.data.id)).toBeUndefined();
    });
  });

  describe("0047 refuses no existing row: a holding written under the 4-place column", () => {
    it("replays and deletes openings created before the widening", async () => {
      await householdRate("25");
      await pool.query("ALTER TABLE holdings ALTER COLUMN acquisition_fx_rate SET DATA TYPE numeric(10, 4)");
      try {
        // Created under the old shape: the column, its CREATE audit and receipt all say 25.0000.
        const body = { operationId: randomUUID(), quantity: "5", costBasis: "10.00", costBasisZmw: "250.00", acquisitionFxRate: "25" };
        const created = await opening(body).expect(201);
        const shell = await opening({ quantity: "0", costBasis: null, acquisitionFxRate: "25" }).expect(201);
        expect(await holding(created.body.data.id)).toMatchObject({ acquisitionFxRate: "25.0000" });
        await apply0047();
        expect(await holding(shell.body.data.id)).toMatchObject({ acquisitionFxRate: "25.00000000" });
        expect((await opening(body).expect(201)).body.data).toEqual(created.body.data);
        await removeHolding(shell.body.data.id).expect(204);
      } finally { await apply0047(); }
    });
  });
});
