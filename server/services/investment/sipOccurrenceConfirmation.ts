import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, investmentSipConfirmations, investmentSipOccurrenceFences,
  investmentSipOccurrences, users } from "@shared/schema";
import { canonicalSipOccurrenceDate, canonicalSipOccurrenceUuid, normalizeSipOccurrenceConfirmation,
  serializeSipOccurrenceIntent, type SipOccurrenceConfirmation } from "@shared/sip-occurrence-contract";
import { InternalError, NotFoundError } from "../../core/errors";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { lockInvestmentWriterIdentity, type InvestmentSourceSession } from "../../modules/investments/investmentTransactionAccess";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { requireSignedSipSession } from "./sipPlanAccess";
import { lockSipOccurrence, lockSipOccurrencePlan,
  visibleSipOccurrenceAccount, type SipOccurrence } from "./sipOccurrenceAccess";
import { safeSipOccurrenceError, SipOccurrenceConflict, SipOccurrenceUnavailable } from "./sipOccurrenceErrors";
import { lockSipOccurrencePostingSources, postSipOccurrenceFill } from "./sipOccurrencePosting";
import { readClosedSipOccurrence, type SipOccurrenceDetailedClosed, type SipOccurrenceReceipt } from "./sipOccurrenceRead";
import { assertSipOccurrenceCutoff, requireSipOccurrenceCalendar } from "./sipOccurrenceCalendar";

export interface SipOccurrenceAcknowledgment {
  requestVersion: 1;
  operationId: string;
  occurrence: SipOccurrenceDetailedClosed;
}

function intentDigest(householdId: string, planId: string, scheduledDate: string,
  currency: string, input: SipOccurrenceConfirmation) {
  return createHash("sha256").update(serializeSipOccurrenceIntent({ householdId, planId, scheduledDate, currency }, input), "utf8").digest("hex");
}

async function replay(tx: TransactionType, actor: HouseholdContext, receipt: SipOccurrenceReceipt,
  requestedPlanId: string, scheduledDate: string, input: SipOccurrenceConfirmation): Promise<SipOccurrenceAcknowledgment> {
  const original = await lockSipOccurrencePlan(tx, actor, receipt.planId, "update");
  await visibleSipOccurrenceAccount(tx, actor, original.accountId, true);
  const occurrence = await lockSipOccurrence(tx, actor, original, receipt.originalDueDate);
  if (!occurrence) throw new SipOccurrenceUnavailable("OCCURRENCE_CLOSED_DETAILS_UNAVAILABLE");
  const digest = intentDigest(actor.householdId, requestedPlanId, scheduledDate, occurrence.currency, input);
  // Valid Unicode is preserved byte-exactly. The reference never enters any
  // hash or acknowledgment; operational erasure removes this comparison too.
  if (receipt.requestVersion !== 1 || receipt.requestDigest !== digest
    || receipt.brokerReference !== (input.brokerReference ?? null)) {
    throw new SipOccurrenceConflict("OPERATION_INTENT_MISMATCH");
  }
  return { requestVersion: 1, operationId: input.operationId, occurrence: await readClosedSipOccurrence(tx, occurrence, receipt) };
}

async function close(tx: TransactionType, occurrence: SipOccurrence) {
  const updated = await tx.update(investmentSipOccurrences).set({ state: "closed", occurrenceRevision: 1 }).where(and(
    eq(investmentSipOccurrences.planId, occurrence.planId),
    eq(investmentSipOccurrences.originalDueDate, occurrence.originalDueDate),
    eq(investmentSipOccurrences.occurrenceRevision, 0), eq(investmentSipOccurrences.state, "pending"),
  )).returning();
  if (updated.length !== 1) throw new SipOccurrenceConflict("OCCURRENCE_REVISION_CHANGED");
  const fence = await tx.update(investmentSipOccurrenceFences).set({ terminal: true }).where(and(
    eq(investmentSipOccurrenceFences.planId, occurrence.planId),
    eq(investmentSipOccurrenceFences.originalDueDate, occurrence.originalDueDate),
    eq(investmentSipOccurrenceFences.terminal, false),
  )).returning();
  if (fence.length !== 1) throw new SipOccurrenceConflict("OCCURRENCE_ALREADY_CLOSED");
  return updated[0];
}

