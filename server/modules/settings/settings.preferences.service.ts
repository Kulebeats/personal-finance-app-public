/**
 * NEW-26: a notification-preference save and a display-settings save commit
 * together with their audit rows. The write and its audit run in one
 * transaction, so a failed audit rolls the write back (Rules 9 and 10).
 */
import { eq } from "drizzle-orm";
import { households, type DisplaySettings } from "@shared/schema";
import { businessAuditService } from "../../services/BusinessAuditService";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import {
  writeNotificationPreferencesInTx,
  type NotificationCreationDefaults,
  type NotificationPreferencePatch,
  type NotificationPreferenceWrite,
} from "../../repositories/UserNotificationPreferences";
import { patchDisplaySettingsInTx } from "../../repositories/UserDisplayPreferences";

export interface PersonalSettingsContext {
  readonly userId: string;
  readonly householdId: string | null;
  readonly ipAddress?: string;
}

/**
 * The audit row's household foreign key takes KEY SHARE on the household; take it
 * before the user lock, in the household-first order the profile save and the
 * membership paths use. Defensive: the personal settings routes carry no household
 * context today, so householdId is null there and this is a no-op.
 */
async function lockAuditHousehold(tx: TransactionType, householdId: string | null): Promise<void> {
  if (!householdId) return;
  await tx.select({ id: households.id }).from(households).where(eq(households.id, householdId)).for("key share");
}

export async function saveNotificationPreferences(
  context: PersonalSettingsContext,
  patches: NotificationPreferencePatch[],
  defaults: NotificationCreationDefaults,
): Promise<NotificationPreferenceWrite[]> {
  const { userId, householdId, ipAddress } = context;
  return withTransaction(async (tx) => {
    await lockAuditHousehold(tx, householdId);
    const writes = await writeNotificationPreferencesInTx(tx, userId, patches, defaults);
    for (const [index, write] of writes.entries()) {
      const patch = patches[index];
      const audit = {
        householdId, userId, entityType: "notification_preference" as const, entityId: userId,
        ipAddress, metadata: { notificationType: patch.notificationType }, tx,
      };
      if (!write.previous) {
        await businessAuditService.logCreate({ ...audit, newValue: write.updated });
      } else {
        await businessAuditService.logUpdate({ ...audit, newValue: patch });
      }
    }
    return writes;
  });
}

export async function saveDisplaySettings(
  context: PersonalSettingsContext,
  data: Partial<DisplaySettings>,
): Promise<DisplaySettings> {
  const { userId, householdId, ipAddress } = context;
  return withTransaction(async (tx) => {
    await lockAuditHousehold(tx, householdId);
    const updated = await patchDisplaySettingsInTx(tx, userId, data);
    await businessAuditService.logUpdate({
      householdId, userId, entityType: "display_settings", entityId: userId, newValue: data, ipAddress, tx,
    });
    return updated;
  });
}
