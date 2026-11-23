import { and, eq } from "drizzle-orm";
import { householdMembers, households, type RecurringTransaction } from "@shared/schema";
import { db } from "../../db";
import { can } from "../../core/authz/capabilities";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { ConflictError, ForbiddenError, NotFoundError } from "../../utils/errorHandler";
import { isPostgresError } from "../../utils/postgresError";
import { withTransaction, type TransactionRunner, type TransactionType } from "../../utils/withTransaction";
import { lockRecurringAudienceWithReferences, type RecurringAudienceLockOptions } from "./RecurringLifecycleAudience";
import type { LockedRecurringAudience } from "./RecurringAudienceReferences";

type Subject = Pick<HouseholdContext, "householdId" | "userId"> & Partial<Pick<HouseholdContext, "role">>;

/**
 * Take the household row before any member row, the order accept-invite and
 * ownership transfer use. The audience lock and an in-transaction audit insert
 * (whose household FK takes KEY SHARE) then never wait on the household while
 * holding a member lock those transactions need (audit FK lock order, FIN-13).
 * FOR SHARE is the mode the audience lock takes later, so nothing is upgraded.
 */
export async function lockHouseholdBeforeMembers(tx: TransactionType, householdId: string): Promise<void> {
  await tx.select({ id: households.id }).from(households).where(eq(households.id, householdId)).for("share");
}

export async function withWritableRecurringRule<T>(
  id: string, actor: Subject,
  write: (tx: TransactionType, rule: RecurringTransaction, audience: LockedRecurringAudience) => Promise<T>,
  options?: RecurringAudienceLockOptions,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(async tx => {
        await lockHouseholdBeforeMembers(tx, actor.householdId);
        const [grant] = await tx.select({ role: householdMembers.role }).from(householdMembers)
          .where(and(eq(householdMembers.userId, actor.userId), eq(householdMembers.householdId, actor.householdId)))
          .for("share");
        if (!grant) throw new NotFoundError("Recurring rule");
        if (!can(grant.role, "financial.write") || (actor.role !== undefined && !can(actor.role, "financial.write"))) {
          throw new ForbiddenError("Financial write access required");
        }
        const { rule, audience } = await lockRecurringAudienceWithReferences(tx, id, { ...actor, role: grant.role }, options);
        return write(tx, rule, audience);
      }, { isolationLevel: "serializable" });
    } catch (error) {
      // A changed locked row invalidates the snapshot. Recheck the full audience
      // in a new transaction before repeating any write, including its outbox row.
      if (!isPostgresError(error, "40001") && !isPostgresError(error, "40P01")) throw error;
      if (attempt >= 3) throw new ConflictError("Recurring rule changed");
    }
  }
}

/** Normal transaction creation may name an existing recurring parent. Hold it through the insert. */
export function withRecurringParentForCreate<T>(
  data: { householdId: string; recurringTransactionId?: string | null }, actor: Subject | undefined,
  insert: (tx: TransactionType) => Promise<T>,
  runOrdinaryTransaction: TransactionRunner = withTransaction,
): Promise<T> {
  if (!data.recurringTransactionId) return runOrdinaryTransaction(insert);
  if (!actor || actor.householdId !== data.householdId) throw new NotFoundError("Recurring rule");
  return withWritableRecurringRule(data.recurringTransactionId, actor, insert);
}
