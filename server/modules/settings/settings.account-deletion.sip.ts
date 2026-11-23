import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { auditLogs, investmentPlanAuthorizations, investmentPlanOperations,
  investmentSipPurchaseReservations, recurringInvestments, users } from "@shared/schema";
import { ConflictError, NotFoundError } from "../../core/errors";
import type { TransactionType } from "../../utils/withTransaction";

async function discoverHouseholds(tx: TransactionType, userId: string, householdId: string | null) {
  const result = await tx.execute<{ household_id: string }>(sql`
    SELECT ${householdId}::uuid AS household_id
    UNION SELECT household_id FROM public.investment_plan_authorizations WHERE author_user_id=${userId}::uuid
    UNION SELECT household_id FROM public.investment_plan_operations WHERE actor_user_id=${userId}::uuid
    UNION SELECT household_id FROM public.investment_sip_confirmations WHERE actor_user_id=${userId}::uuid
    ORDER BY household_id`);
  // A household-free erasure (A-20) passes no current household: drop its NULL.
  return result.rows.map(row => row.household_id).filter((id): id is string => id !== null);
}

/** Current membership alone misses mandates left in historical households.
 * Lock all discovered anchors in UUID order before members, identity or writes;
 * this retains the invite/erasure anchor without crossing two erasures' order. */
export async function lockSipErasureHouseholds(tx: TransactionType, userId: string, householdId: string | null): Promise<ReadonlySet<string>> {
  const discovered = await discoverHouseholds(tx, userId, householdId);
  // One array parameter keeps historical scope independent of the SQL bind
  // limit. A vanished historical household need not be locked; current is required.
  const result = await tx.execute<{ id: string }>(sql`SELECT id FROM public.households
    WHERE id=ANY(${sql.param(discovered)}::uuid[]) ORDER BY id FOR UPDATE`);
  const locked = new Set(result.rows.map(row => row.id));
  if (householdId && !locked.has(householdId.toLowerCase())) throw new NotFoundError("Household not found");
  return locked;
}

/** Signed grant/replay writers also lock this identity before their writes.
 * Recheck the global scope AFTER waiting for it and BEFORE destructive work.
 * An unbound late household requires a fresh request, never a later HH lock.
 * Returns the address on the locked row: the one erasure must remove, even if
 * an e-mail change committed after the request read the user. */
export async function lockSipErasureIdentity(tx: TransactionType, userId: string, householdId: string | null,
  lockedHouseholds: ReadonlySet<string>): Promise<string> {
  const [identity] = await tx.select({ email: users.email }).from(users).where(eq(users.id, userId)).for("update");
  if (!identity) throw new NotFoundError("User not found");
  const current = await discoverHouseholds(tx, userId, householdId);
  if (current.some(id => !lockedHouseholds.has(id))) {
    throw new ConflictError("Account erasure state changed; retry the request");
  }
  return identity.email;
}

/** Called only after the same transaction marks the locked user erased.
 * Purge operational authority globally; seven-field completed proofs and their
 * actual BUY/lot/financial audit history have no operational grant dependency. */
export async function purgeErasedSipAuthorizations(tx: TransactionType, userId: string): Promise<void> {
  const [identity] = await tx.select({ erasedAt: users.erasedAt }).from(users).where(eq(users.id, userId));
  if (!identity?.erasedAt) throw new ConflictError("Account erasure identity is unavailable");
  // Actorless pending occurrences remain household plan state. Only this
  // signer's completed operational parents are purged; their children cascade,
  // while actual purchases/lots/financial audits/proofs and terminal fences stay.
  // The SQL guards independently require complete terminal posting before purge.
  const incomplete = await tx.execute(sql`SELECT c.id FROM public.investment_sip_confirmations c
    LEFT JOIN public.investment_sip_occurrences o
      ON o.plan_id=c.plan_id AND o.original_due_date=c.original_due_date
      AND o.household_id=c.household_id
    LEFT JOIN public.investment_sip_occurrence_fences f
      ON f.plan_id=c.plan_id AND f.original_due_date=c.original_due_date
    WHERE c.actor_user_id=${userId}::uuid
      AND (o.state IS DISTINCT FROM 'closed' OR o.occurrence_revision IS DISTINCT FROM 1
        OR f.terminal IS DISTINCT FROM true) LIMIT 1`);
  if (incomplete.rows.length) throw new ConflictError("Completed investment confirmation is unavailable for erasure");
  await tx.execute(sql`SELECT o.plan_id FROM public.investment_sip_occurrences o
    JOIN public.investment_sip_confirmations c
      ON c.plan_id=o.plan_id AND c.original_due_date=o.original_due_date
      AND c.household_id=o.household_id
    WHERE c.actor_user_id=${userId}::uuid ORDER BY o.plan_id,o.original_due_date FOR UPDATE OF o`);
  await tx.execute(sql`DELETE FROM public.investment_sip_occurrences o
    USING public.investment_sip_confirmations c
    WHERE c.plan_id=o.plan_id AND c.original_due_date=o.original_due_date
      AND c.household_id=o.household_id AND c.actor_user_id=${userId}::uuid`);
  const remaining = await tx.execute(sql`SELECT id FROM public.investment_sip_confirmations
    WHERE actor_user_id=${userId}::uuid LIMIT 1`);
  if (remaining.rows.length) throw new ConflictError("Investment confirmation erasure is incomplete");
  await tx.delete(auditLogs).where(and(
    eq(auditLogs.userId, userId), isNull(auditLogs.householdId),
    eq(auditLogs.entityType, "investment_sip_confirmation"),
    sql`${auditLogs.details}->>'authorizationEvent'='sip_final_confirmation_v1'`,
    sql`${auditLogs.details}->>'requestVersion'='1'`,
  ));
  const actorGrants = () => tx.select({ id: investmentPlanAuthorizations.id }).from(investmentPlanAuthorizations)
    .where(eq(investmentPlanAuthorizations.authorUserId, userId));

  // The pointer's author, not a plan's old creator or a superseded grant,
  // determines which current instructions stop. Lock plan IDs deterministically.
  await tx.select({ id: recurringInvestments.id }).from(recurringInvestments)
    .where(inArray(recurringInvestments.currentAuthorizationId, actorGrants())).orderBy(recurringInvestments.id).for("update");
  await tx.update(recurringInvestments).set({ isActive: false, currentAuthorizationId: null, updatedAt: new Date() })
    .where(inArray(recurringInvestments.currentAuthorizationId, actorGrants()));
  // Clearing the pointer preserves its lifetime counter and schedule. It must
  // precede grant deletion because the exact-plan/revision pointer FK is immediate.
  await tx.delete(investmentPlanOperations).where(eq(investmentPlanOperations.actorUserId, userId));
  await tx.delete(investmentSipPurchaseReservations).where(inArray(investmentSipPurchaseReservations.authorizationId, actorGrants()));
  await tx.delete(investmentPlanAuthorizations).where(eq(investmentPlanAuthorizations.authorUserId, userId));

  // Only the new actor-only operational event families are erased. In
  // particular, system financial audits and the durable erasure audit survive.
  await tx.delete(auditLogs).where(and(eq(auditLogs.userId, userId), isNull(auditLogs.householdId), or(
    and(eq(auditLogs.entityType, "investment_plan_authorization"), sql`${auditLogs.details}->>'authorizationEvent'='sip_grant_v1'`),
    and(eq(auditLogs.entityType, "recurring_investment"),
      sql`${auditLogs.details}->>'authorizationEvent' IN ('pending_plan_v1','plan_deactivated_v1')`),
  )));
}
