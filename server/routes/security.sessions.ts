/**
 * Security Sessions Routes
 *
 * Session management and login history.
 *
 * @module routes/security.sessions
 */

import { Router, Request, Response } from "express";
import { db } from "../db";
import { userSessions, userLoginHistory } from "@shared/schema";
import { eq, and, ne, desc } from "drizzle-orm";
import { requireAuth } from "../auth";
import { requireStepUp } from "../middleware/requireStepUp";
import { logger } from "../utils/logger";
import { generalLimiter } from "../middleware/rateLimit";
import { businessAuditService } from "../services/BusinessAuditService";
import { randomUUID } from "crypto";

const router = Router();

// SEC-RATE-008: Apply rate limiting and authentication to session routes
router.use(generalLimiter);
router.use(requireAuth);

// GET /sessions - Get active sessions
router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;

    const sessions = await db
      .select({
        id: userSessions.id,
        deviceName: userSessions.deviceName,
        deviceType: userSessions.deviceType,
        browser: userSessions.browser,
        os: userSessions.os,
        ipAddress: userSessions.ipAddress,
        location: userSessions.location,
        isTrusted: userSessions.isTrusted,
        lastActiveAt: userSessions.lastActiveAt,
        createdAt: userSessions.createdAt,
      })
      .from(userSessions)
      .where(eq(userSessions.userId, userId))
      .orderBy(desc(userSessions.lastActiveAt));

    res.json({ data: { sessions } });
  } catch (error) {
    logger.error(
      "Error fetching sessions",
      {
        requestId: req.requestId,
        userId: req.session.userId?.substring(0, 8) + "...",
      },
      error as Error
    );
    res.status(500).json({ error: { message: "Failed to fetch sessions" } });
  }
});

// DELETE /sessions/:id - Revoke a session
// FIX AUTH-STEPUP-001: Require step-up MFA for session revocation
router.delete("/:id", requireStepUp("SETTINGS"), async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const sessionId = req.params.id;

    await db
      .delete(userSessions)
      .where(
        and(eq(userSessions.id, sessionId), eq(userSessions.userId, userId))
      );

    // DPA: session revocation is a security-relevant event — audit it.
    await businessAuditService.log({
      householdId: null, // user-level security event (auditLogs.householdId is a UUID FK; sentinel strings silently fail to insert)
      userId,
      action: "REVOKE_SESSION",
      entityType: "session",
      entityId: sessionId,
      details: { sessionId },
      ipAddress: businessAuditService.getIpAddress(req),
    });

    res.json({ success: true, message: "Session revoked" });
  } catch (error) {
    logger.error(
      "Error revoking session",
      {
        requestId: req.requestId,
        userId: req.session.userId?.substring(0, 8) + "...",
        sessionId: req.params.id,
      },
      error as Error
    );
    res.status(500).json({ error: { message: "Failed to revoke session" } });
  }
});

// DELETE /sessions - Revoke all other sessions
// FIX AUTH-STEPUP-001: Require step-up MFA for revoking all sessions
router.delete("/", requireStepUp("SETTINGS"), async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    // FIX AUTH-SESS-003: Use req.sessionID (matches session record storage) instead of passport.user
    const currentSessionToken = req.sessionID;

    // Delete all sessions except current one
    await db.delete(userSessions).where(
      and(
        eq(userSessions.userId, userId),
        ne(userSessions.sessionToken, currentSessionToken)
      )
    );

    // DPA: bulk session revocation is a security-relevant event — audit it.
    await businessAuditService.log({
      householdId: null, // user-level security event (auditLogs.householdId is a UUID FK; sentinel strings silently fail to insert)
      userId,
      action: "REVOKE_ALL_SESSIONS",
      entityType: "session",
      entityId: userId,
      details: { action: "revoke_all_except_current" },
      ipAddress: businessAuditService.getIpAddress(req),
    });

    res.json({ success: true, message: "All other sessions revoked" });
  } catch (error) {
    logger.error(
      "Error revoking all sessions",
      {
        requestId: req.requestId,
        userId: req.session.userId?.substring(0, 8) + "...",
      },
      error as Error
    );
    res.status(500).json({ error: { message: "Failed to revoke sessions" } });
  }
});

