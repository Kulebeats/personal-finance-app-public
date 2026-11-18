import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { StorageCategoryModule } from "./StorageCategoryModule";

export class StorageSessionModule extends StorageCategoryModule {
  // ============================================================================
  // SESSION METHODS
  // ============================================================================

  async getUserSessions(userId: string) {
    const { userSessions } = await import("@shared/schema");
    return await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.userId, userId))
      .orderBy(userSessions.lastActiveAt);
  }

  async deleteSession(sessionId: string) {
    const { userSessions } = await import("@shared/schema");
    await db.delete(userSessions).where(eq(userSessions.id, sessionId));
  }

  async deleteAllUserSessionsExcept(userId: string, currentSessionId: string) {
    const { userSessions } = await import("@shared/schema");
    const { ne } = await import("drizzle-orm");
    await db
      .delete(userSessions)
      .where(
        and(
          eq(userSessions.userId, userId),
          ne(userSessions.id, currentSessionId)
        )
      );
  }

  async createUserSession(data: {
    userId: string;
    sessionToken: string;
    deviceName?: string;
    deviceType?: string;
    browser?: string;
    os?: string;
    ipAddress?: string;
    location?: string;
    expiresAt: Date;
  }) {
    const { userSessions } = await import("@shared/schema");
    const result = await db
      .insert(userSessions)
      .values({
        ...data,
        lastActiveAt: new Date(),
      })
      // If this session token already exists (e.g., reused cookie after server restart),
      // update the record instead of throwing a duplicate key error.
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

  // ============================================================================
  // LOGIN HISTORY METHODS
  // ============================================================================

  async getLoginHistory(userId: string, limit: number = 20) {
    const { userLoginHistory } = await import("@shared/schema");
    const { desc } = await import("drizzle-orm");
    return await db
      .select()
      .from(userLoginHistory)
      .where(eq(userLoginHistory.userId, userId))
      .orderBy(desc(userLoginHistory.loginTime))
      .limit(limit);
  }

  async createLoginHistory(data: {
    userId: string;
    deviceName?: string;
    ipAddress?: string;
    location?: string;
    success: boolean;
    failureReason?: string;
  }) {
    const { userLoginHistory } = await import("@shared/schema");
    const result = await db.insert(userLoginHistory).values(data).returning();
    return result[0];
  }
}
