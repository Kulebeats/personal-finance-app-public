/**
 * R17 (Astra #255 r3): one chat outcome's durable writes, committed together.
 *
 * A persisted exchange, its ledger settlement and its `ai_query` audit row
 * commit in the exchange's transaction. An outcome that is not persisted (an
 * "unavailable" non-answer, a cancelled request, or an exchange whose store
 * write failed) settles in the ledger's own transaction with its audit row.
 * Either way no stored outcome, and so no same-key replay, exists without the
 * audit row that describes it (Rule 9, AI-AUDIT-001). An outcome settled
 * after its actor left the household (removed or erased) is audited without
 * the question or answer text (Astra #255 r4).
 *
 * @module ai/ai.exchange-settlement
 */
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { db } from "../../db";
import { lockActorStanding, type OutboundRefusalFlag } from "./ai.consent-policy";
import type { TransactionType } from "../../utils/withTransaction";
import type { businessAuditService } from "../../services/BusinessAuditService";
import type { ExchangePersistedHook } from "./ai.conversation.repository";
import type { ChatResponse } from "./ai.types";

/** Whether the actor still belonged to the household when the outcome settled. */
export interface SettlementStanding {
  actorRemoved: boolean;
}

/**
 * Writes the query's audit row, in `tx` when given (then a failure rolls the
 * outcome back); content-free when the actor was removed.
 */
export type QueryAuditWriter = (tx: TransactionType | undefined, conversationId: string, standing?: SettlementStanding) => Promise<void>;

/** Audit fields that can carry the question, answer or error text. */
export const AUDIT_CONTENT_FIELDS = ["query", "response_summary", "error"] as const;
const CONTENT_FIELDS: ReadonlySet<string> = new Set(AUDIT_CONTENT_FIELDS);

/** The audit details for an actor no longer in the household: no question or answer text. */
export function contentFreeDetails(
  details: Record<string, unknown>,
  flag: OutboundRefusalFlag | "content_erased" = "actor_removed",
): Record<string, unknown> {
  return {
    ...Object.fromEntries(Object.entries(details).filter(([field]) => !CONTENT_FIELDS.has(field))),
    [flag]: true,
  };
}

export interface ExchangeSettlementControls {
  /** Settles the request inside the exchange's own transaction. */
  completeExchange: (tx: TransactionType, response: ChatResponse, options: { storeReplay: boolean }) => Promise<void>;
  /** Settles an outcome that was not persisted; `onSettled` runs in that transaction. */
  settleUnpersisted: (
    outcome: { cancelled: boolean; response: ChatResponse },
    onSettled: (tx: TransactionType, standing: SettlementStanding) => Promise<void>,
  ) => Promise<void>;
}

export interface PersistResult {
  conversationId: string;
  persisted: boolean;
}

export function queryAuditWriter(
  auditService: typeof businessAuditService,
  scope: { householdId: string; userId: string; ipAddress?: string },
  details: Record<string, unknown>,
): QueryAuditWriter {
  return (tx, conversationId, standing) =>
    auditService.log({
      householdId: scope.householdId,
      userId: scope.userId,
      action: "CREATE",
      entityType: "ai_query",
      // An unpersisted outcome may have no thread: then no entity is named (N6).
      entityId: conversationId || null,
      details: standing?.actorRemoved ? contentFreeDetails(details) : details,
      ipAddress: scope.ipAddress,
      tx,
    });
}

/** Read standing and erasure status under the same locks as the audit write. */
export async function writeFailureAudit(
  auditService: typeof businessAuditService,
  scope: { householdId: string; userId: string; ipAddress?: string },
  details: Record<string, unknown>,
  conversationId: string,
  refusal?: OutboundRefusalFlag,
): Promise<void> {
  await db.transaction(async tx => {
    const standing = await lockActorStanding(tx, scope.householdId, scope.userId);
    if (standing === "household_gone") return;

    // Erasure takes the household and membership locks first and updates the
    // user before scrubbing these audits. Either this row is included in that
    // scrub or the locked user already carries the tombstone.
    const [user] = await tx.select({ erasedAt: users.erasedAt }).from(users).where(eq(users.id, scope.userId)).for("share");
    if (!user) return;
    const flag = refusal ?? (standing === "removed" ? "actor_removed" : standing === "consent_revoked" ? "consent_revoked" : undefined);
    const permitted = flag ? contentFreeDetails(details, flag) : details;
    const auditDetails = user.erasedAt ? contentFreeDetails(permitted, "content_erased") : permitted;
    await queryAuditWriter(auditService, scope, auditDetails)(tx, conversationId);
  });
}

/**
 * Persist (when asked), settle and audit one outcome; returns the conversation
 * id to hand back. A reply that landed in a different thread than the one it
 * was asked in (that thread was deleted meanwhile, or was never the caller's)
 * keeps no replayable body (Astra #255).
 */
export async function persistAndSettle(params: {
  persist: (onPersisted: ExchangePersistedHook) => Promise<PersistResult>;
  shouldPersist: boolean;
  suppliedConversationId: string | undefined;
  admission: ExchangeSettlementControls | undefined;
  cancelled: boolean;
  respond: (conversationId: string) => ChatResponse;
  audit: QueryAuditWriter;
}): Promise<string> {
  const { admission, suppliedConversationId, respond, audit } = params;
  let conversationId = suppliedConversationId ?? "";
  if (params.shouldPersist) {
    const result = await params.persist(async (tx, persistedId) => {
      await admission?.completeExchange(tx, respond(persistedId), {
        storeReplay: !suppliedConversationId || suppliedConversationId === persistedId,
      });
      await audit(tx, persistedId);
    });
    if (result.persisted) return result.conversationId;
    conversationId = result.conversationId;
  }
  if (admission) {
    await admission.settleUnpersisted({ cancelled: params.cancelled, response: respond(conversationId) }, (tx, standing) =>
      audit(tx, conversationId, standing),
    );
  } else {
    await audit(undefined, conversationId);
  }
  return conversationId;
}