// GET /login-history - Get login history
router.get("/login-history", async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;

    const history = await db
      .select({
        id: userLoginHistory.id,
        loginTime: userLoginHistory.loginTime,
        deviceName: userLoginHistory.deviceName,
        ipAddress: userLoginHistory.ipAddress,
        location: userLoginHistory.location,
        success: userLoginHistory.success,
        failureReason: userLoginHistory.failureReason,
      })
      .from(userLoginHistory)
      .where(eq(userLoginHistory.userId, userId))
      .orderBy(desc(userLoginHistory.loginTime))
      .limit(20);

    res.json({ data: { history } });
  } catch (error) {
    logger.error(
      "Error fetching login history",
      {
        requestId: req.requestId,
        userId: req.session.userId?.substring(0, 8) + "...",
      },
      error as Error
    );
    res
      .status(500)
      .json({ error: { message: "Failed to fetch login history" } });
  }
});

/**
 * GET /login-history/export - Export login history (P4-67)
 *
 * Exports login history as CSV or JSON for compliance/audit purposes.
 * Query params:
 *   - format: 'csv' | 'json' (default: 'json')
 *   - limit: number (default: 100, max: 1000)
 */
router.get("/login-history/export", async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const format = (req.query.format as string) || "json";
    const limit = Math.min(
      parseInt(req.query.limit as string) || 100,
      1000
    );

    const history = await db
      .select({
        id: userLoginHistory.id,
        loginTime: userLoginHistory.loginTime,
        deviceName: userLoginHistory.deviceName,
        ipAddress: userLoginHistory.ipAddress,
        location: userLoginHistory.location,
        success: userLoginHistory.success,
        failureReason: userLoginHistory.failureReason,
      })
      .from(userLoginHistory)
      .where(eq(userLoginHistory.userId, userId))
      .orderBy(desc(userLoginHistory.loginTime))
      .limit(limit);

    // DPA audit (Rule 9): this endpoint egresses PII (IP addresses, device,
    // approximate location) as a downloadable file - mirrors the reports CSV
    // export / ZRA tax export PROCESS/data_export audit row. There is no
    // persisted export record for this single-shot endpoint, so a fresh id
    // identifies the egress event itself. Metadata only - never the exported
    // rows. householdId is null: login history is a user-level security
    // record, not household-scoped (auditLogs.householdId is a UUID FK, so a
    // sentinel string would silently fail to insert).
    await businessAuditService.log({
      userId,
      householdId: null,
      action: "PROCESS",
      entityType: "data_export",
      entityId: randomUUID(),
      details: {
        exportType: "login_history",
        fileFormat: format,
        recordCount: history.length,
      },
      ipAddress: businessAuditService.getIpAddress(req),
    });

    if (format === "csv") {
      // Generate CSV
      const headers = [
        "Login Time",
        "Device",
        "IP Address",
        "Location",
        "Success",
        "Failure Reason",
      ];
      const csvRows = [headers.join(",")];

      for (const entry of history) {
        const row = [
          entry.loginTime ? new Date(entry.loginTime).toISOString() : "",
          `"${(entry.deviceName || "").replace(/"/g, '""')}"`,
          entry.ipAddress || "",
          `"${(entry.location || "").replace(/"/g, '""')}"`,
          entry.success ? "Yes" : "No",
          `"${(entry.failureReason || "").replace(/"/g, '""')}"`,
        ];
        csvRows.push(row.join(","));
      }

      const csv = csvRows.join("\n");
      const timestamp = new Date().toISOString().split("T")[0];
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="login-history-${timestamp}.csv"`
      );
      res.send(csv);
    } else {
      // JSON format
      const timestamp = new Date().toISOString().split("T")[0];
      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="login-history-${timestamp}.json"`
      );
      res.json({
        exportedAt: new Date().toISOString(),
        totalRecords: history.length,
        data: history,
      });
    }
  } catch (error) {
    logger.error(
      "Error exporting login history",
      {
        requestId: req.requestId,
        userId: req.session.userId?.substring(0, 8) + "...",
      },
      error as Error
    );
    res
      .status(500)
      .json({ error: { message: "Failed to export login history" } });
  }
});

export default router;