export async function confirmSipOccurrence(planIdentity: string, scheduledIdentity: string, input: unknown,
  caller: HouseholdContext, session: InvestmentSourceSession): Promise<SipOccurrenceAcknowledgment> {
  try {
    requireSignedSipSession(caller, session);
    const planId = canonicalSipOccurrenceUuid(planIdentity, "planId");
    const scheduledDate = canonicalSipOccurrenceDate(scheduledIdentity, "scheduledDate");
    const command = normalizeSipOccurrenceConfirmation(input);
    return await withTransaction<SipOccurrenceAcknowledgment>(async tx => {
      const actor = await lockInvestmentWriterIdentity(tx, caller, session);
      const [receipt] = await tx.select().from(investmentSipConfirmations).where(and(
        eq(investmentSipConfirmations.householdId, actor.householdId),
        eq(investmentSipConfirmations.actorUserId, actor.userId),
        eq(investmentSipConfirmations.operationId, command.operationId),
      ));
      if (receipt) return replay(tx, actor, receipt, planId, scheduledDate, command);
      const plan = await lockSipOccurrencePlan(tx, actor, planId, "update");
      await visibleSipOccurrenceAccount(tx, actor, plan.accountId);
      const [fence] = await tx.select().from(investmentSipOccurrenceFences).where(and(
        eq(investmentSipOccurrenceFences.planId, plan.id),
        eq(investmentSipOccurrenceFences.originalDueDate, scheduledDate),
      )).for("update");
      if (!fence) throw new NotFoundError("Investment occurrence");
      const occurrence = await lockSipOccurrence(tx, actor, plan, scheduledDate);
      if (!occurrence && fence.terminal) {
        await visibleSipOccurrenceAccount(tx, actor, plan.accountId, true);
        throw new SipOccurrenceUnavailable("OCCURRENCE_CLOSED_DETAILS_UNAVAILABLE");
      }
      if (!occurrence) throw new NotFoundError("Investment occurrence");
      // Original custody must be authoritative before every distinctive state
      // conflict. Holding -> account preserves manual/first-purchase ordering;
      // do not acquire account SHARE first and later upgrade it for posting.
      const sources = await lockSipOccurrencePostingSources(tx, actor, occurrence);
      if (fence.terminal || occurrence.state !== "pending") throw new SipOccurrenceConflict("OCCURRENCE_ALREADY_CLOSED");
      if (command.expectedRevision !== occurrence.occurrenceRevision) throw new SipOccurrenceConflict("OCCURRENCE_REVISION_CHANGED");
      const zone = await requireSipOccurrenceCalendar(tx, actor.householdId);
      const [identity] = await tx.select({ generation: users.securityGeneration }).from(users).where(eq(users.id, actor.userId));
      if (!identity) throw new NotFoundError("Investment occurrence");
      const digest = intentDigest(actor.householdId, planId, scheduledDate, occurrence.currency, command);
      // Omit timestamp/cutoff completely: the SQL BEFORE INSERT trigger derives
      // both from one database instant and this transaction's locked zone.
      const inserted = await tx.execute<{ id: string }>(sql`INSERT INTO public.investment_sip_confirmations
        (household_id,actor_user_id,operation_id,plan_id,original_due_date,expected_occurrence_revision,
          request_version,request_digest,outcome,fill_count,broker_reference,security_generation)
        VALUES (${actor.householdId}::uuid,${actor.userId}::uuid,${command.operationId}::uuid,
          ${occurrence.planId}::uuid,${occurrence.originalDueDate}::date,${command.expectedRevision},
          1,${digest},${command.outcome},${command.fills.length},${command.brokerReference ?? null},${identity.generation})
        RETURNING id`);
      const id = inserted.rows[0]?.id;
      if (!id) throw new InternalError("Confirmation receipt is unavailable.");
      const [confirmation] = await tx.select().from(investmentSipConfirmations).where(eq(investmentSipConfirmations.id, id));
      if (!confirmation) throw new InternalError("Confirmation receipt is unavailable.");
      assertSipOccurrenceCutoff(confirmation, zone, command);
      for (const [index, fill] of command.fills.entries()) {
        await postSipOccurrenceFill(tx, sources, confirmation.id, index, fill);
      }
      await tx.insert(auditLogs).values({
        userId: actor.userId, householdId: null, action: "CREATE",
        entityType: "investment_sip_confirmation", entityId: confirmation.id,
        details: { authorizationEvent: "sip_final_confirmation_v1", requestVersion: 1 },
      });
      const closed = await close(tx, occurrence);
      return { requestVersion: 1, operationId: command.operationId,
        occurrence: await readClosedSipOccurrence(tx, closed, confirmation) };
    });
  } catch (error) {
    throw safeSipOccurrenceError(error);
  }
}
