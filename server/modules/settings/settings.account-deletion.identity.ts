import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { TransactionType } from "../../utils/withTransaction";
import { revokeUserSessions } from "../../services/session-revocation";
import { purgeErasedSipAuthorizations } from "./settings.account-deletion.sip";
import {
  users, userLoginHistory, passwordHistory, userPushSubscriptions,
  userQuietHours, csdAccounts, userTwoFactorAuth, userAIPreferences,
  userPreferences, userDisplaySettings, userNotificationPreferences, notifications, passwordResetTokens, investmentOpeningOperationReceipts, investmentHoldingDeletionReceipts,
  weeklyRecapFeedback,
} from "@shared/schema";
export async function anonymiseUser(
  tx: TransactionType,
  userId: string,
): Promise<string> {
  const marker = randomUUID();
  const tombstoneEmail = `deleted_${marker}@deleted.invalid`;

  // Remove dependent user-scoped rows that hold PII or auth material.
  await revokeUserSessions(tx, userId);
  await tx.delete(userLoginHistory).where(eq(userLoginHistory.userId, userId));
  await tx.delete(passwordHistory).where(eq(passwordHistory.userId, userId));
  await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
  await tx
    .delete(userPushSubscriptions)
    .where(eq(userPushSubscriptions.userId, userId));
  await tx.delete(userQuietHours).where(eq(userQuietHours.userId, userId));
  await tx.delete(csdAccounts).where(eq(csdAccounts.userId, userId));
  await tx
    .delete(userTwoFactorAuth)
    .where(eq(userTwoFactorAuth.userId, userId));
  await tx.delete(userAIPreferences).where(eq(userAIPreferences.userId, userId));
  await tx.delete(userPreferences).where(eq(userPreferences.userId, userId));
  await tx
    .delete(userDisplaySettings)
    .where(eq(userDisplaySettings.userId, userId));
  await tx
    .delete(userNotificationPreferences)
    .where(eq(userNotificationPreferences.userId, userId));
  await tx.delete(notifications).where(eq(notifications.userId, userId));
  // A-39: recap feedback (with its free-text comment) is the member's own
  // words. In a shared household the tombstone keeps the user row, so the
  // FK cascade never runs; delete it here, in every household.
  await tx.delete(weeklyRecapFeedback).where(eq(weeklyRecapFeedback.userId, userId));

  await tx
    .update(users)
    .set({
      username: `deleted_${marker}`,
      erasedAt: new Date(),
      email: tombstoneEmail,
      passwordHash: `!erased!${marker}`,
      emailVerified: false,
      emailVerificationToken: null,
      emailVerificationExpiry: null,
      pendingEmail: null,
      fullName: null,
      firstName: null,
      lastName: null,
      displayName: null,
      birthday: null,
      birthdayHideYear: false,
      gender: null,
      phoneNumber: null,
      phoneNumberMobile: null,
      phoneNumberWork: null,
      phoneNumberHome: null,
      address: null,
      occupation: null,
      company: null,
      profilePictureUrl: null,
      bannerUrl: null,
      bio: null,
      socialLinks: null,
      nrc: null,
      annualIncome: null,
      incomeFrequency: null,
      employmentStatus: null,
      investmentGoal: null,
      riskTolerance: null,
      profileCompleteness: 0,
      mfaEnabled: false,
      mfaMethod: null,
      mfaCode: null,
      mfaCodeExpiry: null,
      mfaBackupCodes: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  // Owner policy: retry records belong to this actor and are erased, including
  // records from historical households. Marking the locked identity first is
  // the database guard's admission boundary; purge failure rolls back erasure.
  await tx.delete(investmentOpeningOperationReceipts).where(eq(investmentOpeningOperationReceipts.actorUserId, userId));
  await tx.delete(investmentHoldingDeletionReceipts).where(eq(investmentHoldingDeletionReceipts.actorUserId, userId));
  await purgeErasedSipAuthorizations(tx, userId);
  return tombstoneEmail;
}

