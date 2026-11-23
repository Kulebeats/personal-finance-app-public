import { and, eq } from "drizzle-orm";
import { users, userNotificationPreferences, type NotificationPreference } from "@shared/schema";
import { db } from "../db";
import { NotFoundError } from "../core/errors";

export function effectiveRecapEmail(rows: ReadonlyArray<{ emailEnabled: boolean | null }>): boolean {
  return rows.length > 0 && rows.every(row => row.emailEnabled === true);
}

export type NotificationPreferencePatch = {
  notificationType: string;
  inAppEnabled?: boolean;
  emailEnabled?: boolean;
  pushEnabled?: boolean;
  thresholdAmount?: string | null;
};

export type NotificationCreationDefaults = {
  inAppEnabled: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
};

export type NotificationPreferenceWrite = {
  previous?: NotificationPreference;
  updated: NotificationPreference;
};

/** All live preference writers lock this existing row before reading or creating a preference. */
export async function writeNotificationPreferences(
  userId: string,
  patches: NotificationPreferencePatch[],
  defaults: NotificationCreationDefaults,
): Promise<NotificationPreferenceWrite[]> {
  return db.transaction(async tx => {
    const [user] = await tx.select({ id: users.id }).from(users)
      .where(eq(users.id, userId)).for("update");
    if (!user) throw new NotFoundError("User not found");

    const writes: NotificationPreferenceWrite[] = [];
    for (const patch of patches) {
      const condition = and(
        eq(userNotificationPreferences.userId, userId),
        eq(userNotificationPreferences.notificationType, patch.notificationType),
      );
      const rows = await tx.select().from(userNotificationPreferences).where(condition).orderBy(userNotificationPreferences.id).for("update");
      const previous = rows[0];

      if (previous) {
        const [updated] = await tx.update(userNotificationPreferences).set({
          inAppEnabled: patch.inAppEnabled,
          emailEnabled: patch.emailEnabled,
          pushEnabled: patch.pushEnabled,
          thresholdAmount: patch.thresholdAmount,
          updatedAt: new Date(),
        }).where(eq(userNotificationPreferences.id, previous.id)).returning();
        if (patch.notificationType === "weekly_recap" && rows.length > 1) {
          if (patch.emailEnabled !== undefined) {
            await tx.update(userNotificationPreferences).set({ emailEnabled: patch.emailEnabled, updatedAt: new Date() }).where(condition);
          }
          const emailEnabled = effectiveRecapEmail(rows);
          writes.push({ previous: { ...previous, emailEnabled }, updated: { ...updated, emailEnabled: patch.emailEnabled ?? emailEnabled } });
        } else {
          writes.push({ previous, updated });
        }
      } else {
        const [updated] = await tx.insert(userNotificationPreferences).values({
          userId,
          notificationType: patch.notificationType,
          inAppEnabled: patch.inAppEnabled ?? defaults.inAppEnabled,
          emailEnabled: patch.emailEnabled ?? defaults.emailEnabled,
          pushEnabled: patch.pushEnabled ?? defaults.pushEnabled,
          thresholdAmount: patch.thresholdAmount ?? null,
        }).returning();
        writes.push({ updated });
      }
    }
    return writes;
  });
}
