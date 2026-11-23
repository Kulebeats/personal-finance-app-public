/**
 * Right-to-erasure for the user's AI data (R17).
 *
 * An erased user is anonymised, not deleted, so the ON DELETE CASCADEs on
 * ai_conversations.user_id and ai_requests.actor_id never fire for a member
 * of a shared household. Inside the erasure transaction this:
 *
 * - deletes the user's conversations (their messages cascade). Threads are
 *   scoped to one (household, user), so no other member's message is in them;
 *   ai_requests.conversation_id is nulled by its FK;
 * - clears the stored reply (the replay body) on the user's requests;
 * - scrubs the provider request ids on those requests' attempts and marks
 *   them identity_erased, so a call still in flight never writes one back;
 * - removes the question and answer text from the user's `ai_query` audit
 *   rows and marks them `content_erased` (Astra A-25). The audit event stays:
 *   the household keeps its history, attributed to the tombstone.
 *
 * The request and attempt rows stay: they are the household's quota and
 * call-cap accounting. When the household itself is deleted, its requests
 * cascade away first, so `scrubHouseholdAiAttempts` must run BEFORE that
 * delete, while the attempts can still be found through their requests.
 *
 * @module ai/ai.erasure
 */
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { aiAttempts, aiConversations, aiRequests, auditLogs } from "@shared/schema";
import type { TransactionType } from "../../utils/withTransaction";
import { AUDIT_CONTENT_FIELDS } from "./ai.exchange-settlement";

/** The content keys removed from an erased user's AI audit rows, as a text[]. */
const CONTENT_KEYS = sql.raw(`array[${AUDIT_CONTENT_FIELDS.map((field) => `'${field}'`).join(",")}]::text[]`);

async function scrubAttempts(tx: TransactionType, requestsWhere: SQL): Promise<void> {
  const requests = tx.select({ id: aiRequests.id }).from(aiRequests).where(requestsWhere);
  await tx
    .update(aiAttempts)
    .set({ providerRequestId: null, identityErased: true })
    .where(inArray(aiAttempts.requestId, requests));
}

export async function eraseActorAiTraces(tx: TransactionType, userId: string): Promise<void> {
  // Lock the threads first, as a single-thread delete does: an exchange being
  // written to one holds KEY SHARE until its settlement commits, so this waits
  // for it and the clears below then see that answer.
  await tx.select({ id: aiConversations.id }).from(aiConversations).where(eq(aiConversations.userId, userId)).for("update");
  await scrubAttempts(tx, eq(aiRequests.actorId, userId));
  await tx.update(aiRequests).set({ responseBody: null }).where(eq(aiRequests.actorId, userId));
  await tx.delete(aiConversations).where(eq(aiConversations.userId, userId));
  await scrubQueryAuditContent(tx, userId);
}

/** The user's AI query audit rows keep the event, without the question or answer text. */
async function scrubQueryAuditContent(tx: TransactionType, userId: string): Promise<void> {
  await tx.update(auditLogs).set({
    details: sql`(${auditLogs.details} - ${CONTENT_KEYS}) || '{"content_erased": true}'::jsonb`,
  }).where(and(
    eq(auditLogs.userId, userId),
    eq(auditLogs.entityType, "ai_query"),
    sql`jsonb_typeof(${auditLogs.details}) = 'object'`,
  ));
}

/** Every attempt of a household about to be deleted (any actor, past members too). */
export async function scrubHouseholdAiAttempts(tx: TransactionType, householdId: string): Promise<void> {
  await scrubAttempts(tx, eq(aiRequests.householdId, householdId));
}
