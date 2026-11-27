import { effectiveRecapEmail } from "./UserNotificationPreferences";
import { and, desc, eq, ne, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { ensureDisplaySettings, patchDisplaySettings } from "./UserDisplayPreferences";
import {
  userAIPreferences,
  userDisplaySettings,
  userLoginHistory,
  userNotificationPreferences,
  userPreferences,
  userSessions,
  users,
  type DisplaySettings,
  type InsertDisplaySettings,
  type InsertNotificationPreference,
  type InsertUser,
  type NotificationPreference,
  type User,
  type UserAIPreferences,
  type UserPreferences,
} from "@shared/schema";

export type UserCreateInput = InsertUser & { pendingEmail?: User["pendingEmail"] };

type CreateLoginHistoryInput = {
  userId: string;
  deviceName?: string;
  ipAddress?: string;
  location?: string;
  success: boolean;
  failureReason?: string;
};

type CreateUserSessionInput = {
  userId: string;
  sessionToken: string;
  deviceName?: string;
  deviceType?: string;
  browser?: string;
  os?: string;
  ipAddress?: string;
  location?: string;
  expiresAt: Date;
};

/** One address is one identity whatever its case (unique index on lower(email)). */
export const sameEmail = (email: string): SQL => sql`lower(${users.email}) = lower(${email.trim()})`;

export class UserRepository {
  async findById(id: string): Promise<User | undefined> {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return result[0];
  }

  /** Case-insensitive. While legacy case-variant rows exist, an exact match wins, then the oldest. */
  async findByEmail(email: string): Promise<User | undefined> {
    const address = email.trim();
    const result = await db
      .select()
      .from(users)
      .where(sameEmail(address))
      .orderBy(sql`${users.email} = ${address} desc`, users.createdAt)
      .limit(1);
    return result[0];
  }

  async findByUsername(username: string): Promise<User | undefined> {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    return result[0];
  }

  /**
   * @param tokenHash SHA-256 hash of the raw token (see server/core/tokenHash.ts).
   *   Callers must hash the raw token from the request before calling this -
   *   the column stores only the hash, never the raw value.
   */
  async findByVerificationToken(tokenHash: string): Promise<User | undefined> {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.emailVerificationToken, tokenHash))
      .limit(1);
    return result[0];
  }

  async create(data: UserCreateInput): Promise<User> {
    const result = await db.insert(users).values({
      ...data,
      email: data.email.trim(),
      pendingEmail: data.pendingEmail?.trim() ?? data.pendingEmail,
    }).returning();
    return result[0];
  }

  async update(id: string, data: Partial<User>): Promise<User | undefined> {
    const result = await db
      .update(users)
      .set({
        ...data,
        email: data.email?.trim() ?? data.email,
        pendingEmail: data.pendingEmail?.trim() ?? data.pendingEmail,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return result[0];
  }

  async createDisplaySettings(
    settings: InsertDisplaySettings,
  ): Promise<DisplaySettings> {
    return ensureDisplaySettings(settings);
  }

  async getDisplaySettings(
    userId: string,
  ): Promise<DisplaySettings | undefined> {
    const result = await db
      .select()
      .from(userDisplaySettings)
      .where(eq(userDisplaySettings.userId, userId))
      .limit(1);
    return result[0];
  }

  async updateDisplaySettings(
    userId: string,
    data: Partial<DisplaySettings>,
  ): Promise<DisplaySettings | undefined> {
    return patchDisplaySettings(userId, data);
  }

  async getNotificationPreferences(
    userId: string,
  ): Promise<NotificationPreference[]> {
    const rows = await db
      .select()
      .from(userNotificationPreferences)
      .where(eq(userNotificationPreferences.userId, userId));
    const emailEnabled = effectiveRecapEmail(rows.filter(row => row.notificationType === "weekly_recap"));
    return rows.map(row => row.notificationType === "weekly_recap" ? { ...row, emailEnabled } : row);
  }

  async createNotificationPreference(
    pref: InsertNotificationPreference,
  ): Promise<NotificationPreference> {
    const result = await db
      .insert(userNotificationPreferences)
      .values(pref)
      .returning();
    return result[0];
  }

  async updateNotificationPreference(
    userId: string,
    notificationType: string,
    data: Partial<NotificationPreference>,
  ): Promise<NotificationPreference | undefined> {
    const result = await db
      .update(userNotificationPreferences)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(userNotificationPreferences.userId, userId),
          eq(userNotificationPreferences.notificationType, notificationType),
        ),
      )
      .returning();
    return result[0];
  }

  async getUserPreferences(
    userId: string,
  ): Promise<UserPreferences | undefined> {
    const result = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    return result[0];
  }

  async createUserPreferences(userId: string): Promise<UserPreferences> {
    const result = await db
      .insert(userPreferences)
      .values({ userId })
      .returning();
    return result[0];
  }

  async updateUserPreferences(
    userId: string,
    data: Partial<UserPreferences>,
  ): Promise<UserPreferences | undefined> {
    const result = await db
      .update(userPreferences)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(userPreferences.userId, userId))
      .returning();
    return result[0];
  }

  async getUserAIPreferences(
    userId: string,
  ): Promise<UserAIPreferences | undefined> {
    const result = await db
      .select()
      .from(userAIPreferences)
      .where(eq(userAIPreferences.userId, userId))
      .limit(1);
    return result[0];
  }

  async createUserAIPreferences(userId: string): Promise<UserAIPreferences> {
    const result = await db
      .insert(userAIPreferences)
      .values({ userId })
      .returning();
    return result[0];
  }

  async updateUserAIPreferences(
    userId: string,
    data: Partial<UserAIPreferences>,
  ): Promise<UserAIPreferences | undefined> {
    const result = await db
      .update(userAIPreferences)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(userAIPreferences.userId, userId))
      .returning();
    return result[0];
  }

  async createLoginHistory(data: CreateLoginHistoryInput) {
    const result = await db.insert(userLoginHistory).values(data).returning();
    return result[0];
  }

  async findSessions(userId: string) {
    return await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.userId, userId))
      .orderBy(userSessions.lastActiveAt);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await db.delete(userSessions).where(eq(userSessions.id, sessionId));
  }

  async deleteAllSessionsExcept(
    userId: string,
    currentSessionId: string,
  ): Promise<void> {
    await db
      .delete(userSessions)
      .where(
        and(
          eq(userSessions.userId, userId),
          ne(userSessions.id, currentSessionId),
        ),
      );
  }

  async getLoginHistory(userId: string, limit: number = 20) {
    return await db
      .select()
      .from(userLoginHistory)
      .where(eq(userLoginHistory.userId, userId))
      .orderBy(desc(userLoginHistory.loginTime))
      .limit(limit);
  }

  async upsertSession(data: CreateUserSessionInput) {
    const result = await db
      .insert(userSessions)
      .values({
        ...data,
        lastActiveAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userSessions.sessionToken,
        set: {
          userId: data.userId,
          deviceName: data.deviceName,
          deviceType: data.deviceType,
          browser: data.browser,
          os: data.os,
          ipAddress: data.ipAddress,
          location: data.location,
          expiresAt: data.expiresAt,
          lastActiveAt: new Date(),
        },
      })
      .returning();
    return result[0];
  }
}

export const userRepository = new UserRepository();
