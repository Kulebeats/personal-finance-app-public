/**
 * Auth Security Monitor
 *
 * Real-time monitoring for suspicious authentication patterns.
 * - Login Velocity (Distributed Brute Force)
 * - Geographic Anomalies
 *
 * @module modules/auth/auth.security.monitor
 */

import { db } from "../../db";
import { userLoginHistory } from "@shared/schema";
import { eq, and, gt } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { checkGeoAnomaly, handleGeoAnomaly } from "./strategies/geo-anomaly";

interface SecurityAlert {
  type: "DISTRIBUTED_BRUTE_FORCE" | "NEW_COUNTRY_LOGIN";
  userId: string;
  details: Record<string, unknown>;
  severity: "low" | "medium" | "high";
}

export const authSecurityMonitor = {
  /**
   * Check for suspicious login velocity (Distributed Brute Force)
   *
   * Detects if a user is being attacked by multiple IPs in a short window.
   * Triggered on FAILED login attempts.
   */
  async checkLoginVelocity(userId: string, currentIp: string): Promise<void> {
    const LOOKBACK_MINUTES = 60;
    const THRESHOLD_UNIQUE_IPS = 3;

    try {
      const oneHourAgo = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000);

      // Count unique IPs with failed logins in the last hour
      // Note: This query assumes userLoginHistory is populated on failure
      const recentFailures = await db
        .select({
          ipAddress: userLoginHistory.ipAddress,
        })
        .from(userLoginHistory)
        .where(
          and(
            eq(userLoginHistory.userId, userId),
            eq(userLoginHistory.success, false),
            gt(userLoginHistory.loginTime, oneHourAgo),
          ),
        );

      const uniqueIps = new Set(
        recentFailures
          .map((f: { ipAddress: string | null }) => f.ipAddress?.toString())
          .filter((ip): ip is string => Boolean(ip) && ip !== currentIp),
      );

      // Add current IP if it failed
      uniqueIps.add(currentIp);

      if (uniqueIps.size >= THRESHOLD_UNIQUE_IPS) {
        await this.raiseAlert({
          type: "DISTRIBUTED_BRUTE_FORCE",
          userId,
          details: {
            ipCount: uniqueIps.size,
            ips: Array.from(uniqueIps).slice(0, 5), // Log first 5 IPs
            windowMinutes: LOOKBACK_MINUTES,
          },
          severity: "high",
        });
      }
    } catch (error) {
      logger.error("Failed to check login velocity", {
        userId: userId.substring(0, 8) + "...",
        error,
      });
    }
  },

  /**
   * Check for geographic anomalies (New Country Login)
   *
   * Triggered on SUCCESSFUL login attempts.
   */
  async checkGeoAnomaly(
    userId: string,
    ipAddress: string,
    userEmail: string,
  ): Promise<void> {
    try {
      const result = await checkGeoAnomaly(userId, ipAddress);

      if (result.isAnomaly) {
        await this.raiseAlert({
          type: "NEW_COUNTRY_LOGIN",
          userId,
          details: {
            country: result.location?.country,
            city: result.location?.city,
            reason: result.reason,
          },
          severity: result.riskLevel as "low" | "medium" | "high",
        });

        // Delegate to strategy handler for specific actions (logging etc)
        await handleGeoAnomaly(userId, userEmail, result);
      }
    } catch (error) {
      logger.error("Failed to check geo anomaly", {
        userId: userId.substring(0, 8) + "...",
        error,
      });
    }
  },

  /**
   * Raise a security alert
   */
  async raiseAlert(alert: SecurityAlert): Promise<void> {
    logger.warn(`Security Alert: ${alert.type}`, {
      userId: alert.userId.substring(0, 8) + "...",
      ...alert.details,
    });
  },
};
