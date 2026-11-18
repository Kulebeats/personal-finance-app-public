/**
 * SessionService - Unified session management service
 *
 * This service wraps express-session and user_sessions table operations
 * to provide consistent session management and audit logging.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
 */

import { db } from "../db";
import { userSessions } from "@shared/schema";
import { eq, and, ne } from "drizzle-orm";
import { logger } from "../utils/logger";

/**
 * Device information for session tracking
 */
export interface DeviceInfo {
  deviceName?: string;
  deviceType?: string;
  browser?: string;
  os?: string;
  ipAddress?: string;
  location?: string;
}

/**
 * Session data returned by the service
 */
export interface Session {
  id: string;
  userId: string;
  sessionToken: string;
  deviceName?: string | null;
  deviceType?: string | null;
  browser?: string | null;
  os?: string | null;
  ipAddress?: string | null;
  location?: string | null;
  isTrusted: boolean | null;
  lastActiveAt: Date | null;
  expiresAt: Date;
  createdAt: Date | null;
}

/**
 * Audit log entry for session operations
 */
interface SessionAuditLog {
  operation: "create" | "destroy" | "destroyAll";
  userId: string;
  sessionId?: string;
  timestamp: Date;
  details?: Record<string, unknown>;
}

/**
 * SessionService class
 */
export class SessionService {
  private auditLogs: SessionAuditLog[] = [];

  /**
   * Create a new session
   * Records device info, IP, and timestamp
   *
   * Requirement 12.2
   */
  async createSession(
    userId: string,
    sessionToken: string,
    deviceInfo: DeviceInfo,
    expiresAt: Date
  ): Promise<Session> {
    const session = await db
      .insert(userSessions)
      .values({
        userId,
        sessionToken,
        deviceName: deviceInfo.deviceName,
        deviceType: deviceInfo.deviceType,
        browser: deviceInfo.browser,
        os: deviceInfo.os,
        ipAddress: deviceInfo.ipAddress,
        location: deviceInfo.location,
        isTrusted: false,
        lastActiveAt: new Date(),
        expiresAt,
      })
      .returning();

    // Log the operation for audit purposes
    this.logAudit({
      operation: "create",
      userId,
      sessionId: session[0].id,
      timestamp: new Date(),
      details: {
        deviceInfo,
        expiresAt,
      },
    });

    return session[0] as Session;
  }

  /**
   * Destroy a specific session by session token
   *
   * Requirement 12.3
   */
  async destroySession(sessionToken: string): Promise<void> {
    // Get session info before deleting for audit log
    const session = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.sessionToken, sessionToken))
      .limit(1);

    if (session.length > 0) {
      await db
        .delete(userSessions)
        .where(eq(userSessions.sessionToken, sessionToken));

      // Log the operation for audit purposes
      this.logAudit({
        operation: "destroy",
        userId: session[0].userId!,
        sessionId: session[0].id,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Destroy all sessions for a user except the current one
   *
   * Requirement 12.4
   */
  async destroyAllExcept(
    userId: string,
    currentSessionToken: string
  ): Promise<number> {
    // Get sessions that will be deleted for audit log
    const sessionsToDelete = await db
      .select()
      .from(userSessions)
      .where(
        and(
          eq(userSessions.userId, userId),
          ne(userSessions.sessionToken, currentSessionToken)
        )
      );

    const deletedCount = sessionsToDelete.length;

    if (deletedCount > 0) {
      await db
        .delete(userSessions)
        .where(
          and(
            eq(userSessions.userId, userId),
            ne(userSessions.sessionToken, currentSessionToken)
          )
        );

      // Log the operation for audit purposes
      this.logAudit({
        operation: "destroyAll",
        userId,
        timestamp: new Date(),
        details: {
          deletedCount,
          preservedSession: currentSessionToken,
        },
      });
    }

    return deletedCount;
  }

  /**
   * Get all active sessions for a user
   *
   * Requirement 12.1
   */
  async getActiveSessions(userId: string): Promise<Session[]> {
    const sessions = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.userId, userId))
      .orderBy(userSessions.lastActiveAt);

    return sessions as Session[];
  }

  /**
   * Update session last active timestamp
   */
  async updateLastActive(sessionToken: string): Promise<void> {
    await db
      .update(userSessions)
      .set({ lastActiveAt: new Date() })
      .where(eq(userSessions.sessionToken, sessionToken));
  }

  /**
   * Mark a session as trusted
   */
  async markSessionTrusted(sessionToken: string): Promise<void> {
    await db
      .update(userSessions)
      .set({ isTrusted: true })
      .where(eq(userSessions.sessionToken, sessionToken));
  }

  /**
   * Log session operation for audit purposes
   *
   * Requirement 12.5
   */
  private logAudit(log: SessionAuditLog): void {
    this.auditLogs.push(log);

    // In production, this would write to a persistent audit log
    // For now, we log to console
    logger.info("Session audit", {
      operation: log.operation,
      userId: log.userId?.substring(0, 8) + "...",
      sessionId: log.sessionId?.substring(0, 8) + "...",
      timestamp: log.timestamp.toISOString(),
    });
  }

  /**
   * Get audit logs (for testing and monitoring)
   *
   * Requirement 12.5
   */
  getAuditLogs(): SessionAuditLog[] {
    return [...this.auditLogs];
  }

  /**
   * Clear audit logs (for testing)
   */
  clearAuditLogs(): void {
    this.auditLogs = [];
  }
}

// Export singleton instance
export const sessionService = new SessionService();
