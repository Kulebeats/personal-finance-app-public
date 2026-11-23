import { db } from "../../db";
import { grzTBills } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { businessAuditService } from "../BusinessAuditService";
import { withTransaction } from "../../utils/withTransaction";
import { calendarClock, householdToday } from "../householdCalendarToday";
import { HttpError } from "../../core/errors";
import { tbillMaturityTerms } from "../grz/tbillSettlementTerms";

export interface TBillMaturityResults {
  /** Bills that fell due this run and now await the member's receipt confirmation (A-36). */
  matured: number;
  skipped: number;
  /** Not yet due on its household's calendar date (NEW-22); left active. */
  notDue: number;
  failed: number;
  errors: TBillMaturityFailure[];
}

/** A bill the run could not mature, as its cron caller sees it: never the error text (NEW-23). */
export interface TBillMaturityFailure { billId: string; code: string }
export const TBILL_MATURITY_FAILED = "TBILL_MATURITY_FAILED";

type MaturityOutcome = { status: "due" } | { status: "skipped" } | { status: "not_due" };

/** The latest calendar date any household can be on now: UTC plus one day
 * covers every zone (the furthest ahead is UTC+14). Each bill is then held to
 * its own household's date under the lock. */
function latestHouseholdDate(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString().slice(0, 10);
}

/**
 * Process GRZ T-Bill Maturities (Step 1 of Daily Investment Automation Cycle).
 *
 * A-36: on its household's maturity date a bill stops being active and becomes
 * awaiting_receipt. The run books the withholding once (A-41) and the proceeds
 * as face less that withholding, and posts NO cash, income or investment row:
 * the bill stays in net worth at those proceeds until the member confirms the
 * bank credit (POST /api/grz/tbills/:id/confirm-receipt), which posts the
 * principal and net interest exactly once.
 *
 * R6: each bill is locked FOR UPDATE and re-checked inside the lock, so an
 * overlapping or retried run skips a bill another run already moved.
 */
export async function processTBillMaturities(): Promise<TBillMaturityResults> {
  // NEW-22: a bill matures on its household's calendar date, not the host's or UTC's.
  const latest = latestHouseholdDate(calendarClock.now());
  const results: TBillMaturityResults = { matured: 0, skipped: 0, notDue: 0, failed: 0, errors: [] };

  // Unlocked candidate scan. Re-verified under lock per-bill below.
  const maturingBills = await db.query.grzTBills.findMany({
    where: and(eq(grzTBills.status, "active"), sql`${grzTBills.maturityDate} <= ${latest}`),
  });

  for (const bill of maturingBills) {
    try {
      const outcome = await withTransaction<MaturityOutcome>(async (tx) => {
        const [locked] = await tx.select().from(grzTBills).where(eq(grzTBills.id, bill.id)).for("update").limit(1);
        if (!locked || locked.status !== "active") return { status: "skipped" };
        const today = await householdToday(tx, locked.householdId);
        // Not yet due on this household's calendar: a later run matures it.
        if (locked.maturityDate > today) return { status: "not_due" };

        const { withholding, netProceeds } = tbillMaturityTerms(locked);
        await tx.update(grzTBills).set({
          status: "awaiting_receipt",
          maturedDate: locked.maturityDate,
          maturityWithholdingTax: withholding.toString(),
          maturityNetProceeds: netProceeds.toString(),
          updatedAt: new Date(),
        }).where(eq(grzTBills.id, locked.id));

        // DPA audit (SCP-312): system-initiated cron write, no user actor.
        await businessAuditService.log({
          userId: null,
          householdId: locked.householdId,
          action: "PROCESS",
          entityType: "grz_tbill",
          entityId: locked.id,
          details: {
            actor: "system",
            trigger: "tbill_maturity",
            status: "awaiting_receipt",
            netProceeds: netProceeds.toString(),
            withholdingTax: withholding.toString(),
          },
          tx,
        });
        return { status: "due" };
      });

      if (outcome.status === "due") results.matured++;
      else if (outcome.status === "skipped") results.skipped++;
      else results.notDue++;
    } catch (error) {
      // NEW-23: the caller gets the bill id and a stable code; the detail stays in the server log.
      const code = error instanceof HttpError ? error.code : TBILL_MATURITY_FAILED;
      logger.error(
        "Failed to mature T-Bill",
        { billId: bill.id, householdId: bill.householdId, maturityDate: bill.maturityDate, code },
        error as Error,
      );
      results.failed++;
      results.errors.push({ billId: bill.id, code });
    }
  }
  logger.info("T-Bill maturity run", { candidates: maturingBills.length, matured: results.matured,
    skipped: results.skipped, notDue: results.notDue, failed: results.failed });
  return results;
}
