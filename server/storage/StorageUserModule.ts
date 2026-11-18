import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  users,
  userDisplaySettings,
  userNotificationPreferences,
  userPreferences,
  userAIPreferences,
  type User,
  type InsertUser,
  type DisplaySettings,
  type InsertDisplaySettings,
  type NotificationPreference,
  type InsertNotificationPreference,
  type UserPreferences,
  type UserAIPreferences,
} from "@shared/schema";

export class StorageUserModule {
  // ============================================================================
  // USER METHODS
  // ============================================================================

  async getUser(id: string): Promise<User | undefined> {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    return result[0];
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return result[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const result = await db.insert(users).values(insertUser).returning();
    return result[0];
  }

  async updateUser(id: string, data: Partial<User>): Promise<User | undefined> {
    const result = await db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return result[0];
  }

  // ============================================================================
  // DISPLAY SETTINGS METHODS
  // ============================================================================

  async getDisplaySettings(
    userId: string
  ): Promise<DisplaySettings | undefined> {
    const result = await db
      .select()
      .from(userDisplaySettings)
      .where(eq(userDisplaySettings.userId, userId))
      .limit(1);
    return result[0];
  }

  async createDisplaySettings(
    settings: InsertDisplaySettings
  ): Promise<DisplaySettings> {
    const result = await db
      .insert(userDisplaySettings)
      .values(settings)
      .returning();
    return result[0];
  }

  async updateDisplaySettings(
    userId: string,
    data: Partial<DisplaySettings>
  ): Promise<DisplaySettings | undefined> {
    const result = await db
      .update(userDisplaySettings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(userDisplaySettings.userId, userId))
      .returning();
    return result[0];
  }

  // ============================================================================
  // NOTIFICATION PREFERENCES METHODS
  // ============================================================================

  async getNotificationPreferences(
    userId: string
  ): Promise<NotificationPreference[]> {
    return await db
      .select()
      .from(userNotificationPreferences)
      .where(eq(userNotificationPreferences.userId, userId));
  }

  async createNotificationPreference(
    pref: InsertNotificationPreference
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
    data: Partial<NotificationPreference>
  ): Promise<NotificationPreference | undefined> {
    const result = await db
      .update(userNotificationPreferences)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(userNotificationPreferences.userId, userId),
          eq(userNotificationPreferences.notificationType, notificationType)
        )
      )
      .returning();
    return result[0];
  }

  // ============================================================================
  // USER PREFERENCES METHODS
  // ============================================================================

  async getUserPreferences(
    userId: string
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
    data: Partial<UserPreferences>
  ): Promise<UserPreferences | undefined> {
    const result = await db
      .update(userPreferences)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(userPreferences.userId, userId))
      .returning();
    return result[0];
  }

  // ============================================================================
  // USER AI PREFERENCES METHODS
  // ============================================================================

  async getUserAIPreferences(
    userId: string
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
    data: Partial<UserAIPreferences>
  ): Promise<UserAIPreferences | undefined> {
    const result = await db
      .update(userAIPreferences)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(userAIPreferences.userId, userId))
      .returning();
    return result[0];
  }
}
