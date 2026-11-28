/**
 * Auth Session Service
 *
 * Handles session management operations.
 * Split from auth.service.ts to keep file sizes under 500 LOC.
 *
 * @module modules/auth/auth.session.service
 */

import { Request } from "express";
import { userRepository } from "../../repositories/UserRepository";
import { notificationService } from "../../services/NotificationService";
import { auditService, AuditEventType } from "../../services/AuditService";
import { logger } from "../../utils/logger";
import { parseDeviceInfo, isKnownDeviceSession } from "./auth.device";
import { authSecurityMonitor } from "./auth.security.monitor";
import type { User } from "@shared/schema";
import { assertCurrentCredential, registerSessionIdentity, revokeLoginSession } from "../../services/session-identity";

/**
 * Auth Session Service
 *
 * Handles session creation, regeneration, and cleanup.
 */
export const authSessionService = {
  /**
   * Finalize login by regenerating the session and creating session records.
   *
   * Used by both direct login (no MFA) and MFA-verified login.
   */
  async finalizeLogin(
    user: User,
    req: Request,
    rememberMe: boolean,
    ipAddress: string,
    userAgent: string,
  ): Promise<void> {
    const deviceInfo = parseDeviceInfo(userAgent);
    await assertCurrentCredential(user);

    // Regenerate session to prevent session fixation
    await this.regenerateSession(req);
    req.session.userId = user.id;
    req.session.securityGeneration = user.securityGeneration ?? 0;

    // Apply remember-me session TTL
    req.session.cookie.maxAge = rememberMe
      ? 30 * 24 * 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;

    // Log successful login
    await userRepository.createLoginHistory({
      userId: user.id,
      deviceName: deviceInfo.deviceName,
      ipAddress,
      success: true,
    });

    // Run security monitor checks (async, fire-and-forget)
    authSecurityMonitor
      .checkGeoAnomaly(user.id, ipAddress, user.email)
      .catch((err) =>
        logger.error("Security monitor failed", {
          userId: user.id.substring(0, 8) + "...",
          err,
        }),
      );

    // Create session record and notify for new devices
    try {
      let isNewDevice = true;
      try {
        const sessions = await userRepository.findSessions(user.id);
        isNewDevice = !isKnownDeviceSession(sessions, deviceInfo);
      } catch {
        logger.warn("Failed to check existing sessions", {
          userId: user.id?.substring(0, 8) + "...",
        });
      }

      await registerSessionIdentity(user, {
        userId: user.id,
        sessionToken: req.sessionID,
        deviceName: deviceInfo.deviceName,
        deviceType: deviceInfo.deviceType,
        browser: deviceInfo.browser,
        os: deviceInfo.os,
        ipAddress,
        expiresAt: new Date(
          Date.now() + (req.session.cookie.maxAge || 86400000),
        ),
      });

      if (isNewDevice) {
        // Fire and forget
        notificationService
          .triggerNewLogin(user.id, req.sessionID)
          .catch((err) =>
            logger.error(
              "New login notification failed",
              { userId: user.id?.substring(0, 8) + "..." },
              err,
            ),
          );
      }
    } catch (sessionError) {
      logger.warn("Failed to create session record", {
        userId: user.id?.substring(0, 8) + "...",
      });
      delete req.session.userId;
      throw sessionError;
    }

    // Audit log
    await auditService.log({
      eventType: AuditEventType.LOGIN_SUCCESS,
      userId: user.id,
      ipAddress,
      userAgent,
      details: { mfaEnabled: Boolean(user.mfaEnabled) },
    });
  },

  /**
   * Regenerate session (prevent session fixation)
   */
  async regenerateSession(req: Request): Promise<void> {
    const oldSession = { ...req.session };
    const oldUserId = oldSession.userId || oldSession.mfaPendingUserId;
    // The base store destroys the row but cannot fence a delayed set. Retire
    // the exact old identity before rotating; other device generations stay put.
    if (oldUserId) await revokeLoginSession(oldUserId, req.sessionID);
    return new Promise((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) {
          reject(err);
          return;
        }
        // Restore any data we want to keep
        Object.assign(req.session, {
          cookie: oldSession.cookie,
        });
        resolve();
      });
    });
  },

  /**
   * Logout user
   */
  async logout(req: Request): Promise<void> {
    const userId = req.session.userId || req.session.mfaPendingUserId;
    if (userId) {
      await revokeLoginSession(userId, req.sessionID);
    }

    return new Promise((resolve, reject) => {
      req.session.destroy((err) => {
        if (err) {
          reject(err);
          return;
        }

        if (userId) {
          auditService.log({
            eventType: AuditEventType.LOGOUT,
            userId,
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"],
          });
        }

        resolve();
      });
    });
  },
};
