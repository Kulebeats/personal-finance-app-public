/**
 * Quiet hours (R16.2): the writer for `user_quiet_hours` and the window check delivery uses.
 * The window is read in the user's own IANA time zone and may cross midnight.
 */
import { eq } from "drizzle-orm";
import { userQuietHours } from "@shared/schema";
import { db } from "../../db";
import { businessAuditService } from "../BusinessAuditService";
import { isWithinWindow, localTime } from "./quiet-hours-window";

export { isValidTimeZone } from "./quiet-hours-window";

export interface QuietHoursSettings {
  enabled: boolean;
  /** 24-hour HH:MM. */
  startTime: string;
  endTime: string;
  /** IANA zone name, e.g. Africa/Lusaka. */
  timezone: string;
}

export const DEFAULT_QUIET_HOURS: QuietHoursSettings = {
  enabled: false, startTime: "22:00", endTime: "07:00", timezone: "UTC",
};

const toHm = (time: string): string => time.slice(0, 5);

export async function getQuietHours(userId: string): Promise<QuietHoursSettings> {
  const [row] = await db.select().from(userQuietHours).where(eq(userQuietHours.userId, userId)).limit(1);
  if (!row) return DEFAULT_QUIET_HOURS;
  return {
    enabled: row.enabled ?? false, startTime: toHm(row.startTime), endTime: toHm(row.endTime), timezone: row.timezone,
  };
}

export async function setQuietHours(
  userId: string, input: QuietHoursSettings, context: { householdId?: string | null; ipAddress?: string },
): Promise<QuietHoursSettings> {
  const before = await getQuietHours(userId);
  const values = { enabled: input.enabled, startTime: input.startTime, endTime: input.endTime, timezone: input.timezone };
  await db.transaction(async (tx) => {
    await tx.insert(userQuietHours).values({ userId, ...values })
      .onConflictDoUpdate({ target: userQuietHours.userId, set: { ...values, updatedAt: new Date() } });
    await businessAuditService.logUpdate({
      tx, userId, householdId: context.householdId ?? null, entityType: "quiet_hours", entityId: userId,
      oldValue: { ...before }, newValue: { ...input }, ipAddress: context.ipAddress,
    });
  });
  return input;
}

export async function isInQuietHours(userId: string, at: Date = new Date()): Promise<boolean> {
  const settings = await getQuietHours(userId);
  if (!settings.enabled) return false;
  return isWithinWindow(localTime(at, settings.timezone), settings.startTime, settings.endTime);
}
