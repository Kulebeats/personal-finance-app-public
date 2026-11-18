import { db } from "../../db";
import { grzTBills, investmentTransactions } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { Money } from "../../core/money";
import { logger } from "../../utils/logger";
import { businessAuditService } from "../BusinessAuditService";
import { transactionRepository } from "../../repositories/TransactionRepository";
import { withTransaction } from "../../utils/withTransaction";
import { isPostgresError } from "../../utils/postgresError";
import { tbillMaturityIncomeKey } from "./investmentCronKeys";

/** Withholding tax on T-Bill maturity interest (GRZ sovereign debt, 15%). */
const TBILL_WITHHOLDING_TAX_RATE = "0.15";

export interface TBillMaturityResults {
  matured: number;
  skipped: number;
  failed: number;
  errors: string[];
}

type MaturityOutcome = { status: "matured" } | { status: "skipped" };

/**
 * Process GRZ T-Bill Maturities (Step 1 of Daily Investment Automation Cycle).
 *
 * R6 fix: the audit found this path had NO row lock and NO conditional
 * status re-check, so overlapping/retried cron runs could each independently
 * read the bill as "active" and mature it, double-paying the maturity
 * interest and double-crediting the account. Every bill is now processed
 * inside a transaction that:
 *   1. locks the bill row FOR UPDATE (Rule 10) so overlapping/retried runs
 *      serialize on it — the initial `maturingBills` scan below is UNLOCKED,
 *   2. re-checks the bill is STILL active/maturing INSIDE the lock (a
 *      concurrent run may have already matured it since that unlocked scan),
 *   3. creates the interest income ledger transaction via
 *      transactionRepository.createWithinTransaction, which locks + credits
 *      the account balance and writes the Rule-9 audit row atomically, using
 *      a deterministic idempotency key as a defense-in-depth backstop against
 *      a UNIQUE(idempotency_key) collision (never a 500, never a
 *      double-payout),
 *   4. marks the bill matured and writes the existing grz_tbill PROCESS audit
 *      row, all in the same transaction.
 */
