/**
 * Investment Automation Cron — Concurrency / Idempotency Integration Tests (R6)
 *
 * Existing T-Bill caller plus source-only/unrun SIP confirmation adaptation.
 * Real PostgreSQL/service and genuinely signed HTTP are required at execution.
 *
 * (a) T-Bill maturity: concurrent processTBillMaturities() runs against the
 *     same maturing bill move it to awaiting_receipt EXACTLY ONCE, booking the
 *     withholding once and posting no cash (A-36: cash posts on confirmed receipt).
 * (b) Concurrent SIP jobs only materialize one held occurrence with no purchase.
 *     Concurrent signed actual-fill confirmations must have one winner, correct
 *     holding quantity/basis, and an unchanged same-command replay.
 *
 * Historical automatic-execution evidence is preserved at its original pins.
 * This changed SIP caller has not run and establishes no RED/GREEN result.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db, pool } from "../../db";
import {
  households,
  users,
  householdMembers,
  accounts,
  securities,
  holdings,
  recurringInvestments,
  investmentTransactions,
  transactions,
  grzTBills,
  auditLogs,
  taxLotDisposals,
  taxLots,
  investmentPurchaseAuthorizationProofs,
  investmentSipOccurrenceFences,
  investmentSipOccurrences,
  investmentSipConfirmations,
  investmentSipConfirmedFills,
  recurringExecutionLog,
} from "@shared/schema";
import { randomUUID } from "crypto";
import { InvestmentAutomationService } from "../InvestmentAutomationService";
import { hashPassword } from "../../auth";
import { getTestApp } from "../../__tests__/fixtures";

const svc = new InvestmentAutomationService();

// Enough overlapping runs that at least two batch-reads observe the item as
// still-due before any run commits its state transition. On the pre-fix code
// this reliably double-processes; the fix makes all-but-one a provable no-op.
const CONCURRENCY = 10;
const password = "SyntheticR6Concurrency123!";

describe("InvestmentAutomationService concurrency & idempotency (R6)", () => {
  let householdId: string;
  let userId: string;
  let accountId: string;
  let securityId: string | null;
  let calendarOwnerId: string | null;

  const today = () => new Date().toISOString().split("T")[0];

  beforeEach(async () => {
    householdId = randomUUID();
    userId = randomUUID();
    accountId = randomUUID();
    securityId = null;
    calendarOwnerId = null;

    await db.insert(households).values({
      id: householdId,
      name: "R6 Concurrency HH",
      currency: "ZMW",
    });
    await db.insert(users).values({
      id: userId,
      email: `r6-${userId}@example.com`,
      username: `r6-${userId.slice(0, 8)}`,
      passwordHash: await hashPassword(password),
      fullName: "R6 Tester",
      emailVerified: true,
      mfaEnabled: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    await db.insert(householdMembers).values({
      householdId,
      userId,
      role: "admin",
    });
    await db.insert(accounts).values({
      id: accountId,
      householdId,
      name: "R6 Investment Account",
      type: "investment",
      balance: "1000000.00",
      currency: "ZMW",
    });
  });

  afterEach(async () => {
    const actorIds = [userId, ...(calendarOwnerId ? [calendarOwnerId] : [])];
    // FK-safe teardown, scoped to this test's household.
    await db.delete(auditLogs).where(or(eq(auditLogs.householdId, householdId), inArray(auditLogs.userId, actorIds)));
    await db.delete(grzTBills).where(eq(grzTBills.householdId, householdId));
    // recurring_execution_log cascades from recurring_investments
    await db
      .delete(recurringInvestments)
      .where(eq(recurringInvestments.householdId, householdId));
    await db.delete(taxLotDisposals).where(eq(taxLotDisposals.householdId, householdId));
    await db.delete(taxLots).where(eq(taxLots.householdId, householdId));
    await db
      .delete(investmentTransactions)
      .where(eq(investmentTransactions.householdId, householdId));
    await db.delete(holdings).where(eq(holdings.householdId, householdId));
    await db.delete(transactions).where(eq(transactions.householdId, householdId));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db
      .delete(householdMembers)
      .where(eq(householdMembers.householdId, householdId));
    if (securityId) {
      await db.delete(securities).where(eq(securities.id, securityId));
    }
    for (const actorId of actorIds) {
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [actorId]);
    }
    await db.delete(users).where(inArray(users.id, actorIds));
    await db.delete(households).where(eq(households.id, householdId));
  });

  it("(a) processes a maturing T-Bill exactly once under concurrent runs", async () => {
    const billId = randomUUID();
    await db.insert(grzTBills).values({
      id: billId,
      householdId,
      accountId,
      tbillName: "R6 91-Day TBill",
      tenorDays: 91,
      faceValue: "10000.00",
      purchasePrice: "9500.00",
      purchaseDate: "2025-10-01",
      maturityDate: today(),
      status: "active",
    });

    // Warm the connection pool so ALL CONCURRENCY runs get an established
    // connection and their unlocked reads truly overlap. Without this, a cold
    // second connection can let run 1 fully commit (marking the bill matured)
    // before run 2's read even executes, hiding the double-create race behind
    // pool connection-establishment timing (same technique as R5's
    // materialization concurrency test).
    await Promise.all(
      Array.from({ length: CONCURRENCY }, () => db.execute(sql`SELECT 1`)),
    );

    // Overlapping cron runs against the same maturing bill.
    await Promise.all(
      Array.from({ length: CONCURRENCY }, () => svc.processTBillMaturities()),
    );

    // A-36: the run posts nothing; the member's confirmed receipt does.
    expect(await db.select().from(investmentTransactions).where(eq(investmentTransactions.accountId, accountId))).toEqual([]);
    expect(await db.select().from(transactions).where(eq(transactions.accountId, accountId))).toEqual([]);
    const [acct] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    expect(acct.balance).toBe("1000000.00");

    // Interest = face(10000) - purchase(9500) = 500; WHT 15% = 75, booked once:
    // the bill awaits receipt at face less withholding, with one transition audit.
    const [bill] = await db.select().from(grzTBills).where(eq(grzTBills.id, billId));
    expect(bill).toMatchObject({ status: "awaiting_receipt", maturityWithholdingTax: "75.00", maturityNetProceeds: "9925.00" });
    const transitions = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "grz_tbill"),
      eq(auditLogs.entityId, billId), eq(auditLogs.action, "PROCESS")));
    expect(transitions).toHaveLength(1);
  });

  it("(b) materializes once, then records one actual fill under concurrent signed confirmations", async () => {
    securityId = randomUUID();
    await db.insert(securities).values({
      id: securityId,
      symbol: "R6S",
      name: "R6 Test Stock",
      type: "stock",
      currency: "ZMW",
      currentPrice: "100.0000",
    });

    // Pre-existing holding so both concurrent runs take the read-modify-write path.
    const holdingId = randomUUID();
    await db.insert(holdings).values({
      id: holdingId,
      householdId,
      accountId,
      securityId,
      quantity: "10",
      costBasis: "1000.00",
      acquiredDate: "2025-10-01",
    });

    // The recurring mandate originates from this verified user's real password
    // login and signed HTTP create, never an inferred actor or seeded grant.
    const app = await getTestApp();
    const login = await request(app).post("/api/auth/login").send({ email: `r6-${userId}@example.com`, password }).expect(200);
    const cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
    // A real separately signed owner chooses the calendar; the original admin
    // still creates and confirms the plan. No session or proof is fabricated.
    calendarOwnerId = randomUUID();
    const ownerEmail = `r6-owner-${calendarOwnerId}@example.invalid`;
    await db.insert(users).values({ id: calendarOwnerId, email: ownerEmail,
      username: `r6-owner-${calendarOwnerId}`, passwordHash: await hashPassword(password),
      fullName: "Synthetic calendar owner", emailVerified: true, mfaEnabled: false });
    await db.insert(householdMembers).values({ householdId, userId: calendarOwnerId, role: "owner" });
    const ownerLogin = await request(app).post("/api/auth/login").send({ email: ownerEmail, password }).expect(200);
    const ownerCookie = (ownerLogin.headers["set-cookie"] as unknown as string[]).join("; ");
    await request(app).put("/api/investments/calendar").set("Cookie", ownerCookie)
      .set("X-Capital-Subject", calendarOwnerId).set("X-Capital-Household", householdId)
      .send({ timeZone: "UTC" }).expect(200);
    const created = await request(app).post("/api/investments/recurring").set("Cookie", cookie)
      .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId).send({
      operationId: randomUUID(),
      accountId,
      securityId,
      type: "sip",
      frequency: "monthly",
      amount: "1000.00",
      currency: "ZMW",
      nextExecutionDate: today(),
    }).expect(200);
    const planId = created.body.data.id as string;
    expect((await db.select().from(recurringInvestments).where(eq(recurringInvestments.id, planId)))[0])
      .toMatchObject({ householdId, accountId, securityId, amount: "1000.00", currency: "ZMW",
        frequency: "monthly", nextExecutionDate: today(), isActive: true, authorizationRevision: 1,
        currentAuthorizationId: expect.any(String) });

    // Warm the connection pool (same rationale as test (a) above) so the
    // unlocked findDue-equivalent reads in all CONCURRENCY runs truly overlap.
    await Promise.all(
      Array.from({ length: CONCURRENCY }, () => db.execute(sql`SELECT 1`)),
    );

    const originalAccount = (await db.select().from(accounts).where(eq(accounts.id, accountId)))[0];
    // Overlapping jobs cannot turn a reference quote into an actual purchase.
    const materializations = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => svc.processDueInvestments()),
    );
    expect(materializations.every(result => result.success === 0 && result.failed === 0)).toBe(true);
    expect(materializations.reduce((sum, result) => sum + result.held, 0)).toBe(1);
    expect(await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, householdId))).toEqual([]);
    expect(await db.select().from(taxLots).where(eq(taxLots.householdId, householdId))).toEqual([]);
    expect((await db.select().from(holdings).where(eq(holdings.id, holdingId)))[0])
      .toMatchObject({ quantity: "10.00000000", costBasis: "1000.00", acquiredDate: "2025-10-01" });
    expect(await db.select().from(investmentSipOccurrenceFences).where(eq(investmentSipOccurrenceFences.planId, planId)))
      .toMatchObject([{ originalDueDate: today(), terminal: false }]);
    expect(await db.select().from(investmentSipOccurrences).where(eq(investmentSipOccurrences.planId, planId)))
      .toMatchObject([{ originalDueDate: today(), state: "pending", occurrenceRevision: 0 }]);
    expect(await db.select().from(recurringExecutionLog).where(eq(recurringExecutionLog.recurringInvestmentId, planId))).toEqual([]);

    // These are independently declared synthetic actual statement terms. Keep
    // them fixed even if the instrument's valuation quote changes afterward.
    const commands = Array.from({ length: CONCURRENCY }, () => ({
      operationId: randomUUID(), expectedRevision: 0, finalStatement: true, outcome: "filled",
      fills: [{ executionDate: today(), quantity: "10.00000000", price: "100.0000", fees: "0.00" }],
    }));
    await db.update(securities).set({ currentPrice: "200.0000" }).where(eq(securities.id, securityId));
    const confirmationPath = `/api/investments/recurring/${planId}/occurrences/${today()}/confirm`;
    const send = (command: (typeof commands)[number]) => request(app).post(confirmationPath)
      .set("Cookie", cookie).set("X-Capital-Subject", userId).set("X-Capital-Household", householdId).send(command);
    const outcomes = await Promise.all(commands.map(send));
    const winner = outcomes.findIndex(response => response.status === 200);
    expect(winner).toBeGreaterThanOrEqual(0);
    expect(outcomes.filter(response => response.status === 200)).toHaveLength(1);
    expect(outcomes.filter(response => response.status === 409)).toHaveLength(CONCURRENCY - 1);
    for (const response of outcomes.filter(response => response.status === 409)) {
      expect(response.body).toMatchObject({ success: false, error: { code: "CONFLICT", details: { reason: "OCCURRENCE_ALREADY_CLOSED" } } });
    }

    // Exactly ONE buy investment transaction.
    const buyTxs = await db
      .select()
      .from(investmentTransactions)
      .where(
        and(
          eq(investmentTransactions.accountId, accountId),
          eq(investmentTransactions.securityId, securityId),
          eq(investmentTransactions.type, "buy"),
        ),
      );
    expect(buyTxs.length).toBe(1);
    expect(buyTxs[0]).toMatchObject({ quantity: "10.00000000", price: "100.0000", amount: "1000.00", fees: "0.00", currency: "ZMW" });

    // Holding reflects EXACTLY one execution: 10 + (1000/100)=10 -> 20 shares,
    // cost basis 1000 + 1000 -> 2000. (Double execution would double or lose these.)
    const [holding] = await db
      .select()
      .from(holdings)
      .where(eq(holdings.id, holdingId));
    expect(holding).toMatchObject({ quantity: "20.00000000", costBasis: "2000.00", acquiredDate: "2025-10-01" });

    const lots = await db.select().from(taxLots).where(eq(taxLots.transactionId, buyTxs[0].id));
    expect(lots).toMatchObject([{ quantity: "10.00000000", remainingQuantity: "10.00000000", costBasis: "1000.00", acquiredDate: today() }]);
    expect(lots).toHaveLength(1);
    const proofs = await db.select().from(investmentPurchaseAuthorizationProofs)
      .where(eq(investmentPurchaseAuthorizationProofs.purchaseId, buyTxs[0].id));
    expect(proofs).toHaveLength(1);
    expect(proofs[0]).toMatchObject({ authorUserId: userId, authorizationContractVersion: 2,
      authorizedFrequency: "monthly", authorizedInitialDate: today() });
    expect(Object.keys(proofs[0]).sort()).toEqual(["purchaseId", "authorUserId", "authorizedAt", "authorizationContractVersion",
      "authorizedFrequency", "authorizedInitialDate", "authorizedTermsDigest"].sort());
    const receipts = await db.select().from(investmentSipConfirmations).where(eq(investmentSipConfirmations.planId, planId));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ operationId: commands[winner].operationId, actorUserId: userId, outcome: "filled", fillCount: 1 });
    const fills = await db.select().from(investmentSipConfirmedFills).where(eq(investmentSipConfirmedFills.confirmationId, receipts[0].id));
    expect(fills).toMatchObject([{ purchaseId: buyTxs[0].id, fillIndex: 0, postingConfirmed: true }]);
    expect(fills).toHaveLength(1);
    const precision = await pool.query<{ same_instant: boolean }>(`select p.authorized_at=c.authorized_at as same_instant
      from investment_purchase_authorization_proofs p join investment_sip_confirmed_fills f on f.purchase_id=p.purchase_id
      join investment_sip_confirmations c on c.id=f.confirmation_id
      where p.purchase_id=$1 and c.id=$2 and c.household_id=$3 and p.author_user_id=$4 and c.actor_user_id=$4`,
    [buyTxs[0].id, receipts[0].id, householdId, userId]);
    expect(precision.rows).toEqual([{ same_instant: true }]);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.entityId, buyTxs[0].id)))
      .toMatchObject([{ userId, householdId, action: "CREATE", entityType: "investment_transaction" }]);
    expect((await db.select().from(accounts).where(eq(accounts.id, accountId)))[0]).toEqual(originalAccount);
    expect(await db.select().from(transactions).where(eq(transactions.householdId, householdId))).toEqual([]);
    expect(await db.select().from(recurringExecutionLog).where(eq(recurringExecutionLog.recurringInvestmentId, planId))).toEqual([]);

    const replayState = async () => ({
      accounts: await db.select().from(accounts).where(eq(accounts.householdId, householdId)).orderBy(accounts.id),
      cash: await db.select().from(transactions).where(eq(transactions.householdId, householdId)).orderBy(transactions.id),
      logs: await db.select().from(recurringExecutionLog).where(eq(recurringExecutionLog.recurringInvestmentId, planId)).orderBy(recurringExecutionLog.id),
      plans: await db.select().from(recurringInvestments).where(eq(recurringInvestments.id, planId)),
      fences: await db.select().from(investmentSipOccurrenceFences).where(eq(investmentSipOccurrenceFences.planId, planId)),
      occurrences: await db.select().from(investmentSipOccurrences).where(eq(investmentSipOccurrences.planId, planId)),
      fills: await db.select().from(investmentSipConfirmedFills).where(eq(investmentSipConfirmedFills.confirmationId, receipts[0].id)),
      // Ordinary session/login audit work is not a financial replay effect.
      financialAudits: await db.select().from(auditLogs).where(and(
        or(eq(auditLogs.householdId, householdId), inArray(auditLogs.userId, [userId, calendarOwnerId!])),
        inArray(auditLogs.entityType, ["investment_transaction", "investment_sip_confirmation", "recurring_investment", "household_preferences"]),
      )).orderBy(auditLogs.id),
    });
    const beforeReplay = await replayState();
    const replay = await send(commands[winner]).expect(200);
    expect(replay.body).toEqual(outcomes[winner].body);
    expect(await replayState()).toEqual(beforeReplay);
    expect(await db.select().from(holdings).where(eq(holdings.id, holdingId))).toEqual([holding]);
    expect(await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, householdId))).toEqual(buyTxs);
    expect(await db.select().from(taxLots).where(eq(taxLots.transactionId, buyTxs[0].id))).toEqual(lots);
    expect(await db.select().from(investmentPurchaseAuthorizationProofs).where(eq(investmentPurchaseAuthorizationProofs.purchaseId, buyTxs[0].id))).toEqual(proofs);
    expect(await db.select().from(investmentSipConfirmations).where(eq(investmentSipConfirmations.planId, planId))).toEqual(receipts);

    // Plan advanced past today (idempotent state transition).
    const [plan] = await db
      .select()
      .from(recurringInvestments)
      .where(eq(recurringInvestments.id, planId));
    expect(plan.nextExecutionDate).not.toBe(today());
  });
});
