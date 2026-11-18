import { Router } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logger } from "../utils/logger";
import { requireAuth } from "../auth";
import { requireAnySystemRole } from "../middleware/systemRoleGuard";
import { generalLimiter } from "../middleware/rateLimit";

const router = Router();

// SEC-RATE-004: Apply rate limiting to admin routes
router.use(generalLimiter);

// Apply authentication and system role check to all admin routes
router.use(requireAuth);
router.use(requireAnySystemRole());

/**
 * GET /api/admin/calculation-shadow-status
 *
 * Returns status of the shadow mode testing.
 * Includes match rates and recent discrepancies.
 */
router.get("/calculation-shadow-status", async (req, res) => {
  try {
    // 1. Get stats from calculation_logs
    // We assume 'execution_mode' = 'shadow_comparison' for discrepancies
    // or standard logs otherwise. This is a simplified view.

    // Total calculations today
    const stats = await db.execute(sql`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN error_code IS NOT NULL THEN 1 ELSE 0 END) as errors,
            AVG(execution_time_ms) as avg_latency
        FROM calculation_logs
        WHERE timestamp > NOW() - INTERVAL '24 hours'
    `);

    // Mismatches (logged as errors with specific context in our current simple implementation)
    // In a real system, we might query a separate shadow_results table.
    // Here we look for logs with error_message like "Shadow mismatch%"
    const mismatches = await db.execute(sql`
        SELECT *
        FROM calculation_logs
        WHERE error_message LIKE 'Shadow mismatch%'
        ORDER BY timestamp DESC
        LIMIT 10
    `);

    res.json({
      enabled: true, // Hardcoded for now until feature flags are properly stored
      last24Hours: {
        total: parseInt((stats.rows[0].total as string) || "0"),
        errors: parseInt((stats.rows[0].errors as string) || "0"),
        avgLatencyMs: parseFloat((stats.rows[0].avg_latency as string) || "0"),
      },
      recentMismatches: mismatches.rows.map((row) => ({
        timestamp: row.timestamp,
        function: row.function_name,
        details: row.error_message,
      })),
    });
  } catch (error) {
    logger.error(
      "Failed to get shadow status",
      { requestId: req.requestId },
      error as Error
    );
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ============================================================================
// SYSTEM ROLE MANAGEMENT ENDPOINTS
// ============================================================================

import { eq } from "drizzle-orm";
import { systemRoles, userSystemRoles, users } from "../../shared/schema";
import { requireSuperAdmin } from "../middleware/systemRoleGuard";
import { z } from "zod";

/**
 * GET /api/admin/system-roles
 * List all available system roles
 */
router.get("/system-roles", async (req, res) => {
  try {
    const roles = await db.select().from(systemRoles);
    res.json({
      success: true,
      data: { roles },
    });
  } catch (error) {
    logger.error(
      "Failed to get system roles",
      { requestId: req.requestId },
      error as Error
    );
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Failed to get system roles" },
    });
  }
});

/**
 * GET /api/admin/users
 * List all users with their system roles
 */
router.get("/users", async (req, res) => {
  try {
    const allUsers = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        fullName: users.fullName,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(users.createdAt);

    // Get roles for each user
    const usersWithRoles = await Promise.all(
      allUsers.map(async (user) => {
        const roles = await db
          .select({ roleName: systemRoles.name, roleId: systemRoles.id })
          .from(userSystemRoles)
          .innerJoin(systemRoles, eq(userSystemRoles.roleId, systemRoles.id))
          .where(eq(userSystemRoles.userId, user.id));

        return {
          ...user,
          systemRoles: roles,
        };
      })
    );

    res.json({
      success: true,
      data: { users: usersWithRoles },
    });
  } catch (error) {
    logger.error(
      "Failed to get users",
      { requestId: req.requestId },
      error as Error
    );
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Failed to get users" },
    });
  }
});

const assignRoleSchema = z.object({
  roleId: z.string().uuid(),
});

/**
 * POST /api/admin/users/:id/roles
 * Assign a system role to a user (super_admin only)
 */
router.post("/users/:id/roles", requireSuperAdmin(), async (req, res) => {
  try {
    const { id: userId } = req.params;
    const parseResult = assignRoleSchema.safeParse(req.body);

    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Invalid role ID" },
      });
    }

    const { roleId } = parseResult.data;

    // Check if user exists
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (user.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "User not found" },
      });
    }

    // Check if role exists
    const role = await db
      .select()
      .from(systemRoles)
      .where(eq(systemRoles.id, roleId))
      .limit(1);
    if (role.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Role not found" },
      });
    }

    // Assign role
    await db
      .insert(userSystemRoles)
      .values({
        userId,
        roleId,
        grantedBy: req.session.userId,
      })
      .onConflictDoNothing();

    logger.info("System role assigned", {
      requestId: req.requestId,
      targetUserId: userId.substring(0, 8) + "...",
      roleName: role[0].name,
      grantedBy: req.session.userId?.substring(0, 8) + "...",
    });

    res.json({
      success: true,
      message: `Role "${role[0].name}" assigned to user`,
    });
  } catch (error) {
    logger.error(
      "Failed to assign role",
      { requestId: req.requestId },
      error as Error
    );
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Failed to assign role" },
    });
  }
});

/**
 * DELETE /api/admin/users/:id/roles/:roleId
 * Remove a system role from a user (super_admin only)
 */
