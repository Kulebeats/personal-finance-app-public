/**
 * Household invitation codes and resending (AH-05).
 *
 * A resend issues a NEW invite code, so a link that leaked before the resend
 * stops working: accepting the old code then fails exactly like an unknown
 * code does. The resend also refreshes the expiry with creation's rule
 * (INVITATION_EXPIRY_DAYS from now), as resending always has.
 *
 * One transaction, locks in the same order as acceptance
 * (invitations.accept.ts): lock the household first. Check the actor's
 * current membership and the locked invitation before rotating the code.
 * The audit records the expiry change only.
 *
 * @module modules/household/invitations.resend
 */

import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { householdInvitations, householdMembers, households, type HouseholdInvitation } from "@shared/schema";
import { INVITABLE_ROLES } from "@shared/household-members";
import { withTransaction } from "../../utils/withTransaction";
import { businessAuditService } from "../../services/BusinessAuditService";
import { ConflictError, ForbiddenError, NotFoundError } from "../../core/errors";
import { assertMayGrantRole } from "./ownership.service";

export const INVITATION_EXPIRY_DAYS = 7;
const INVITE_CODE_BYTES = 32;

/** A secure invite code: 64 hex chars from 32 random bytes. */
export function generateInviteCode(): string {
  return crypto.randomBytes(INVITE_CODE_BYTES).toString("hex");
}

/** Creation's expiry rule: INVITATION_EXPIRY_DAYS from `from`. */
export function invitationExpiresAt(from: Date = new Date()): Date {
  const expiresAt = new Date(from);
  expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);
  return expiresAt;
}

export interface ResendActor {
  userId: string;
  householdId: string;
  ipAddress?: string;
}

export interface ResentInvitation {
  invitation: HouseholdInvitation;
  /** The new code, for the email only. Never log, audit or return it. */
  inviteCode: string;
}

export async function rotateInvitationForResend(
  actor: ResendActor,
  invitationId: string,
): Promise<ResentInvitation> {
  return await withTransaction(async (tx) => {
    await tx
      .select({ id: households.id })
      .from(households)
      .where(eq(households.id, actor.householdId))
      .for("update")
      .limit(1);
    const [member] = await tx
      .select({ role: householdMembers.role })
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, actor.householdId), eq(householdMembers.userId, actor.userId)))
      .for("update")
      .limit(1);
    if (member?.role !== "owner" && member?.role !== "admin") {
      throw new ForbiddenError("Only owners and admins can resend invitations");
    }

    const [current] = await tx
      .select()
      .from(householdInvitations)
      .where(and(eq(householdInvitations.id, invitationId), eq(householdInvitations.householdId, actor.householdId)))
      .for("update")
      .limit(1);
    if (!current) {
      throw new NotFoundError("Invitation not found");
    }
    if (!INVITABLE_ROLES.some(role => role === current.role)) {
      throw new ForbiddenError("This role cannot be granted by invitation");
    }
    assertMayGrantRole(member.role, current.role);
    if (current.acceptedAt) {
      throw new ConflictError("This invitation has already been accepted");
    }

    const inviteCode = generateInviteCode();
    const expiresAt = invitationExpiresAt();
    const [invitation] = await tx
      .update(householdInvitations)
      .set({ inviteCode, expiresAt })
      .where(eq(householdInvitations.id, current.id))
      .returning();

    await businessAuditService.logUpdate({
      tx,
      householdId: actor.householdId,
      userId: actor.userId,
      entityType: "household_invitation",
      entityId: current.id,
      oldValue: { expiresAt: current.expiresAt },
      newValue: { expiresAt },
      ipAddress: actor.ipAddress,
      metadata: { action: "resend_invitation", codeRotated: true },
    });

    return { invitation, inviteCode };
  });
}
