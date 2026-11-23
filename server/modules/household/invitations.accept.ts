/**
 * Household invitation acceptance (R03.2, AH-06, SCP-318).
 *
 * One transaction, locks in this order:
 *   1. the household row FOR UPDATE: the same parent-first anchor as ownership
 *      changes and account erasure, so a join cannot race a transfer, a leave
 *      or a sole-member erasure;
 *   2. the joining user's membership lock (repositories/householdMembershipLock),
 *      shared with household creation, so one user's concurrent joins serialise;
 *   3. the invitation row FOR UPDATE.
 * Under those locks it re-checks that the invitation is unused, unexpired and
 * addressed to the user, that an admin invitation's sender is still the owner
 * (spec §A3), and that the user belongs to no household. The membership, the
 * used-invitation mark and the audit row are written in the same transaction,
 * so a failed audit write rolls the join back (Rule 9).
 *
 * @module modules/household/invitations.accept
 */

import { and, eq } from "drizzle-orm";
import {
  householdInvitations,
  householdMembers,
  households,
  users,
  type Household,
  type HouseholdInvitation,
} from "@shared/schema";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { lockUserMembership } from "../../repositories/householdMembershipLock";
import { householdRepository } from "../../repositories/HouseholdRepository";
import { businessAuditService } from "../../services/BusinessAuditService";
import { ConflictError, HttpError, NotFoundError } from "../../core/errors";

const EMAIL_MISMATCH_MESSAGE =
  "This invitation was sent to a different email address. Sign in with that address to accept it.";
const INVALID_CODE_MESSAGE = "Invitation not found or invalid code";

/**
 * Spec R03.2 (AH-06): the invitation is addressed to another email than the
 * signed-in user's verified one. A 409 with its own code, so the client can say
 * which account to use; the invited address is never echoed.
 */
export class InviteRecipientMismatchError extends HttpError {
  readonly statusCode = 409;
  readonly code = "INVITE_RECIPIENT_MISMATCH";
  constructor() { super(EMAIL_MISMATCH_MESSAGE); }
}

/** Invitation emails are stored lowercased; compare every address the same way. */
export function normalizeInviteEmail(email: string): string {
  return email.toLowerCase();
}

export interface AcceptingUser {
  userId: string;
  ipAddress?: string;
}

export interface AcceptedInvitation {
  household: Pick<Household, "id" | "name" | "currency">;
  role: HouseholdInvitation["role"];
}

async function lockHouseholdRow(tx: TransactionType, householdId: string) {
  const [row] = await tx
    .select({ id: households.id, name: households.name, currency: households.currency })
    .from(households)
    .where(eq(households.id, householdId))
    .for("update")
    .limit(1);
  if (!row) {
    throw new NotFoundError("Household no longer exists");
  }
  return row;
}

/**
 * Locks the invitation only while it still carries `inviteCode`: a resend
 * (invitations.resend.ts) may have rotated the code since the lookup, and the
 * old code must then fail like an unknown one.
 */
async function lockInvitationRow(tx: TransactionType, invitationId: string, inviteCode: string) {
  const [row] = await tx
    .select()
    .from(householdInvitations)
    .where(and(eq(householdInvitations.id, invitationId), eq(householdInvitations.inviteCode, inviteCode)))
    .for("update")
    .limit(1);
  if (!row) {
    throw new NotFoundError(INVALID_CODE_MESSAGE);
  }
  return row;
}

/** Unused, unexpired, and addressed to the user. Never echoes the invited address. */
async function assertAddressedToUser(
  tx: TransactionType,
  invitation: HouseholdInvitation,
  userId: string,
): Promise<void> {
  if (invitation.acceptedAt) {
    throw new ConflictError("This invitation has already been used");
  }
  if (new Date() > invitation.expiresAt) {
    throw new ConflictError("This invitation has expired");
  }
  const [user] = await tx.select({ email: users.email, erasedAt: users.erasedAt }).from(users).where(eq(users.id, userId)).limit(1);
  // A-20: an erased account joins nothing, whatever address its row carries.
  if (!user || user.erasedAt) {
    throw new NotFoundError("User not found");
  }
  if (!user.email || normalizeInviteEmail(user.email) !== normalizeInviteEmail(invitation.email)) {
    throw new InviteRecipientMismatchError();
  }
}

/**
 * Spec §A3: only the owner grants admin, so an admin invitation is honoured
 * only while its sender is still the owner. The household row is locked, and
 * every ownership change takes that lock first.
 */
async function assertAdminInviterStillOwner(tx: TransactionType, invitation: HouseholdInvitation): Promise<void> {
  if (invitation.role !== "admin") {
    return;
  }
  const [inviter] = invitation.invitedBy
    ? await tx
        .select({ role: householdMembers.role })
        .from(householdMembers)
        .where(and(eq(householdMembers.householdId, invitation.householdId), eq(householdMembers.userId, invitation.invitedBy)))
        .limit(1)
    : [];
  if (inviter?.role !== "owner") {
    throw new ConflictError(
      "This admin invitation is no longer valid because its sender is no longer the household owner. Ask the owner for a new invitation.",
    );
  }
}

/** One household per user, checked under the user's membership lock. */
async function assertUserHasNoHousehold(tx: TransactionType, userId: string, householdId: string): Promise<void> {
  const memberships = await tx
    .select({ householdId: householdMembers.householdId })
    .from(householdMembers)
    .where(eq(householdMembers.userId, userId));
  if (memberships.some((m) => m.householdId === householdId)) {
    throw new ConflictError("You are already a member of this household");
  }
  if (memberships.length > 0) {
    throw new ConflictError(
      "You are already a member of another household. Leave that household first to join a new one.",
    );
  }
}

export async function acceptInvitation(actor: AcceptingUser, inviteCode: string): Promise<AcceptedInvitation> {
  // Everything, the code included (a resend rotates it), is re-read under locks.
  const found = await householdRepository.findInvitationByCode(inviteCode);
  if (!found) {
    throw new NotFoundError(INVALID_CODE_MESSAGE);
  }

  return await withTransaction(async (tx) => {
    const household = await lockHouseholdRow(tx, found.householdId);
    await lockUserMembership(tx, actor.userId);
    const invitation = await lockInvitationRow(tx, found.id, inviteCode);

    await assertAddressedToUser(tx, invitation, actor.userId);
    await assertAdminInviterStillOwner(tx, invitation);
    await assertUserHasNoHousehold(tx, actor.userId, invitation.householdId);

    await tx.insert(householdMembers).values({
      householdId: invitation.householdId,
      userId: actor.userId,
      role: invitation.role,
    });
    await tx
      .update(householdInvitations)
      .set({ acceptedAt: new Date(), acceptedBy: actor.userId })
      .where(eq(householdInvitations.id, invitation.id));
    await businessAuditService.log({
      tx,
      householdId: invitation.householdId,
      userId: actor.userId,
      action: "CREATE",
      entityType: "household_member",
      entityId: actor.userId,
      details: {
        invitationId: invitation.id,
        email: invitation.email,
        role: invitation.role,
        invitedBy: invitation.invitedBy,
      },
      ipAddress: actor.ipAddress,
    });

    return { household, role: invitation.role };
  });
}
