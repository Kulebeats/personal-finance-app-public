/**
 * R17 (17d): the household AI consent policy.
 *
 * Adding Anthropic changed the set of external processors, so the disclosure
 * moved to v2.0. A household that accepted an earlier version keeps chat in
 * the labelled local mode (nothing leaves the household) until an owner or
 * admin accepts the current disclosure.
 *
 * @module ai/ai.consent-policy
 */
import { and, eq } from "drizzle-orm";
import { householdMembers, households } from "@shared/schema";
import { db } from "../../db";
import { ForbiddenError } from "../../core/errors";
import type { TransactionType } from "../../utils/withTransaction";

export const CURRENT_AI_CONSENT_VERSION = "v2.0";

/** The external processors the current disclosure names, in routing order. */
export const AI_CONSENT_PROCESSORS = ["Anthropic", "Google"] as const;

export type ConsentStanding = "none" | "outdated" | "current";

export function consentStanding(given: boolean | null | undefined, version: string | null | undefined): ConsentStanding {
  if (!given) return "none";
  return version === CURRENT_AI_CONSENT_VERSION ? "current" : "outdated";
}

export interface HouseholdConsentState {
  standing: ConsentStanding;
  version: string | null;
}

export async function readHouseholdConsent(householdId: string): Promise<HouseholdConsentState | null> {
  const [row] = await db
    .select({ given: households.aiConsentGiven, version: households.aiConsentVersion })
    .from(households)
    .where(eq(households.id, householdId));
  return row ? toConsentState(row) : null;
}

function toConsentState(row: { given: boolean | null; version: string | null }): HouseholdConsentState {
  return { standing: consentStanding(row.given, row.version), version: row.given ? row.version ?? null : null };
}

/**
 * Rechecked before every outbound provider attempt (AI-06): the actor must
 * still belong to the household, and the household's consent must still be
 * the version this request was admitted under. Anything else stops the next
 * transmission; it cannot retract what was already sent.
 *
 * Called inside the attempt claim's transaction, after its cap lock is held
 * (Astra #255). The household row, then the membership row, are share-locked
 * until the claim commits, so a revoke or removal either committed first (and
 * is seen here) or waits for this claim. The order matches the household
 * lifecycle paths, which lock the household before its members.
 * `beforeLock` runs before each locking read, so a claim can bound every
 * successive lock wait by what is left of its deadline (Astra #255 r4).
 * Outside a transaction it is a plain read, used once more right before the
 * adapter call.
 */
export async function assertOutboundStillPermitted(
  householdId: string,
  actorId: string,
  admittedVersion: string | null,
  executor: Executor = db,
  beforeLock: BeforeLock = noLockBudget,
): Promise<void> {
  await beforeLock();
  const [household] = await executor
    .select({ given: households.aiConsentGiven, version: households.aiConsentVersion })
    .from(households)
    .where(eq(households.id, householdId))
    .for("share");
  await beforeLock();
  if (!(await lockMembership(executor, householdId, actorId))) throw new ActorRemovedError();
  const consent = household ? toConsentState(household) : null;
  if (!consent || consent.standing !== "current" || consent.version !== admittedVersion) {
    throw new ForbiddenError("Household AI consent changed. Ask a household owner or administrator to review AI processing.");
  }
}

type Executor = TransactionType | typeof db;
/** Re-bounds the next lock wait (a claim's `lock_timeout`); a no-op elsewhere. */
export type BeforeLock = () => Promise<void>;
const noLockBudget: BeforeLock = async () => undefined;

/** The refusal a fresh request gets when the household has no AI consent. */
export const AI_CONSENT_REQUIRED_MESSAGE = "AI features require consent. Please enable AI assistant in Settings.";

/** Which content-free audit flag a refused provider result carries. */
export type OutboundRefusalFlag = "actor_removed" | "consent_revoked";

/**
 * A provider result the actor may no longer receive. The query audit for it
 * is written without the question or answer text, flagged with `auditFlag`.
 */
export abstract class OutboundRefusedError extends ForbiddenError {
  abstract readonly auditFlag: OutboundRefusalFlag;
}

/** The actor is no longer a member of the household, removed or erased (Astra #255 r4). */
export class ActorRemovedError extends OutboundRefusedError {
  readonly auditFlag = "actor_removed";
  constructor() {
    super("You are no longer a member of this household.");
  }
}

/** The household revoked AI consent while the request was in flight (R17 follow-up). */
export class ConsentRevokedError extends OutboundRefusedError {
  readonly auditFlag = "consent_revoked";
  constructor() {
    super(AI_CONSENT_REQUIRED_MESSAGE);
  }
}

/** Share-lock the actor's membership row; false when it is gone. */
async function lockMembership(executor: Executor, householdId: string, actorId: string): Promise<boolean> {
  const [membership] = await executor
    .select({ role: householdMembers.role })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, actorId)))
    .for("share");
  return membership !== undefined;
}

/** Where the actor stands, read under the household (KEY SHARE) then membership (SHARE) locks. */
export type ActorStanding = "member" | "removed" | "consent_revoked" | "household_gone";

/**
 * Lock the household (KEY SHARE, so chat admissions are not blocked), then
 * the actor's membership, in the order erasure locks them, and report where
 * the actor stands. An erasure that committed first shows as "removed" (or
 * "household_gone" after a sole member's erasure); one that starts later
 * waits for this transaction. A consent revocation takes the household row
 * FOR UPDATE, so it too either committed first ("consent_revoked") or waits
 * (R17 follow-up: a result that arrives after a revocation is discarded).
 */
export async function lockActorStanding(tx: TransactionType, householdId: string, actorId: string): Promise<ActorStanding> {
  const [household] = await tx
    .select({ given: households.aiConsentGiven, version: households.aiConsentVersion })
    .from(households)
    .where(eq(households.id, householdId))
    .for("key share");
  if (!household) return "household_gone";
  if (!(await lockMembership(tx, householdId, actorId))) return "removed";
  return consentStanding(household.given, household.version) === "none" ? "consent_revoked" : "member";
}

/**
 * Fence an exchange write (Astra #255 r3, R17 follow-up). Runs first in the
 * exchange transaction; refuses unless the actor is still a member and the
 * household has not revoked AI consent since the request was admitted.
 */
export async function fenceOutboundResult(tx: TransactionType, householdId: string, actorId: string): Promise<void> {
  const standing = await lockActorStanding(tx, householdId, actorId);
  if (standing === "consent_revoked") throw new ConsentRevokedError();
  if (standing !== "member") throw new ActorRemovedError();
}

/**
 * Admission's recheck, under the household row lock the caller already holds
 * (Astra #255 r4): a removed actor gets the non-member refusal and a household
 * without consent the consent refusal, before any stored replay is read.
 */
export async function assertAdmissionStillPermitted(
  tx: TransactionType,
  household: { id: string; given: boolean | null; version: string | null },
  actorId: string,
): Promise<void> {
  if (!(await lockMembership(tx, household.id, actorId))) throw new ActorRemovedError();
  if (consentStanding(household.given, household.version) === "none") throw new ForbiddenError(AI_CONSENT_REQUIRED_MESSAGE);
}
