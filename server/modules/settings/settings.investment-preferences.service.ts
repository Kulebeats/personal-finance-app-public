/**
 * NEW-26 follow-up: an investment notification preference save commits together
 * with its audit row. The write and its audit run in one transaction, so a
 * failed audit rolls the write back (Rules 9 and 10).
 */
import { businessAuditService } from "../../services/BusinessAuditService";
import { withTransaction } from "../../utils/withTransaction";
import {
  writeNotificationPreferencesInTx,
  type NotificationCreationDefaults,
  type NotificationPreferencePatch,
  type NotificationPreferenceWrite,
} from "../../repositories/UserNotificationPreferences";
import { lockAuditHousehold, type PersonalSettingsContext } from "./settings.preferences.service";

const INVESTMENT_PREFERENCE_DEFAULTS: NotificationCreationDefaults = {
  inAppEnabled: true, emailEnabled: true, pushEnabled: false,
};

/**
 * Lock order: households KEY SHARE (when audited) -> users FOR UPDATE -> the
 * preference row FOR UPDATE, the household-first order the profile save and the
 * membership paths use. With no household there is nothing to audit against, so
 * the write commits with no audit row, as this route has always done.
 */
export async function saveInvestmentNotificationPreference(
  context: PersonalSettingsContext,
  patch: NotificationPreferencePatch,
): Promise<NotificationPreferenceWrite> {
  const { userId, householdId, ipAddress } = context;
  return withTransaction(async (tx) => {
    await lockAuditHousehold(tx, householdId);
    const [write] = await writeNotificationPreferencesInTx(tx, userId, [patch], INVESTMENT_PREFERENCE_DEFAULTS);
    if (!householdId) return write;
    const { previous, updated } = write;
    if (previous) {
      await businessAuditService.logUpdate({
        householdId, userId, entityType: "user", entityId: previous.id, ipAddress, tx,
        oldValue: {
          inAppEnabled: previous.inAppEnabled,
          emailEnabled: previous.emailEnabled,
          pushEnabled: previous.pushEnabled,
        },
        newValue: {
          inAppEnabled: patch.inAppEnabled,
          emailEnabled: patch.emailEnabled,
          pushEnabled: patch.pushEnabled,
        },
        metadata: { action: "investment_notification_preference_update" },
      });
    } else {
      await businessAuditService.logCreate({
        householdId, userId, entityType: "user", entityId: updated.id, ipAddress, tx,
        newValue: {
          notificationType: patch.notificationType,
          inAppEnabled: patch.inAppEnabled ?? INVESTMENT_PREFERENCE_DEFAULTS.inAppEnabled,
          emailEnabled: patch.emailEnabled ?? INVESTMENT_PREFERENCE_DEFAULTS.emailEnabled,
          pushEnabled: patch.pushEnabled ?? INVESTMENT_PREFERENCE_DEFAULTS.pushEnabled,
        },
        metadata: { action: "investment_notification_preference_create" },
      });
    }
    return write;
  });
}
