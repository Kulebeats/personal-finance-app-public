import { db } from "../db";
import { securityAuditLogs } from "../../shared/schema";
import { eq, and, gte, lte, desc, type SQL } from "drizzle-orm";
import { logger } from "../utils/logger";

/**
 * Audit Event Types
 */
export enum AuditEventType {
  // Authentication
  REGISTER = "REGISTER",
  LOGIN_SUCCESS = "LOGIN_SUCCESS",
  LOGIN_FAILED = "LOGIN_FAILED",
  LOGOUT = "LOGOUT",

  // Password
  PASSWORD_CHANGE = "PASSWORD_CHANGE",
  PASSWORD_RESET_REQUEST = "PASSWORD_RESET_REQUEST",
  PASSWORD_RESET_COMPLETE = "PASSWORD_RESET_COMPLETE",

  // MFA
  MFA_ENABLED = "MFA_ENABLED",
  MFA_DISABLED = "MFA_DISABLED",
  /** AH-11: a disable attempt refused because MFA is mandatory after the grace. */
  MFA_DISABLE_REFUSED = "MFA_DISABLE_REFUSED",
  MFA_VERIFIED = "MFA_VERIFIED",
  MFA_FAILED = "MFA_FAILED",
  MFA_BACKUP_CODES_REGENERATED = "MFA_BACKUP_CODES_REGENERATED",

  // Account Security
  ACCOUNT_LOCKED = "ACCOUNT_LOCKED",
  ACCOUNT_UNLOCKED = "ACCOUNT_UNLOCKED",

  // Roles
  ROLE_ASSIGNED = "ROLE_ASSIGNED",
  ROLE_REMOVED = "ROLE_REMOVED",

  // Sessions
  SESSION_TERMINATED = "SESSION_TERMINATED",
  SESSION_TERMINATED_ALL = "SESSION_TERMINATED_ALL",

  // Profile
  EMAIL_CHANGED = "EMAIL_CHANGED",
  EMAIL_VERIFIED = "EMAIL_VERIFIED",
}

export interface AuditLogEntry {
  eventType: AuditEventType | string;
  userId?: string;
  targetUserId?: string;
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
}

export interface AuditFilters {
  eventType?: string;
  userId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

class AuditService {
  /**
   * Log an audit event
   */
  async log(entry: AuditLogEntry): Promise<void> {
    try {
      await db.insert(securityAuditLogs).values({
        eventType: entry.eventType,
        userId: entry.userId,
        targetUserId: entry.targetUserId,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        details: entry.details,
      });

      logger.debug("Audit event logged", {
        eventType: entry.eventType,
        userId: entry.userId?.substring(0, 8) + "...",
      });
    } catch (error) {
      // Don't let audit logging failures break the main flow
      logger.error(
        "Failed to log audit event",
        {
          eventType: entry.eventType,
        },
        error as Error
      );
    }
  }

  /**
   * Get audit logs with filters
   */
  async getEvents(
    filters: AuditFilters = {}
  ): Promise<(typeof securityAuditLogs.$inferSelect)[]> {
    const conditions: SQL[] = [];

    if (filters.eventType) {
      conditions.push(eq(securityAuditLogs.eventType, filters.eventType));
    }

    if (filters.userId) {
      conditions.push(eq(securityAuditLogs.userId, filters.userId));
    }

    if (filters.startDate) {
      conditions.push(gte(securityAuditLogs.createdAt, filters.startDate));
    }

    if (filters.endDate) {
      conditions.push(lte(securityAuditLogs.createdAt, filters.endDate));
    }

    const query = db
      .select()
      .from(securityAuditLogs)
      .orderBy(desc(securityAuditLogs.createdAt))
      .limit(filters.limit || 100)
      .offset(filters.offset || 0);

    if (conditions.length > 0) {
      return query.where(and(...conditions));
    }

    return query;
  }

  /**
   * Helper to create log entry from Express request
   */
  fromRequest(
    req: {
      ip?: string;
      socket?: { remoteAddress?: string };
      headers?: Record<string, any>;
      session?: { userId?: string };
    },
    eventType: AuditEventType,
    details?: Record<string, unknown>
  ): AuditLogEntry {
    return {
      eventType,
      userId: req.session?.userId,
      ipAddress: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers?.["user-agent"],
      details,
    };
  }
}

export const auditService = new AuditService();
