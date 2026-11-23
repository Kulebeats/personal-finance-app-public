/**
 * R17 (Astra #255 r3): one household AI consent decision, end to end.
 *
 * A grant must name the disclosure version the owner or admin was shown; a
 * page rendered before the disclosure changed cannot grant the new one. The
 * actor's management role is rechecked under the household and membership
 * locks inside the write transaction, so a demotion that committed after the
 * route's role check is seen here, and one still in flight is waited for.
 * The household state, the consent history and the DPA audit row commit
 * together or not at all (Rule 9).
 *
 * @module ai/ai.consent.service
 */
import { abortInFlight } from "./ai.inflight";
import { and, eq } from "drizzle-orm";
import { aiConsentEvents, householdMembers, households } from "@shared/schema";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { ConflictError, ForbiddenError, NotFoundError } from "../../core/errors";
import { businessAuditService } from "../../services/BusinessAuditService";
import { CURRENT_AI_CONSENT_VERSION } from "./ai.consent-policy";

/** Roles that may grant or revoke household AI consent (SEC-RBAC-001). */
const CONSENT_MANAGER_ROLES: ReadonlySet<string> = new Set(["owner", "admin"]);

export interface ConsentDecisionInput {
  householdId: string;
  actorId: string;
  consentGiven: boolean;
  /** The disclosure version the actor was shown; required for a grant. */
  shownVersion?: string;
  ipAddress?: string;
}

export interface ConsentDecision {
  consentGiven: boolean;
  consentVersion: string | null;
  decidedAt: Date;
}

/** Lock the household, then the actor's membership (the lifecycle lock order), and recheck the role. */
async function lockConsentManager(tx: TransactionType, householdId: string, actorId: string): Promise<void> {
  const [household] = await tx.select({ id: households.id }).from(households)
    .where(eq(households.id, householdId))
    .for("update");
  if (!household) throw new NotFoundError("Household not found");
  const [membership] = await tx.select({ role: householdMembers.role }).from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, actorId)))
    .for("share");
  if (!membership || !CONSENT_MANAGER_ROLES.has(membership.role)) {
    throw new ForbiddenError("Only household owners and admins can change AI consent.");
  }
}

export async function recordConsentDecision(input: ConsentDecisionInput): Promise<ConsentDecision> {
  const { householdId, actorId, consentGiven, ipAddress } = input;
  if (consentGiven && input.shownVersion !== CURRENT_AI_CONSENT_VERSION) {
    throw new ConflictError("The AI disclosure has changed. Review the current disclosure and try again.");
  }
  const consentVersion = consentGiven ? CURRENT_AI_CONSENT_VERSION : null;
  const decidedAt = new Date();
  await withTransaction(async (tx) => {
    await lockConsentManager(tx, householdId, actorId);
    await tx.update(households)
      .set({ aiConsentGiven: consentGiven, aiConsentDate: decidedAt, aiConsentVersion: consentVersion })
      .where(eq(households.id, householdId));
    await tx.insert(aiConsentEvents).values({
      householdId,
      actorId,
      action: consentGiven ? "grant" : "revoke",
      consentVersion,
      createdAt: decidedAt,
    });
    // packet R4: entityId is the household, with the dedicated 'ai_consent'
    // entity type; with `tx` a failed audit write rolls the decision back.
    await businessAuditService.log({
      householdId,
      userId: actorId,
      action: consentGiven ? "CREATE" : "DELETE",
      entityType: "ai_consent",
      entityId: householdId,
      details: {
        consent_given: consentGiven,
        consent_version: consentVersion,
        action: consentGiven ? "AI consent granted" : "AI consent revoked",
      },
      ipAddress,
      tx,
    });
  });
  // After the commit: stop this process's in-flight provider calls for the
  // household (R17 follow-up). A late answer from any instance is discarded
  // by the exchange fence, which sees the committed revocation.
  if (!consentGiven) abortInFlight(householdId, "consent_revoked");
  return { consentGiven, consentVersion, decidedAt };
}
