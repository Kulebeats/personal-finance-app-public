import { effectiveRecapEmail } from "./UserNotificationPreferences";
import { and, eq } from "drizzle-orm";
import {
  users,
  userDisplaySettings,
  userNotificationPreferences,
  type DisplaySettings,
  type InsertDisplaySettings,
} from "@shared/schema";
import { NOTIFICATION_TYPES } from "@shared/notificationTypes";
import { db } from "../db";
import { NotFoundError } from "../core/errors";
import { mergeReportWidgetPreferences, resetReportWidgetLayout, type StoredReportWidgetPreferencesPatch } from "./ReportWidgetPreferences";

type PreferencesTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type WeeklyRecapSettings = {
  enabled: boolean;
  emailEnabled: boolean;
  dayOfWeek: number;
  includeGoals: boolean;
  includeRecurring: boolean;
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function lockUser(tx: PreferencesTransaction, userId: string, mode: "update" | "share" = "update") {
  const [user] = await tx.select({ id: users.id }).from(users)
    .where(eq(users.id, userId)).for(mode);
  if (!user) throw new NotFoundError("User not found");
}

async function ensureDisplayRow(tx: PreferencesTransaction, settings: InsertDisplaySettings) {
  await tx.insert(userDisplaySettings).values(settings)
    .onConflictDoNothing({ target: userDisplaySettings.userId });
  const [display] = await tx.select().from(userDisplaySettings)
    .where(eq(userDisplaySettings.userId, settings.userId)).for("update");
  return display;
}

/** The existing user row orders writers even before a preferences row exists. */
export async function ensureDisplaySettings(settings: InsertDisplaySettings): Promise<DisplaySettings> {
  return db.transaction(async tx => {
    await lockUser(tx, settings.userId);
    return ensureDisplayRow(tx, settings);
  });
}

export async function patchDisplaySettings(userId: string, data: Partial<DisplaySettings>): Promise<DisplaySettings> {
  return db.transaction(async tx => {
    await lockUser(tx, userId);
    const current = await ensureDisplayRow(tx, { userId });
    const patch = { ...data };
    if (data.dashboardWidgets !== undefined) {
      const supplied = record(data.dashboardWidgets);
      const dashboard = { ...record(current.dashboardWidgets) };
      // This endpoint owns the layout fields. Recap and future siblings retain
      // the values read under the lock, regardless of an older open form.
      if (supplied.widgets !== undefined) dashboard.widgets = supplied.widgets;
      if (supplied.version !== undefined) dashboard.version = supplied.version;
      patch.dashboardWidgets = dashboard;
    }
    const [updated] = await tx.update(userDisplaySettings)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(userDisplaySettings.userId, userId)).returning();
    return updated;
  });
}

export async function patchReportWidgetPreferences(userId: string, data: StoredReportWidgetPreferencesPatch) {
  return db.transaction(async tx => {
    await lockUser(tx, userId);
    const display = await ensureDisplayRow(tx, { userId });
    const preferences = mergeReportWidgetPreferences(display.reportWidgetPreferences, data);
    await tx.update(userDisplaySettings).set({
      reportWidgetPreferences: preferences,
      updatedAt: new Date(),
    }).where(eq(userDisplaySettings.userId, userId));
    return preferences;
  });
}

export async function resetReportWidgetPreferences(userId: string) {
  return db.transaction(async tx => {
    await lockUser(tx, userId);
    const display = await ensureDisplayRow(tx, { userId });
    const preferences = resetReportWidgetLayout(display.reportWidgetPreferences);
    await tx.update(userDisplaySettings).set({
      reportWidgetPreferences: preferences,
      updatedAt: new Date(),
    }).where(eq(userDisplaySettings.userId, userId));
    return preferences;
  });
}

// OPS-007: with no saved day the recap e-mail goes out on Monday, so settings show Monday.
const DEFAULT_RECAP_DAY = 1;

function recapPreference(userId: string) {
  return and(
    eq(userNotificationPreferences.userId, userId),
    eq(userNotificationPreferences.notificationType, NOTIFICATION_TYPES.WEEKLY_RECAP),
  );
}

