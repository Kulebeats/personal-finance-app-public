/**
 * GRZ double-write races — REAL HTTP + REAL Postgres.
 *
 * Two GRZ state transitions each booked money to the ledger via a read-then-write
 * TOCTOU with no row lock and no in-lock re-check:
 *
 *  1. PUT /api/grz/bonds/:id/sell — read the bond, check `status === 'sold'`
 *     OUTSIDE the transaction, then write inside it. Two concurrent sells (a
 *     double-clicked button, a retried request) both read status='active', both
 *     pass the guard, and both write — flipping the bond to 'sold' twice and
 *     inserting TWO investment_transactions rows. The same bond's proceeds are
 *     booked twice; the second is phantom income. A sale is not idempotent, so
 *     nothing downstream corrects it.
 *     FIX: lock the bond FOR UPDATE inside the txn and re-check status under it.
 *
 *  2. POST /api/grz/payments/:id/pay — same TOCTOU on the coupon payment row,
 *     but worse: it books a real INCOME transaction to the main ledger, and does
 *     so BEFORE and OUTSIDE the transaction that flips the status. Two concurrent
 *     pays booked the same coupon's net amount twice.
 *     FIX: a deterministic uuidv5 idempotency key derived from the payment id
 *     (transactions.idempotency_key is UNIQUE, so the loser's insert collides and
 *     returns the winner's row) PLUS a FOR UPDATE lock + in-lock status re-check
 *     so the status flip and its audit row happen exactly once.
 *
 * DETERMINISM — why these reproduce every run rather than by timing luck:
 *   - The pool is pre-warmed (10 concurrent SELECT 1) so neither racer pays a
 *     connection-setup cost that would accidentally serialize them.
 *   - The race window is structurally wide, not a narrow instruction gap: between
 *     the pre-flight status read and the write, both handlers await a dynamic
 *     import() and an account lookup. Both requests are therefore always still
 *     inside that window when the other reads, so on unfixed code BOTH always
 *     pass the guard.
 *   - The assertions are on the COMMITTED END STATE (how many ledger rows exist),
 *     never on which request won. That makes them true detectors: the count is
 *     wrong on old code and right on new code, regardless of scheduling. The
 *     assertions are not relaxed to tolerate either outcome.
 *
 * RED evidence: with the fixes reverted, both `expect(...).toHaveLength(1)` ledger
 * assertions fail with 2 — reproduced on every run.
 *
 * tsconfig no longer excludes *.test.ts, but run explicitly:
 *   npx vitest run grz-securities.sell-race
 */
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { randomUUID } from "crypto";
import { eq, inArray, sql } from "drizzle-orm";

import { db, pool } from "../../db";
import { grzCouponPaymentKey } from "../../services/grz/couponPaymentKey";
import { grzBondSaleKey } from "../../services/grz/bondSale";
import {
  grzBonds,
  grzBondPayments,
  investmentTransactions,
  transactions,
  accounts,
  households,
  users,
  householdMembers,
  auditLogs,
} from "@shared/schema";
import {
  createTestUser,
  createTestHousehold,
  getTestApp,
} from "../../__tests__/fixtures";
import { hashPassword } from "../../auth";

