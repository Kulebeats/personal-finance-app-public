/**
 * Household invitation acceptance checks.
 *
 * Extracted from invitations.controller.ts (LOC ratchet). Runs before the
 * locked accept transaction; the invitation's email never changes after
 * creation, so checking it here is equivalent to checking it under the lock.
 *
 * @module modules/household/invitations.accept
 */

import { userRepository } from "../../repositories/UserRepository";
import { ConflictError, ForbiddenError } from "../../core/errors";

const EMAIL_MISMATCH_MESSAGE =
  "This invitation was sent to a different email address. Sign in with that address to accept it.";

/** Invitation emails are stored lowercased; compare every address the same way. */
export function normalizeInviteEmail(email: string): string {
  return email.toLowerCase();
}

/**
 * Throws unless the invitation is unused, unexpired and addressed to the
 * signed-in user. The mismatch error never echoes the invited address.
 */
export async function assertInvitationAcceptableBy(
  invitation: { email: string; acceptedAt: Date | null; expiresAt: Date },
  userId: string
): Promise<void> {
  if (invitation.acceptedAt) {
    throw new ConflictError("This invitation has already been used");
  }
  if (new Date() > invitation.expiresAt) {
    throw new ConflictError("This invitation has expired");
  }
  const user = await userRepository.findById(userId);
  if (
    !user?.email ||
    normalizeInviteEmail(user.email) !== normalizeInviteEmail(invitation.email)
  ) {
    throw new ForbiddenError(EMAIL_MISMATCH_MESSAGE);
  }
}
