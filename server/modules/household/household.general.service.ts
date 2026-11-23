/**
 * Household general settings writer (SET-05).
 *
 * Name, base currency and fiscal-year start change under the household row
 * lock, with the caller's role re-checked and the audit row written inside the
 * same transaction. The base currency is refused once the household has any
 * transaction: every stored amount, budget and report is denominated in it.
 *
 * @module modules/household/household.general.service
 */

import { and, eq } from "drizzle-orm";
import { householdMembers, households, transactions, type Household } from "@shared/schema";
import { ForbiddenError, HttpError, NotFoundError } from "../../core/errors";
import { businessAuditService } from "../../services/BusinessAuditService";
import { withTransaction } from "../../utils/withTransaction";

// A type alias, not an interface, so it is assignable to the audit's
// Record<string, unknown> newValue.
export type HouseholdGeneralPatch = {
  name?: string;
  currency?: string;
  fiscalYearStartMonth?: number;
};

const GENERAL_WRITER_ROLES = new Set(["owner", "admin"]);

/** 409: the base currency cannot change once the ledger has a transaction. */
export class LedgerNotEmptyError extends HttpError {
  readonly statusCode = 409;
  readonly code = "LEDGER_NOT_EMPTY";

  constructor() {
    super(
      "The household currency can't be changed after transactions have been recorded, " +
      "because every amount, budget and report is stored in it. " +
      "Keep the current currency, or record foreign-currency accounts in their own currency instead.",
    );
  }
}

export async function updateHouseholdGeneral(
  householdId: string,
  userId: string,
  patch: HouseholdGeneralPatch,
  ipAddress?: string,
): Promise<Household> {
  return withTransaction(async (tx) => {
    // A transaction insert takes FOR KEY SHARE on this row through the
    // transactions.household_id foreign key, so a concurrent first transaction
    // either commits before the ledger check below sees it, or waits for this
    // change to commit.
    const [current] = await tx.select().from(households)
      .where(eq(households.id, householdId))
      .for("update");
    if (!current) throw new NotFoundError("No household found");

    const [membership] = await tx.select({ role: householdMembers.role }).from(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)))
      .for("update");
    if (!membership || !GENERAL_WRITER_ROLES.has(membership.role)) {
      throw new ForbiddenError("Only owners and admins can change household settings");
    }

    if (patch.currency !== undefined && patch.currency !== current.currency) {
      const [recorded] = await tx.select({ id: transactions.id }).from(transactions)
        .where(eq(transactions.householdId, householdId))
        .limit(1);
      if (recorded) throw new LedgerNotEmptyError();
    }

    const [updated] = await tx.update(households).set({
      name: patch.name,
      currency: patch.currency,
      fiscalYearStartMonth: patch.fiscalYearStartMonth,
      updatedAt: new Date(),
    })
      .where(eq(households.id, householdId))
      .returning();

    // AUDIT-006: log settings updates in the same transaction (Rule 9).
    await businessAuditService.logUpdate({
      tx,
      householdId,
      userId,
      entityType: "household_preferences",
      entityId: householdId,
      oldValue: {
        name: current.name,
        currency: current.currency,
        fiscalYearStartMonth: current.fiscalYearStartMonth,
      },
      newValue: patch,
      ipAddress,
      metadata: { action: "settings_update" },
    });
    return updated;
  });
}
