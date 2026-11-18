import geoip from "fast-geoip";
import { db } from "../../../db";
import { userLoginHistory } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
// import { notificationService } from "../../../services/NotificationService";
import { logger } from "../../../utils/logger";

/**
 * Geographic Anomaly Configuration
 */
export const GEO_ANOMALY_CONFIG = {
  // Enable/disable geo anomaly detection
  enabled: process.env.GEO_ANOMALY_ENABLED !== "false", // Default to true if not explicitly disabled
  // Number of recent logins to check for baseline
  historyLookback: 10,
  // Countries to always flag as suspicious (optional)
  suspiciousCountries: [] as string[],
  // Notify user on login from new country
  notifyOnNewCountry: true,
  // Require additional verification for new country (MFA)
  requireVerificationForNewCountry: false,
};

/**
 * GeoIP Lookup Result
 */
export interface GeoLocation {
  country: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
}

/**
 * Anomaly Detection Result
 */
export interface AnomalyResult {
  isAnomaly: boolean;
  reason?: string;
  location?: GeoLocation;
  previousCountries?: string[];
  riskLevel: "low" | "medium" | "high";
}

/**
 * Look up geographic location from IP address
 *
 * @example
 * const location = await lookupGeoLocation("8.8.8.8");
 * // { country: "United States", countryCode: "US", ... }
 */
export async function lookupGeoLocation(
  ipAddress: string,
): Promise<GeoLocation> {
  // Handle localhost/private IPs
  if (
    ipAddress === "127.0.0.1" ||
    ipAddress === "::1" ||
    ipAddress.startsWith("192.168.") ||
    ipAddress.startsWith("10.")
  ) {
    return {
      country: "Localhost",
      countryCode: "LO",
      region: null,
      city: null,
      latitude: null,
      longitude: null,
      timezone: null,
    };
  }

  const geo = await geoip.lookup(ipAddress);

  if (!geo) {
    return {
      country: null,
      countryCode: null,
      region: null,
      city: null,
      latitude: null,
      longitude: null,
      timezone: null,
    };
  }

  return {
    country: geo.country,
    countryCode: geo.country,
    region: geo.region,
    city: geo.city,
    latitude: geo.ll?.[0] ?? null,
    longitude: geo.ll?.[1] ?? null,
    timezone: geo.timezone,
  };
}

/**
 * Check if login location is anomalous
 *
 * Compares current login location against user's login history.
 *
 * @example
 * const result = await checkGeoAnomaly(userId, "192.168.1.1");
 * if (result.isAnomaly) {
 *   // Notify user or require additional verification
 * }
 */
export async function checkGeoAnomaly(
  userId: string,
  ipAddress: string,
): Promise<AnomalyResult> {
  if (!GEO_ANOMALY_CONFIG.enabled) {
    return { isAnomaly: false, riskLevel: "low" };
  }

  // Get current location
  const currentLocation = await lookupGeoLocation(ipAddress);

  if (!currentLocation.countryCode) {
    // Can't determine location - not anomalous but unknown
    return { isAnomaly: false, riskLevel: "low", location: currentLocation };
  }

  // Get recent login history
  const recentLogins = await db
    .select({ location: userLoginHistory.location })
    .from(userLoginHistory)
    .where(eq(userLoginHistory.userId, userId))
    .orderBy(desc(userLoginHistory.loginTime))
    .limit(GEO_ANOMALY_CONFIG.historyLookback);

  // Extract countries from history
  const previousCountries = new Set<string>();

  // If no history, first login is not an anomaly usually, unless we want strict locking
  // But let's assume it's low risk if history is empty.
  if (recentLogins.length === 0) {
    return {
      isAnomaly: false,
      location: currentLocation,
      riskLevel: "low",
    };
  }

  // Populate previous countries from history string "City, Region, CountryCode"
  for (const login of recentLogins) {
    if (login.location) {
      // formatLocation produces: "City, Region, CountryCode"
      const parts = login.location.split(",");
      if (parts.length > 0) {
        const countryCode = parts[parts.length - 1].trim();
        if (countryCode) {
          previousCountries.add(countryCode);
        }
      }
    }
  }

  // Check if current country is new
  const isNewCountry = !previousCountries.has(currentLocation.countryCode);

  // Check if country is suspicious
  const isSuspiciousCountry = GEO_ANOMALY_CONFIG.suspiciousCountries.includes(
    currentLocation.countryCode,
  );

  if (isNewCountry || isSuspiciousCountry) {
    let reason = "";
    if (isSuspiciousCountry) {
      reason = `Login from flagged country: ${currentLocation.countryCode}`;
    } else {
      reason = `Login from new country: ${currentLocation.countryCode}`;
    }

    return {
      isAnomaly: true,
      reason,
      location: currentLocation,
      previousCountries: Array.from(previousCountries),
      riskLevel: isSuspiciousCountry ? "high" : "medium",
    };
  }

  return {
    isAnomaly: false,
    location: currentLocation,
    riskLevel: "low",
  };
}

/**
 * Handle geographic anomaly detection result
 *
 * Call this after successful login to check for anomalies.
 *
 * @example
 * // In login handler, after successful authentication
 * const anomalyResult = await checkGeoAnomaly(user.id, req.ip);
 * await handleGeoAnomaly(user.id, user.email, anomalyResult);
 */
export async function handleGeoAnomaly(
  userId: string,
  userEmail: string,
  result: AnomalyResult,
): Promise<void> {
  if (!result.isAnomaly) {
    return;
  }

  logger.warn("Geographic anomaly detected", {
    userId: userId.substring(0, 8) + "...",
    reason: result.reason,
    riskLevel: result.riskLevel,
    country: result.location?.country,
  });

  // TODO: Send notification when notification service supports it
  // if (GEO_ANOMALY_CONFIG.notifyOnNewCountry) {
  //   await notificationService.sendSecurityAlert(userId, {
  //     type: "new_location_login",
  //     message: `Login detected from ${result.location?.city || "Unknown"}, ${result.location?.country || "Unknown location"}`,
  //     severity: result.riskLevel,
  //   });
  // }
}

/**
 * Format location for display/storage
 *
 * @example
 * const formatted = formatLocation(location);
 * // "San Francisco, California, US"
 */
export function formatLocation(location: GeoLocation): string {
  const parts = [location.city, location.region, location.countryCode].filter(
    Boolean,
  );
  return parts.length > 0 ? parts.join(", ") : "Unknown location";
}