describe("GRZ concurrency — real HTTP double-write races", () => {
  let app: Express;
  let authCookie: string;
  let csrfToken: string;
  let householdId: string;
  let accountId: string;

  const authRequest = (req: request.Test) =>
    req.set("Cookie", authCookie).set("X-CSRF-Token", csrfToken);

  beforeAll(async () => {
    app = await getTestApp();

    // Pre-warm the pool so the two racers don't serialize on connection setup.
    await Promise.all(Array.from({ length: 10 }, () => db.execute(sql`SELECT 1`)));

    const timestamp = Date.now();
    const testUser = createTestUser({
      email: `grz-race-${timestamp}@example.com`,
      username: `grz-race-user-${timestamp}`,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "GRZ Race Household",
      currency: "ZMW",
    });
    householdId = testHousehold.id;
    testUser.passwordHash = await hashPassword("TestPassword123");

    await db.insert(households).values({
      id: testHousehold.id,
      name: testHousehold.name,
      currency: testHousehold.currency,
    });
    await db.insert(users).values({
      id: testUser.id,
      email: testUser.email,
      username: testUser.username,
      passwordHash: testUser.passwordHash,
      fullName: testUser.fullName,
      emailVerified: testUser.emailVerified,
      mfaEnabled: testUser.mfaEnabled,
      failedLoginAttempts: testUser.failedLoginAttempts,
      lockedUntil: testUser.lockedUntil,
    });
    await db.insert(householdMembers).values({
      householdId: testHousehold.id,
      userId: testUser.id,
      role: "admin",
    });

    accountId = randomUUID();
    await db.insert(accounts).values({
      id: accountId,
      householdId,
      name: "GRZ Race Account",
      type: "investment",
      balance: "1000000.00",
      currency: "ZMW",
    });

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: testUser.email, password: "TestPassword123" })
      .expect(200);
    authCookie = loginRes.headers["set-cookie"]
      ? (loginRes.headers["set-cookie"] as unknown as string[]).join("; ")
      : "";

    const csrfRes = await request(app)
      .get("/api/csrf-token")
      .set("Cookie", authCookie)
      .expect(200);
    csrfToken = csrfRes.body.csrfToken;
    if (csrfRes.headers["set-cookie"]) {
      authCookie = [authCookie, ...csrfRes.headers["set-cookie"]].join("; ");
    }
  });

  afterAll(async () => {
    try {
      // A settled sale's bond and cash can only be deleted with their household,
      // in one transaction, as account erasure does (migration 0039).
      await db.transaction(async (tx) => {
        await tx.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
        const bonds = tx
          .select({ id: grzBonds.id })
          .from(grzBonds)
          .where(eq(grzBonds.householdId, householdId));
        await tx.delete(grzBondPayments).where(inArray(grzBondPayments.bondId, bonds));
        await tx.delete(grzBonds).where(eq(grzBonds.householdId, householdId));
        await tx
          .delete(investmentTransactions)
          .where(eq(investmentTransactions.householdId, householdId));
        await tx
          .delete(transactions)
          .where(eq(transactions.householdId, householdId));
        await tx.delete(accounts).where(eq(accounts.householdId, householdId));
        await tx
          .delete(householdMembers)
          .where(eq(householdMembers.householdId, householdId));
        await tx.delete(households).where(eq(households.id, householdId));
      });
      await db.delete(users).where(eq(users.email, `grz-race-${householdId}`));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("grz race cleanup error", error);
    }
  });

  async function seedActiveBond() {
    const [bond] = await db
      .insert(grzBonds)
      .values({
        householdId,
        accountId,
        bondName: `GRZ Bond ${randomUUID().slice(0, 6)}`,
        faceValue: "10000.00",
        purchasePrice: "9800.00",
        couponRate: "12.5000",
        purchaseDate: "2026-01-01",
        maturityDate: "2029-01-01",
        tenorYears: 3,
        status: "active",
      })
      .returning();
    return bond;
  }

  it.each([
    ["active", "2025-12-31", "2029-01-01", 400],
    ["active", "2026-02-30", "2029-01-01", 400],
    ["active", "2099-01-01", "2100-01-01", 400],
    ["active", "2026-06-02", "2026-06-01", 400],
    ["matured", "2026-06-01", "2029-01-01", 409],
    ["rolled_over", "2026-06-01", "2029-01-01", 409],
  ] as const)("rejects a %s bond sale dated %s without recording disposal", async (status, soldDate, maturityDate, expected) => {
    const bond = await seedActiveBond();
    await db.update(grzBonds).set({ status, maturityDate }).where(eq(grzBonds.id, bond.id));
    const result = await authRequest(request(app).put(`/api/grz/bonds/${bond.id}/sell`))
      .send({ soldPrice: "9500.00", soldDate, accountId });
    expect(result.status).toBe(expected);
    const [stored] = await db.select().from(grzBonds).where(eq(grzBonds.id, bond.id));
    expect([stored.status, stored.soldDate, stored.soldPrice]).toEqual([status, null, null]);
    const sales = await db.select().from(investmentTransactions)
      .where(eq(investmentTransactions.notes, `GRZ Bond Sale: ${bond.bondName}`));
    expect(sales).toHaveLength(0);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.entityId, bond.id))).toHaveLength(0);
  });

  it("books sale proceeds exactly once when two sells race", async () => {
    const bond = await seedActiveBond();

    const sell = () =>
      authRequest(request(app).put(`/api/grz/bonds/${bond.id}/sell`)).send({
        soldPrice: "9500.00",
        soldDate: "2026-06-01",
        accountId,
      });

    const [a, b] = await Promise.all([sell(), sell()]);

    // Exactly one sell succeeds; the loser is rejected with the same 409
    // "already sold" CONFLICT contract the pre-flight check returns — not a
    // 500, not a silent no-op.
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.success).toBe(false);
    expect(loser.body.error.code).toBe("CONFLICT");
    expect(loser.body.error.message).toBe("Bond is already sold");

    // THE ASSERTION THAT MATTERS: the ledger holds ONE proceeds row. On the old
    // code this is 2 — the same bond's proceeds booked twice.
    const ledgerRows = await db
      .select()
      .from(investmentTransactions)
      .where(eq(investmentTransactions.householdId, householdId));

    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0].amount).toBe("9500.00");
    expect(ledgerRows[0].type).toBe("sell");

    // And the bond is sold exactly once, at the winning price.
    const [finalBond] = await db
      .select()
      .from(grzBonds)
      .where(eq(grzBonds.id, bond.id));
    expect(finalBond.status).toBe("sold");
    expect(finalBond.soldPrice).toBe("9500.00");
    // The sale cash is posted once too, and it is the row the holding points at.
    const saleCash = await db.select().from(transactions).where(eq(transactions.idempotencyKey, grzBondSaleKey(bond.id)));
    expect(saleCash.map(row => [row.id, row.type, row.amount])).toEqual([[finalBond.saleCashTransactionId, "asset_settlement", "9500.00"]]);

    await db
      .delete(investmentTransactions)
      .where(eq(investmentTransactions.householdId, householdId));
  });

  it("books coupon income exactly once when two coupon pays race", async () => {
    const bond = await seedActiveBond();
    const [payment] = await db
      .insert(grzBondPayments)
      .values({
        bondId: bond.id,
        paymentDate: "2026-07-01",
        grossAmount: "625.00",
        withholdingTax: "93.75",
        netAmount: "531.25",
        paymentType: "coupon",
        status: "scheduled",
      })
      .returning();

    const pay = () =>
      authRequest(request(app).post(`/api/grz/payments/${payment.id}/pay`)).send({
        accountId,
        date: "2026-07-01",
      });

    const [a, b] = await Promise.all([pay(), pay()]);

    // One wins; the loser gets the same 409 CONFLICT contract as the
    // pre-flight check.
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.success).toBe(false);
    expect(loser.body.error.code).toBe("CONFLICT");
    expect(loser.body.error.message).toBe("Payment is already marked as paid");

    // THE ASSERTION THAT MATTERS: the net coupon is booked to the ledger ONCE.
    // On the old code this is 2 rows of 531.25 — phantom income. (Scoped to
    // the coupon's key: an earlier sale in this file posts its own cash.)
    const incomeRows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.idempotencyKey, grzCouponPaymentKey(payment.id)));

    expect(incomeRows).toHaveLength(1);
    expect(incomeRows[0].amount).toBe("531.25");
    expect(incomeRows[0].type).toBe("income");

    // The payment is marked paid exactly once and points at that single row.
    const [finalPayment] = await db
      .select()
      .from(grzBondPayments)
      .where(eq(grzBondPayments.id, payment.id));
    expect(finalPayment.status).toBe("paid");
    expect(finalPayment.incomeTransactionId).toBe(incomeRows[0].id);

    // The status transition is audited exactly once — the in-lock guard must
    // stop the loser BEFORE it writes a second PROCESS audit row.
    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, payment.id));
    expect(audits).toHaveLength(1);
  });

  it.each(["sold", "matured", "rolled_over"] as const)("rejects outstanding coupon and principal on a %s bond", async status => {
    const bond = await seedActiveBond();
    const payments = await db.insert(grzBondPayments).values(["coupon", "principal"].map(paymentType => ({
      bondId: bond.id, paymentType, paymentDate: "2026-07-01",
      grossAmount: "100.00", withholdingTax: "0.00", netAmount: "100.00", status: "scheduled" as const,
    }))).returning();
    if (status === "sold") {
      await authRequest(request(app).put(`/api/grz/bonds/${bond.id}/sell`))
        .send({ soldDate: "2026-06-01", soldPrice: "9500.00", accountId }).expect(200);
    } else {
      await db.update(grzBonds).set({ status }).where(eq(grzBonds.id, bond.id));
    }
    const balance = () => db.select({ balance: accounts.balance }).from(accounts).where(eq(accounts.id, accountId));
    const before = await balance();
    for (const payment of payments) {
      await authRequest(request(app).post(`/api/grz/payments/${payment.id}/pay`))
        .send({ date: "2026-07-01", accountId }).expect(409);
      expect(await db.select().from(transactions).where(eq(transactions.idempotencyKey, grzCouponPaymentKey(payment.id)))).toHaveLength(0);
      expect(await db.select().from(auditLogs).where(eq(auditLogs.entityId, payment.id))).toHaveLength(0);
      const [stored] = await db.select().from(grzBondPayments).where(eq(grzBondPayments.id, payment.id));
      expect(stored.incomeTransactionId).toBeNull();
      expect(stored.actualPaymentDate).toBeNull();
    }
    expect(await balance()).toEqual(before);
  });

  it.each([
    ["impossible date", "2026-09-31", "100", "15", "85"],
    ["timestamp", "2026-08-02T23:30:00-02:00", "100", "15", "85"],
    ["explicit null", null, "100", "15", "85"],
    ["before due date", "2026-06-30", "100", "15", "85"],
    ["future receipt", "2099-10-01", "100", "15", "85"],
    ["zero net", "2026-07-01", "100", "100", "0"],
    ["negative tax", "2026-07-01", "100", "-1", "101"],
    ["unreconciled net", "2026-07-01", "100", "15", "87"],
    ["unknown withholding", "2026-07-01", "100", null, "85"],
    ["nonfinite amount", "2026-07-01", "NaN", "15", "85"],
  ] as const)("rejects %s before posting coupon cash", async (_case, date, grossAmount, withholdingTax, netAmount) => {
    const bond = await seedActiveBond();
    const [payment] = await db.insert(grzBondPayments).values({
      bondId: bond.id, paymentDate: "2026-07-01", paymentType: "coupon", status: "scheduled",
      grossAmount, withholdingTax, netAmount,
    }).returning();
    const balance = async () => (await db.select({ value: accounts.balance }).from(accounts).where(eq(accounts.id, accountId)))[0].value;
    const before = await balance();
    await authRequest(request(app).post(`/api/grz/payments/${payment.id}/pay`)).send({ accountId, date }).expect(400);
    expect(await balance()).toBe(before);
    const [stored] = await db.select().from(grzBondPayments).where(eq(grzBondPayments.id, payment.id));
    expect([stored.status, stored.incomeTransactionId, stored.actualPaymentDate]).toEqual(["scheduled", null, null]);
    expect(await db.select().from(transactions).where(eq(transactions.idempotencyKey, grzCouponPaymentKey(payment.id)))).toHaveLength(0);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.entityId, payment.id))).toHaveLength(0);
  });

  it("uses the locked coupon breakdown in both the first posting and its audit", async () => {
    const bond = await seedActiveBond();
    const [payment] = await db.insert(grzBondPayments).values({ bondId: bond.id, paymentType: "coupon", status: "scheduled",
      paymentDate: "2026-07-01", grossAmount: "100", withholdingTax: "15", netAmount: "85" }).returning();
    const writer = await pool.connect();
    let attempt: Promise<number> | undefined;
    try {
      await writer.query("BEGIN");
      const { rows: [backend] } = await writer.query("SELECT pg_backend_pid() AS pid");
      await writer.query("UPDATE grz_bond_payments SET gross_amount=110, withholding_tax=25 WHERE id=$1", [payment.id]);
      attempt = authRequest(request(app).post(`/api/grz/payments/${payment.id}/pay`)).send({ accountId, date: "2026-07-01" })
        .then(result => result.status);
      const deadline = Date.now() + 5000;
      let blocked = false;
      while (Date.now() < deadline && !blocked) {
        const { rows: [lock] } = await pool.query("SELECT EXISTS (SELECT FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting", [backend.pid]);
        blocked = lock.waiting;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 25));
      }
      await writer.query("COMMIT");
      expect(blocked).toBe(true);
      expect(await attempt).toBe(200);
      const [posting] = await db.select().from(transactions).where(eq(transactions.idempotencyKey, grzCouponPaymentKey(payment.id)));
      expect(posting.notes).toContain("Gross: 110.00, WHT: 25.00");
      const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.entityId, payment.id));
      expect(audit.details).toMatchObject({ grossAmount: "110.00", withholdingTax: "25.00", netAmount: "85.00" });
    } finally {
      try { await writer.query("ROLLBACK"); } finally { writer.release(); }
      if (attempt) await Promise.allSettled([attempt]);
    }
  });

  it.each(["changed breakdown", "legacy net only", "missing evidence", "duplicate evidence"] as const)(
    "recovers a stranded posting only with its provable coupon terms (%s)", async scenario => {
    const bond = await seedActiveBond();
    const [payment] = await db.insert(grzBondPayments).values({ bondId: bond.id, paymentType: "coupon", status: "scheduled",
      paymentDate: "2026-07-01", grossAmount: "100", withholdingTax: "15", netAmount: "85" }).returning();
    const pay = () => authRequest(request(app).post(`/api/grz/payments/${payment.id}/pay`)).send({ accountId });
    const hook = "r13_coupon_" + payment.id.replace(/-/g, "");
    await pool.query(`CREATE FUNCTION ${hook}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic finalization failure'; END $$`);
    try {
      await pool.query(`CREATE TRIGGER ${hook} BEFORE UPDATE ON grz_bond_payments FOR EACH ROW WHEN (NEW.id='${payment.id}'::uuid) EXECUTE FUNCTION ${hook}()`);
      await pay().expect(500);
    } finally {
      await pool.query(`DROP FUNCTION ${hook}() CASCADE`);
    }
    const key = grzCouponPaymentKey(payment.id);
    const [posting] = await db.select().from(transactions).where(eq(transactions.idempotencyKey, key));
    const before = await db.select({ balance: accounts.balance }).from(accounts).where(eq(accounts.id, accountId));
    const createAudit = "entity_type='transaction' AND action='CREATE' AND entity_id=$1 AND household_id=$2";
    if (scenario === "duplicate evidence") {
      await pool.query(`INSERT INTO audit_logs(household_id,user_id,entity_type,entity_id,action,details)
        SELECT household_id,user_id,entity_type,entity_id,action,details FROM audit_logs WHERE ${createAudit}`, [posting.id, householdId]);
    } else if (scenario === "missing evidence") {
      await pool.query(`DELETE FROM audit_logs WHERE ${createAudit}`, [posting.id, householdId]);
    } else {
      await db.update(grzBondPayments).set({ grossAmount: "110", withholdingTax: "25" }).where(eq(grzBondPayments.id, payment.id));
      if (scenario === "legacy net only") {
        await pool.query(`UPDATE audit_logs SET details=details-'grzCoupon' WHERE ${createAudit}`, [posting.id, householdId]);
      }
    }
    if (scenario === "legacy net only") {
      await pay().expect(200);
      const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.entityId, payment.id));
      expect(audit.details).toMatchObject({ netAmount: "85.00", breakdownEvidence: "legacy_net_only" });
      expect(audit.details).not.toHaveProperty("grossAmount");
      expect(audit.details).not.toHaveProperty("withholdingTax");
    } else {
      await pay().expect(409);
      expect(await db.select().from(auditLogs).where(eq(auditLogs.entityId, payment.id))).toHaveLength(0);
      if (scenario === "changed breakdown") {
        await db.update(grzBondPayments).set({ grossAmount: "100", withholdingTax: "15" }).where(eq(grzBondPayments.id, payment.id));
        await pay().expect(200);
      }
    }
    expect(await db.select({ balance: accounts.balance }).from(accounts).where(eq(accounts.id, accountId))).toEqual(before);
    expect((await db.select().from(transactions).where(eq(transactions.idempotencyKey, key))).map(row => row.id)).toEqual([posting.id]);
  });

  it.each(["grant", "source account"] as const)("waits for a concurrent %s withdrawal before recording a sale", async change => {
    const bond = await seedActiveBond();
    const editor = await pool.connect();
    let sale: Promise<number> | undefined;
    try {
      await editor.query("BEGIN");
      const { rows: [session] } = await editor.query("SELECT pg_backend_pid() AS pid");
      if (change === "grant") {
        await editor.query("UPDATE household_members SET role='professional' WHERE household_id=$1", [householdId]);
      } else {
        await editor.query("UPDATE accounts SET deleted_at=now() WHERE id=$1", [accountId]);
      }
      sale = authRequest(request(app).put(`/api/grz/bonds/${bond.id}/sell`))
        .send({ soldPrice: "9500.00", soldDate: "2026-06-01", accountId }).then(result => result.status);
      const until = Date.now() + 5_000;
      let waiting = false;
      while (Date.now() < until && !waiting) {
        const { rows: [lock] } = await pool.query("SELECT EXISTS (SELECT FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting", [session.pid]);
        waiting = lock.waiting;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 25));
      }
      await editor.query("COMMIT");
      expect(waiting).toBe(true);
      expect(await sale).toBe(change === "grant" ? 403 : 404);
      const [stored] = await db.select().from(grzBonds).where(eq(grzBonds.id, bond.id));
      expect(stored.status).toBe("active");
      expect(await db.select().from(investmentTransactions).where(eq(investmentTransactions.notes, `GRZ Bond Sale: ${bond.bondName}`))).toHaveLength(0);
      expect(await db.select().from(auditLogs).where(eq(auditLogs.entityId, bond.id))).toHaveLength(0);
    } finally {
      try { await editor.query("ROLLBACK"); } finally { editor.release(); }
      if (sale) await Promise.allSettled([sale]);
      if (change === "grant") {
        await db.update(householdMembers).set({ role: "admin" }).where(eq(householdMembers.householdId, householdId));
      } else {
        await db.update(accounts).set({ deletedAt: null }).where(eq(accounts.id, accountId));
      }
    }
  });

  it("rechecks a bond disposed while the authorized coupon request waits for the bond lock", async () => {
    const bond = await seedActiveBond();
    const [payment] = await db.insert(grzBondPayments).values({ bondId: bond.id, paymentType: "coupon",
      paymentDate: "2026-07-01", grossAmount: "100", withholdingTax: "0", netAmount: "100", status: "scheduled" }).returning();
    const seller = await pool.connect();
    let attempt: Promise<number> | undefined;
    try {
      await seller.query("BEGIN");
      const { rows: [session] } = await seller.query("SELECT pg_backend_pid() AS pid");
      await seller.query("UPDATE grz_bonds SET status='sold',sold_date='2026-06-01' WHERE id=$1", [bond.id]);
      attempt = authRequest(request(app).post(`/api/grz/payments/${payment.id}/pay`))
        .send({ accountId, date: "2026-07-01" }).then(result => result.status);
      const until = Date.now() + 5_000;
      let blocked = false;
      while (Date.now() < until && !blocked) {
        const { rows: [lock] } = await pool.query("SELECT EXISTS (SELECT FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting", [session.pid]);
        blocked = lock.waiting;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 25));
      }
      // Settlement holds the bond first and must still be able to lock its installment.
      await seller.query("SELECT id FROM grz_bond_payments WHERE id=$1 FOR UPDATE NOWAIT", [payment.id]);
      await seller.query("COMMIT");
      expect(blocked).toBe(true);
      expect(await attempt).toBe(409);
      expect(await db.select().from(transactions).where(eq(transactions.idempotencyKey, grzCouponPaymentKey(payment.id)))).toHaveLength(0);
    } finally {
      try { await seller.query("ROLLBACK"); } finally { seller.release(); }
      if (attempt) await Promise.allSettled([attempt]);
    }
  });
});
