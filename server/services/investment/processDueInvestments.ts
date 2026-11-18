import { db } from "../../db";
import {
  recurringInvestments,
  recurringExecutionLog,
  securities,
  holdings,
  investmentTransactions,
  grzTBills,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { Money } from "../../core/money";
import { logger } from "../../utils/logger";
import { businessAuditService } from "../BusinessAuditService";
import { withTransaction } from "../../utils/withTransaction";
import { getLatestTbillYield } from "./tbillYield";
import { sipExecutionKey } from "./investmentCronKeys";

export interface SipExecutionResults {
  success: number;
  skipped: number;
  failed: number;
  errors: string[];
}

type ExecutionOutcome = { status: "success" } | { status: "skipped" };

/** Find recurring investment plans due today (unlocked candidate scan). */
export async function getDuePlans() {
  const today = new Date().toISOString().split("T")[0];
  return await db
    .select()
    .from(recurringInvestments)
    .where(
      and(
        eq(recurringInvestments.isActive, true),
        eq(recurringInvestments.nextExecutionDate, today),
      ),
    );
}

export function calculateNextDate(currentDate: Date, frequency: string): Date {
  const date = new Date(currentDate);
  switch (frequency) {
    case "daily":
      date.setDate(date.getDate() + 1);
      break;
    case "weekly":
      date.setDate(date.getDate() + 7);
      break;
    case "biweekly":
      date.setDate(date.getDate() + 14);
      break;
    case "monthly":
      date.setMonth(date.getMonth() + 1);
      break;
    case "quarterly":
      date.setMonth(date.getMonth() + 3);
      break;
    case "semi_annually":
      date.setMonth(date.getMonth() + 6);
      break;
    case "annually":
      date.setFullYear(date.getFullYear() + 1);
      break;
    case "yearly":
      date.setFullYear(date.getFullYear() + 1);
      break;
  }
  return date;
}

/**
 * Process all due recurring investment plans (SIP buys + T-Bill rollovers).
 *
 * R6 fix: the audit found this path had NO row lock and did a read-then-write
 * on `holdings` with no lock, so overlapping/retried cron runs could each
 * independently read a plan as "due", double-execute the buy, and lose
 * updates to the holding's quantity/cost-basis. Every plan is now processed
 * inside a transaction that:
 *   1. locks the plan row FOR UPDATE (Rule 10) so overlapping/retried runs
 *      serialize on it — the initial `getDuePlans` scan below is UNLOCKED,
 *   2. re-checks the plan is STILL due INSIDE the lock (a concurrent run may
 *      have already executed and advanced it since that unlocked scan) — a
 *      provable no-op ("skipped") if not,
 *   3. locks the existing `holdings` row (if any) FOR UPDATE before the
 *      read-modify-write, so quantity/cost-basis updates can never be lost
 *      (mirrors the existing overdraft-lock pattern in
 *      investments.service.ts's sell path),
 *   4. advances nextExecutionDate and logs the execution, all in the same
 *      transaction.
 *
 * Unlike the T-Bill maturity leg, a SIP/rollover buy never writes to the
 * `transactions` ledger (no cash is debited by this cron — consistent with
 * the manual buy/sell flow elsewhere, which also never touches
 * `transactions`), so there is no unique DB column to hang a `23505`-backed
 * idempotency key off. The deterministic key from sipExecutionKey() is
 * embedded in the created investment-transaction's notes for traceability;
 * the actual exactly-once guarantee comes from the row locks above.
 */
export async function processDueInvestments(): Promise<SipExecutionResults> {
  const today = new Date().toISOString().split("T")[0];
  const duePlans = await getDuePlans();
  const results: SipExecutionResults = {
    success: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (const plan of duePlans) {
    try {
      const outcome = await withTransaction<ExecutionOutcome>(async (tx) => {
        // Rule 10: lock the plan row, then re-check it is STILL due now that
        // we hold the lock. A concurrent/retried run may have already
        // executed and advanced this plan since the unlocked scan above.
        const [locked] = await tx
          .select()
          .from(recurringInvestments)
          .where(eq(recurringInvestments.id, plan.id))
          .for("update")
          .limit(1);

        if (!locked || !locked.isActive || locked.nextExecutionDate !== today) {
          return { status: "skipped" };
        }

        // 1. Validation
        if (!locked.securityId) {
          throw new Error("Plan has no associated security");
        }

        const security = await tx.query.securities.findFirst({
          where: eq(securities.id, locked.securityId),
        });

        if (!security) {
          throw new Error(`Security not found for ID: ${locked.securityId}`);
        }

        // Keep amount as Money throughout (FIX: DATA-MONEY-CROSS-001)
        const amountMoney = new Money(locked.amount);
        const idempotencyKey = sipExecutionKey(locked.id, today);

        let resultEntityId: string | undefined;
        let invTx: typeof investmentTransactions.$inferSelect | undefined;

        // BRANCH: Check if T-Bill or Standard Security
        if (security.type === "tbill") {
          // --- T-BILL ROLLOVER LOGIC ---
          // We are buying a NEW T-Bill based on the generic security definition
          // e.g. Security Name is "91-Day T-Bill".

          // Extract Tenor from Name (simple heuristic)
          let tenor = 91; // default
          if (security.name.includes("182")) tenor = 182;
          if (security.name.includes("273")) tenor = 273;
          if (security.name.includes("364")) tenor = 364;

          // Logic: Amount is the PURCHASE PRICE (Investment Amount). We need
          // to estimate Face Value from the latest auction yield.
          // FV = P * (1 + (i * n/36500))
          const purchasePriceMoney = amountMoney;
          const fallbackYield = 15.0;
          const liveYield = await getLatestTbillYield(tenor);
          if (liveYield === null) {
            logger.warn("T-Bill yield fallback used", {
              tenorDays: tenor,
              fallbackYield,
            });
          }
          const rate = liveYield ?? fallbackYield;
          const multiplier = String(1 + (rate * tenor) / 36500);
          const faceValueMoney = purchasePriceMoney.multiply(multiplier);
          const discountAmountMoney =
            faceValueMoney.subtract(purchasePriceMoney);

          const [newTBill] = await tx
            .insert(grzTBills)
            .values({
              householdId: locked.householdId,
              accountId: locked.accountId,
              tbillName: `Auto-Rollover: ${security.name}`,
              tenorDays: tenor,
              purchasePrice: purchasePriceMoney.toString(),
              faceValue: faceValueMoney.toString(),
              purchaseDate: new Date().toISOString().split("T")[0],
              maturityDate: new Date(Date.now() + tenor * 24 * 60 * 60 * 1000)
                .toISOString()
                .split("T")[0],
              purchaseYield: rate.toString(),
              discountAmount: discountAmountMoney.toString(),
              status: "active", // Active immediately for simplicity
            })
            .returning();

          // Create Debit Transaction (Buy)
          [invTx] = await tx
            .insert(investmentTransactions)
            .values({
              householdId: locked.householdId,
              accountId: locked.accountId,
              type: "buy",
              quantity: "1",
              price: purchasePriceMoney.toString(),
              amount: purchasePriceMoney.toString(),
              currency: "ZMW",
              transactionDate: new Date().toISOString().split("T")[0],
              notes: `Auto-Rollover Execution: ${newTBill.tbillName} [idem:${idempotencyKey}]`,
            })
            .returning();

          resultEntityId = newTBill.id;

          // DPA audit (SCP-312): system-initiated rollover, no user actor.
          await businessAuditService.logCreate({
            userId: null,
            householdId: locked.householdId,
            entityType: "grz_tbill",
            entityId: newTBill.id,
            newValue: {
              tbillName: newTBill.tbillName,
              purchasePrice: purchasePriceMoney.toString(),
              faceValue: faceValueMoney.toString(),
              tenorDays: tenor,
              purchaseYield: rate.toString(),
            },
            metadata: {
              actor: "system",
              trigger: "tbill_rollover",
              recurringInvestmentId: locked.id,
              idempotencyKey,
            },
            tx,
          });
        } else {
          // --- STANDARD STOCK/FUND SIP LOGIC ---
          if (!security.currentPrice) {
            throw new Error(`Price unavailable for ${security.symbol}`);
          }
          const priceMoney = new Money(security.currentPrice);
          if (!priceMoney.isPositive()) {
            throw new Error("Security price must be positive");
          }

          // quantity = amount / price - share count, so toNumber is acceptable
          const quantityMoney = amountMoney.divide(priceMoney.toFullString());
          const quantity = quantityMoney.toNumber();

          [invTx] = await tx
            .insert(investmentTransactions)
            .values({
              householdId: locked.householdId,
              accountId: locked.accountId,
              securityId: locked.securityId,
              type: "buy",
              quantity: quantity.toString(),
              price: priceMoney.toString(),
              amount: amountMoney.toString(),
              currency: locked.currency,
              transactionDate: new Date().toISOString().split("T")[0],
              notes: `Recurring Investment Execution (Plan ID: ${locked.id}) [idem:${idempotencyKey}]`,
            })
            .returning();

          // Rule 10: lock the existing holding (if any) FOR UPDATE before the
          // read-modify-write so quantity/cost-basis updates can never be lost
          // to a concurrent execution of a DIFFERENT plan targeting the same
          // account+security.
          const [existingHolding] = await tx
            .select()
            .from(holdings)
            .where(
              and(
                eq(holdings.accountId, locked.accountId),
                eq(holdings.securityId, locked.securityId),
              ),
            )
            .for("update")
            .limit(1);

          if (existingHolding) {
            const currentQtyMoney = new Money(existingHolding.quantity);
            const newQtyMoney = currentQtyMoney.add(quantityMoney);
            const currentCostMoney = new Money(
              existingHolding.costBasis || "0",
            );
            const newCostMoney = currentCostMoney.add(amountMoney);
            await tx
              .update(holdings)
              .set({
                // Full precision (up to 8dp): quantity is a share count, not
                // a 2dp currency amount, so Money.toString() would truncate.
                quantity: newQtyMoney.toFullString(),
                costBasis: newCostMoney.toString(),
                updatedAt: new Date(),
              })
              .where(eq(holdings.id, existingHolding.id));

            await tx
              .update(investmentTransactions)
              .set({ holdingId: existingHolding.id })
              .where(eq(investmentTransactions.id, invTx.id));
          } else {
            const [newHolding] = await tx
              .insert(holdings)
              .values({
                householdId: locked.householdId,
                accountId: locked.accountId,
                securityId: locked.securityId,
                quantity: quantity.toString(),
                costBasis: amountMoney.toString(),
                acquiredDate: new Date().toISOString().split("T")[0],
              })
              .returning();

            await tx
              .update(investmentTransactions)
              .set({ holdingId: newHolding.id })
              .where(eq(investmentTransactions.id, invTx.id));
          }
          resultEntityId = invTx.id;
        }

        // COMMON: Update Plan Next Date
        const nextDate = calculateNextDate(
          new Date(locked.nextExecutionDate),
          locked.frequency,
        );

        await tx
          .update(recurringInvestments)
          .set({
            nextExecutionDate: nextDate.toISOString().split("T")[0],
            updatedAt: new Date(),
          })
          .where(eq(recurringInvestments.id, locked.id));

        // Log Success
        await tx.insert(recurringExecutionLog).values({
          recurringInvestmentId: locked.id,
          status: "success",
          amount: locked.amount,
          resultEntityId: resultEntityId,
          executionDate: new Date(),
        });

        return { status: "success" };
      });

      if (outcome.status === "success") {
        results.success++;
      } else {
        results.skipped++;
      }
    } catch (error) {
      logger.error(
        "Recurring Plan failed",
        { planId: plan.id },
        error as Error,
      );
      results.failed++;
      results.errors.push(`Plan ${plan.id}: ${String(error)}`);

      await db.insert(recurringExecutionLog).values({
        recurringInvestmentId: plan.id,
        status: "failed",
        amount: plan.amount,
        errorMessage: String(error),
        executionDate: new Date(),
      });
    }
  }

  return results;
}