export async function processTBillMaturities(): Promise<TBillMaturityResults> {
  const today = new Date().toISOString().split("T")[0];
  const results: TBillMaturityResults = {
    matured: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // Unlocked candidate scan. Re-verified under lock per-bill below.
  const maturingBills = await db.query.grzTBills.findMany({
    where: and(
      eq(grzTBills.status, "active"),
      sql`${grzTBills.maturityDate} <= ${today}`,
    ),
  });

  for (const bill of maturingBills) {
    try {
      const outcome = await withTransaction<MaturityOutcome>(async (tx) => {
        // Rule 10: lock the bill row, then re-check it is STILL maturing now
        // that we hold the lock. A concurrent/retried run may have already
        // matured this bill since the unlocked scan above.
        const [locked] = await tx
          .select()
          .from(grzTBills)
          .where(eq(grzTBills.id, bill.id))
          .for("update")
          .limit(1);

        if (!locked || locked.status !== "active" || locked.maturityDate > today) {
          return { status: "skipped" };
        }

        if (!locked.accountId) {
          throw new Error("T-Bill missing accountId");
        }

        // Use Money class throughout to maintain precision (FIX: DATA-MONEY-CROSS-001)
        const faceValueMoney = new Money(locked.faceValue);
        const purchasePriceMoney = new Money(locked.purchasePrice);
        const interestMoney = faceValueMoney.subtract(purchasePriceMoney);
        const adjustedInterestMoney = interestMoney.isNegative()
          ? Money.zero()
          : interestMoney;
        const withholdingTaxMoney = adjustedInterestMoney.multiply(
          TBILL_WITHHOLDING_TAX_RATE,
        );
        const netInterestMoney = adjustedInterestMoney.subtract(
          withholdingTaxMoney,
        );
        const netProceedsMoney = faceValueMoney.subtract(withholdingTaxMoney);
        const adjustedNetProceedsMoney = netProceedsMoney.isNegative()
          ? Money.zero()
          : netProceedsMoney;
        const maturityDate = locked.maturityDate || today;

        const [maturityTx] = await tx
          .insert(investmentTransactions)
          .values({
            householdId: locked.householdId,
            accountId: locked.accountId,
            type: "maturity",
            quantity: "1",
            price: faceValueMoney.toString(),
            amount: adjustedNetProceedsMoney.toString(),
            currency: "ZMW",
            withholdingTax: withholdingTaxMoney.toString(),
            transactionDate: maturityDate,
            notes: `Maturity Payout: ${locked.tbillName} (${
              locked.isin || "No ISIN"
            })`,
          })
          .returning();

        let incomeTransactionId: string | null = null;
        if (netInterestMoney.isPositive()) {
          const idempotencyKey = tbillMaturityIncomeKey(locked.id);
          const { transaction: incomeTx } =
            await transactionRepository.createWithinTransaction(
              tx,
              {
                householdId: locked.householdId,
                accountId: locked.accountId,
                date: maturityDate,
                name: `T-Bill Interest: ${locked.tbillName}`,
                amount: netInterestMoney.toString(),
                currency: "ZMW",
                type: "income",
                notes: `T-Bill maturity interest. Face: ${faceValueMoney.toString()}, Purchase: ${purchasePriceMoney.toString()}, WHT: ${withholdingTaxMoney.toString()}`,
                source: "recurring",
                // Deterministic per bill: a UNIQUE(idempotency_key) collision
                // from a concurrent/retried run is caught below as an
                // idempotent skip, never a double-payout.
                idempotencyKey,
              },
              {
                // Rule 9: the maturity interest ledger write MUST be audited,
                // atomic with the write. userId null = system/cron-initiated.
                audit: {
                  userId: null,
                  householdId: locked.householdId,
                  metadata: {
                    reason: "tbill_maturity_interest",
                    tbillId: locked.id,
                    idempotencyKey,
                  },
                },
              },
            );

          incomeTransactionId = incomeTx.id;
        }

        await tx
          .update(grzTBills)
          .set({
            status: "matured",
            maturedDate: maturityDate,
            maturityInvestmentTxId: maturityTx.id,
            maturityIncomeTxId: incomeTransactionId,
            updatedAt: new Date(),
          })
          .where(eq(grzTBills.id, locked.id));

        // DPA audit (SCP-312): system-initiated cron write, no user actor.
        // Distinct from the "transaction" entity audit above — this documents
        // the bill's own state transition.
        await businessAuditService.log({
          userId: null,
          householdId: locked.householdId,
          action: "PROCESS",
          entityType: "grz_tbill",
          entityId: locked.id,
          details: {
            actor: "system",
            trigger: "tbill_maturity",
            tbillName: locked.tbillName,
            netProceeds: adjustedNetProceedsMoney.toString(),
            withholdingTax: withholdingTaxMoney.toString(),
            maturityInvestmentTxId: maturityTx.id,
            maturityIncomeTxId: incomeTransactionId,
          },
          tx,
        });

        return { status: "matured" };
      }).catch((error: unknown) => {
        // Idempotency backstop: a UNIQUE violation on
        // transactions.idempotency_key means another run/instance already
        // created the maturity interest income transaction for this bill.
        // The transaction rolled back, so treat it as an idempotent skip —
        // never a 500, never a double-payout.
        if (isPostgresError(error, "23505")) {
          return { status: "skipped" as const };
        }
        throw error;
      });

      if (outcome.status === "matured") {
        results.matured++;
      } else {
        results.skipped++;
      }
    } catch (error) {
      logger.error(
        "Failed to mature T-Bill",
        { billId: bill.id },
        error as Error,
      );
      results.failed++;
      results.errors.push(`Bill ${bill.id}: ${String(error)}`);
    }
  }
  return results;
}
