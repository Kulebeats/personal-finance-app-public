import type { Request } from "express";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { userRepository } from "../../repositories/UserRepository";
import { hashPassword, verifyPassword } from "../../auth";
import { ValidationError, UnauthorizedError, InvalidCredentialsError } from "../../core/errors";
import { withTransaction } from "../../utils/withTransaction";
import { lockCurrentSessionCredential } from "../../services/session-identity";
import { revokeUserSessions } from "../../services/session-revocation";
import { assertPasswordNotReused, recordPasswordInHistory } from "../auth/auth.password-history";
import { passwordPolicySchema } from "../auth/auth.password-policy";
import { businessAuditService } from "../../services/BusinessAuditService";
import { enqueueSecurityNotice } from "../../services/security-notice";

export async function changeOwnPassword(req: Request, currentPassword: string, newPassword: string): Promise<void> {
  const policy = passwordPolicySchema.safeParse(newPassword);
  if (!policy.success) throw new ValidationError("Password does not meet complexity requirements");
  const snapshot = await userRepository.findById(req.session.userId!);
  if (!snapshot?.passwordHash) throw new UnauthorizedError("Authentication changed; sign in again");
  if (!await verifyPassword(currentPassword, snapshot.passwordHash)) throw new InvalidCredentialsError("Current password is incorrect");
  const newHash = await hashPassword(newPassword);
  await withTransaction(async (tx) => {
    const current = await lockCurrentSessionCredential(tx, snapshot, req.sessionID, req.session.securityGeneration);
    await assertPasswordNotReused(tx, current, newPassword);
    await recordPasswordInHistory(current.id, current.passwordHash, tx);
    await tx.update(users).set({ passwordHash: newHash,
      // A copied change-address bearer must not outlive credential recovery.
      // Initial verification is a separate purpose and is never activated here.
      ...(current.pendingEmail !== null ? { pendingEmail: null, emailVerificationToken: null, emailVerificationExpiry: null } : {}),
      updatedAt: new Date() }).where(eq(users.id, current.id));
    await revokeUserSessions(tx, current.id, { exceptSessionId: req.sessionID });
    await enqueueSecurityNotice(tx, current, req, { eventType: "PASSWORD_CHANGE", kind: "password_changed",
      recipients: [current.email], action: "password_change", sessionsRevoked: true });
    await businessAuditService.logUpdate({ householdId: null, userId: current.id, entityType: "user", entityId: current.id,
      newValue: { action: "password_change", otherSessionsRevoked: true }, ipAddress: businessAuditService.getIpAddress(req), tx });
  });
}