router.delete(
  "/users/:id/roles/:roleId",
  requireSuperAdmin(),
  async (req, res) => {
    try {
      const { id: userId, roleId } = req.params;

      // Get role name for logging
      const role = await db
        .select()
        .from(systemRoles)
        .where(eq(systemRoles.id, roleId))
        .limit(1);

      const result = await db
        .delete(userSystemRoles)
        .where(eq(userSystemRoles.userId, userId))
        .returning();

      // Filter by roleId after the fact since AND is tricky
      const deleted = result.filter((r) => r.roleId === roleId);

      if (deleted.length === 0) {
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Role assignment not found" },
        });
      }

      logger.info("System role removed", {
        requestId: req.requestId,
        targetUserId: userId.substring(0, 8) + "...",
        roleName: role[0]?.name || "unknown",
        removedBy: req.session.userId?.substring(0, 8) + "...",
      });

      res.json({
        success: true,
        message: "Role removed from user",
      });
    } catch (error) {
      logger.error(
        "Failed to remove role",
        { requestId: req.requestId },
        error as Error
      );
      res.status(500).json({
        success: false,
        error: { code: "SERVER_ERROR", message: "Failed to remove role" },
      });
    }
  }
);

// ============================================================================
// AUDIT LOGS ENDPOINT
// ============================================================================

import {
  auditService,
  AuditEventType,
  type AuditFilters,
} from "../services/AuditService";

/**
 * GET /api/admin/audit-logs
 * Get security audit logs with filtering
 */
router.get("/audit-logs", async (req, res) => {
  try {
    const { eventType, userId, startDate, endDate, limit, offset } = req.query;

    // SEC-VALID-001: Validate query parameters to prevent injection
    const filters: AuditFilters = {};

    // Validate eventType against known types
    if (eventType) {
      const validEventTypes = Object.values(AuditEventType);
      if (!validEventTypes.includes(eventType as AuditEventType)) {
        return res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Invalid event type" },
        });
      }
      filters.eventType = eventType as string;
    }

    // Validate userId is a valid UUID
    if (userId) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(userId as string)) {
        return res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Invalid user ID format" },
        });
      }
      filters.userId = userId as string;
    }

    // Validate dates
    if (startDate) {
      const date = new Date(startDate as string);
      if (isNaN(date.getTime())) {
        return res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Invalid start date" },
        });
      }
      filters.startDate = date;
    }
    if (endDate) {
      const date = new Date(endDate as string);
      if (isNaN(date.getTime())) {
        return res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Invalid end date" },
        });
      }
      filters.endDate = date;
    }

    // Validate and sanitize limit/offset
    if (limit) {
      const parsedLimit = parseInt(limit as string, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
        return res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Limit must be between 1 and 1000" },
        });
      }
      filters.limit = parsedLimit;
    }
    if (offset) {
      const parsedOffset = parseInt(offset as string, 10);
      if (isNaN(parsedOffset) || parsedOffset < 0) {
        return res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Offset must be a non-negative number" },
        });
      }
      filters.offset = parsedOffset;
    }

    const logs = await auditService.getEvents(filters);

    res.json({
      success: true,
      data: {
        logs,
        eventTypes: Object.values(AuditEventType),
      },
    });
  } catch (error) {
    logger.error(
      "Failed to get audit logs",
      { requestId: req.requestId },
      error as Error
    );
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Failed to get audit logs" },
    });
  }
});

// ============================================================================
// SEC-11: ADMIN LOCKOUT OVERRIDE
// ============================================================================

const unlockAccountSchema = z.object({
  reason: z.string().min(10, "Reason must be at least 10 characters"),
});

/**
 * POST /api/admin/users/:id/unlock
 * Unlock a locked user account (super_admin only)
 * Requires a reason which is logged to audit trail
 */
router.post("/users/:id/unlock", requireSuperAdmin(), async (req, res) => {
  try {
    const { id: targetUserId } = req.params;
    const adminUserId = req.session.userId!;

    const parseResult = unlockAccountSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: parseResult.error.errors[0].message,
        },
      });
    }

    const { reason } = parseResult.data;

    // Check if user exists
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        lockedUntil: users.lockedUntil,
        failedLoginAttempts: users.failedLoginAttempts,
      })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "User not found" },
      });
    }

    // Unlock the account
    await db
      .update(users)
      .set({
        lockedUntil: null,
        failedLoginAttempts: 0,
        lastFailedLoginAt: null,
      })
      .where(eq(users.id, targetUserId));

    // Log to audit trail
    await auditService.log({
      eventType: AuditEventType.ACCOUNT_UNLOCKED,
      userId: adminUserId,
      targetUserId,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
      details: {
        reason,
        previousLockedUntil: user.lockedUntil,
        previousFailedAttempts: user.failedLoginAttempts,
      },
    });

    logger.info("Account unlocked by admin", {
      requestId: req.requestId,
      adminUserId: adminUserId.substring(0, 8) + "...",
      targetUserId: targetUserId.substring(0, 8) + "...",
      action: "unlock",
      outcome: "success",
    });

    res.json({
      success: true,
      message: "Account unlocked successfully",
    });
  } catch (error) {
    logger.error(
      "Failed to unlock account",
      { requestId: req.requestId },
      error as Error
    );
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Failed to unlock account" },
    });
  }
});

export default router;
