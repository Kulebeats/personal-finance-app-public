/**
 * Investment Automation Cron — Concurrency / Idempotency Integration Tests (R6)
 *
 * Proves that overlapping/retried cron runs of the investment automation cycle do
 * NOT double-process financial events. Real Postgres, real service, genuinely
 * concurrent invocations (Promise.all).
 *
 * (a) T-Bill maturity: two concurrent processTBillMaturities() runs against the
 *     same maturing bill must produce EXACTLY ONE maturity payout + ONE interest
 *     income transaction + ONE account credit.
 * (b) SIP execution: two concurrent processDueInvestments() runs against the same
 *     due plan must produce EXACTLY ONE buy and a correct (not lost-updated)
 *     holding quantity / cost basis.
 *
 * On the pre-fix code both assertions fail (doubled), which is the RED evidence.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
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
} from "@shared/schema";
import { randomUUID } from "crypto";
import { InvestmentAutomationService } from "../InvestmentAutomationService";

const svc = new InvestmentAutomationService();

// Enough overlapping runs that at least two batch-reads observe the item as
// still-due before any run commits its state transition. On the pre-fix code
// this reliably double-processes; the fix makes all-but-one a provable no-op.
const CONCURRENCY = 10;

describe("InvestmentAutomationService concurrency & idempotency (R6)", () => {
  let householdId: string;
  let userId: string;
  let accountId: string;
  let securityId: string | null;

  const today = () => new Date().toISOString().split("T")[0];

  beforeEach(async () => {
    householdId = randomUUID();
    userId = randomUUID();
    accountId = randomUUID();
    securityId = null;

    await db.insert(households).values({
      id: householdId,
      name: "R6 Concurrency HH",
      currency: "ZMW",
    });
    await db.insert(users).values({
      id: userId,
      email: `r6-${userId}@example.com`,
      username: `r6-${userId.slice(0, 8)}`,
      passwordHash: "$2b$10$mockedHashForTesting",
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
    // FK-safe teardown, scoped to this test's household.
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(grzTBills).where(eq(grzTBills.householdId, householdId));
    // recurring_execution_log cascades from recurring_investments
    await db
      .delete(recurringInvestments)
      .where(eq(recurringInvestments.householdId, householdId));
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
    await db.delete(users).where(eq(users.id, userId));
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

    // Exactly ONE maturity payout investment transaction.
    const maturityTxs = await db
      .select()
      .from(investmentTransactions)
      .where(
        and(
          eq(investmentTransactions.accountId, accountId),
          eq(investmentTransactions.type, "maturity"),
        ),
      );
    expect(maturityTxs.length).toBe(1);

    // Exactly ONE interest income ledger transaction.
    const incomeTxs = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, accountId),
          eq(transactions.type, "income"),
        ),
      );
    expect(incomeTxs.length).toBe(1);

    // Interest = face(10000) - purchase(9500) = 500; WHT 15% = 75; net = 425.
    // Account is credited the net interest EXACTLY once: 1_000_000 + 425.
    const [acct] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, accountId));
    expect(Number(acct.balance)).toBe(1000425);

    // Bill marked matured.
    const [bill] = await db
      .select()
      .from(grzTBills)
      .where(eq(grzTBills.id, billId));
    expect(bill.status).toBe("matured");
  });

  it("(b) executes a due SIP plan exactly once under concurrent runs (no lost holding update)", async () => {
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

    const planId = randomUUID();
    await db.insert(recurringInvestments).values({
      id: planId,
      householdId,
      accountId,
      securityId,
      type: "sip",
      frequency: "monthly",
      amount: "1000.00",
      currency: "ZMW",
      nextExecutionDate: today(),
      isActive: true,
    });

    // Warm the connection pool (same rationale as test (a) above) so the
    // unlocked findDue-equivalent reads in all CONCURRENCY runs truly overlap.
    await Promise.all(
      Array.from({ length: CONCURRENCY }, () => db.execute(sql`SELECT 1`)),
    );

    // Overlapping cron runs against the same due plan.
    await Promise.all(
      Array.from({ length: CONCURRENCY }, () => svc.processDueInvestments()),
    );

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

    // Holding reflects EXACTLY one execution: 10 + (1000/100)=10 -> 20 shares,
    // cost basis 1000 + 1000 -> 2000. (Double execution would double or lose these.)
    const [holding] = await db
      .select()
      .from(holdings)
      .where(eq(holdings.id, holdingId));
    expect(Number(holding.quantity)).toBe(20);
    expect(Number(holding.costBasis)).toBe(2000);

    // Plan advanced past today (idempotent state transition).
    const [plan] = await db
      .select()
      .from(recurringInvestments)
      .where(eq(recurringInvestments.id, planId));
    expect(plan.nextExecutionDate).not.toBe(today());
  });
});