function recapSettings(
  dashboardWidgets: unknown,
  preference: { inAppEnabled: boolean | null; emailEnabled: boolean | null } | undefined,
): WeeklyRecapSettings {
  const stored = record(record(dashboardWidgets).weeklyRecap);
  return {
    enabled: preference?.inAppEnabled ?? true,
    emailEnabled: preference?.emailEnabled ?? false,
    dayOfWeek: typeof stored.dayOfWeek === "number" && Number.isInteger(stored.dayOfWeek)
      && stored.dayOfWeek >= 0 && stored.dayOfWeek <= 6 ? stored.dayOfWeek : DEFAULT_RECAP_DAY,
    includeGoals: typeof stored.includeGoals === "boolean" ? stored.includeGoals : true,
    includeRecurring: typeof stored.includeRecurring === "boolean" ? stored.includeRecurring : true,
  };
}

export async function getWeeklyRecapSettings(userId: string): Promise<WeeklyRecapSettings> {
  return db.transaction(async tx => {
    // The shared user lock keeps both table reads on one committed settings
    // version while allowing concurrent readers.
    await lockUser(tx, userId, "share");
    const [display] = await tx.select().from(userDisplaySettings)
      .where(eq(userDisplaySettings.userId, userId));
    const rows = await tx.select().from(userNotificationPreferences)
      .where(recapPreference(userId)).orderBy(userNotificationPreferences.id);
    return recapSettings(display?.dashboardWidgets, { inAppEnabled: rows[0]?.inAppEnabled ?? null, emailEnabled: effectiveRecapEmail(rows) });
  });
}

export async function patchWeeklyRecapSettings(
  userId: string,
  data: Partial<WeeklyRecapSettings>,
): Promise<WeeklyRecapSettings> {
  return db.transaction(async tx => {
    await lockUser(tx, userId);
    const display = await ensureDisplayRow(tx, { userId });
    const rows = await tx.select().from(userNotificationPreferences)
      .where(recapPreference(userId)).orderBy(userNotificationPreferences.id).for("update");
    let preference = rows[0];

    if (!preference) {
      [preference] = await tx.insert(userNotificationPreferences).values({
        userId,
        notificationType: NOTIFICATION_TYPES.WEEKLY_RECAP,
        inAppEnabled: data.enabled ?? true,
        emailEnabled: data.emailEnabled ?? false,
        pushEnabled: false,
      }).returning();
    } else if (data.enabled !== undefined || data.emailEnabled !== undefined) {
      [preference] = await tx.update(userNotificationPreferences).set({
        inAppEnabled: data.enabled,
        emailEnabled: data.emailEnabled,
        updatedAt: new Date(),
      }).where(eq(userNotificationPreferences.id, preference.id)).returning();
    }

    if (rows.length > 1 && data.emailEnabled !== undefined) {
      await tx.update(userNotificationPreferences).set({ emailEnabled: data.emailEnabled, updatedAt: new Date() })
        .where(recapPreference(userId));
    }
    const current = recapSettings(display.dashboardWidgets, {
      ...preference, emailEnabled: data.emailEnabled ?? (rows.length ? effectiveRecapEmail(rows) : preference.emailEnabled),
    });
    const next = { ...current, ...data };
    if (data.dayOfWeek !== undefined || data.includeGoals !== undefined || data.includeRecurring !== undefined) {
      const dashboard = record(display.dashboardWidgets);
      await tx.update(userDisplaySettings).set({
        dashboardWidgets: {
          ...dashboard,
          weeklyRecap: {
            ...record(dashboard.weeklyRecap),
            // OPS-007: a day is saved only when the user picks one, so "none saved" stays Monday.
            ...(data.dayOfWeek !== undefined ? { dayOfWeek: data.dayOfWeek } : {}),
            includeGoals: next.includeGoals,
            includeRecurring: next.includeRecurring,
          },
        },
        updatedAt: new Date(),
      }).where(eq(userDisplaySettings.userId, userId));
    }
    return next;
  });
}
