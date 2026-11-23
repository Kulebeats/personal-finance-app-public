/**
 * Log Retention Policy Configuration (SEC-08)
 *
 * Defines retention periods and rotation settings for application logs.
 * Complies with security best practices for audit trail retention.
 */

/**
 * Log category types for different retention policies
 */
export type LogCategory =
  | "application" // General application logs
  | "security" // Security events (login, MFA, access control)
  | "audit" // Audit trail (data changes, admin actions)
  | "error"; // Error logs

/**
 * Retention periods in days
 */
export const LOG_RETENTION = {
  /**
   * Hot storage - immediate access, full detail
   * Default: 90 days
   */
  HOT_STORAGE_DAYS: 90,

  /**
   * Cold storage - archived, compressed
   * Default: 365 days (1 year)
   */
  COLD_STORAGE_DAYS: 365,

  /**
   * Security events - extended retention for compliance
   * Default: 730 days (2 years)
   */
  SECURITY_EVENTS_DAYS: 730,

  /**
   * Audit logs - longest retention for regulatory compliance
   * Default: 730 days (2 years)
   */
  AUDIT_LOGS_DAYS: 730,
} as const;

/**
 * Log rotation configuration
 */
export const LOG_ROTATION = {
  /**
   * Maximum size of a single log file before rotation
   * Default: 50MB
   */
  MAX_FILE_SIZE: "50M",

  /**
   * Maximum number of files to keep (for file-based logging)
   */
  MAX_FILES: "14d", // Keep 14 days of daily logs

  /**
   * Enable compression of rotated logs
   */
  COMPRESS: true,

  /**
   * Date pattern for rotated file names
   */
  DATE_PATTERN: "YYYY-MM-DD",

  /**
   * Directory for log files (relative to project root)
   */
  LOG_DIRECTORY: process.env.LOG_DIRECTORY || "logs",
} as const;

/**
 * Security event types that require extended retention
 */
export const SECURITY_EVENT_TYPES = [
  "LOGIN_SUCCESS",
  "LOGIN_FAILED",
  "LOGOUT",
  "MFA_ENABLED",
  "MFA_DISABLED",
  "MFA_VERIFIED",
  "MFA_FAILED",
  "MFA_BACKUP_CODES_REGENERATED",
  "PASSWORD_CHANGED",
  "EMAIL_CHANGED",
  "ACCOUNT_LOCKED",
  "ACCOUNT_UNLOCKED",
  "SESSION_REVOKED",
  "PERMISSION_DENIED",
  "RATE_LIMIT_EXCEEDED",
  "SUSPICIOUS_ACTIVITY",
  "DATA_EXPORT",
  "ADMIN_ACTION",
] as const;

/**
 * Get retention period in days for a log category
 */
export function getRetentionDays(category: LogCategory): number {
  switch (category) {
    case "security":
      return LOG_RETENTION.SECURITY_EVENTS_DAYS;
    case "audit":
      return LOG_RETENTION.AUDIT_LOGS_DAYS;
    case "error":
      return LOG_RETENTION.HOT_STORAGE_DAYS;
    case "application":
    default:
      return LOG_RETENTION.HOT_STORAGE_DAYS;
  }
}

/**
 * Check if an event type is a security event requiring extended retention
 */
export function isSecurityEvent(eventType: string): boolean {
  return (SECURITY_EVENT_TYPES as readonly string[]).includes(eventType);
}

/**
 * Log retention policy summary for documentation/compliance
 */
export const RETENTION_POLICY_SUMMARY = {
  version: "1.0.0",
  lastUpdated: "2026-01-10",
  policies: [
    {
      category: "Application Logs",
      retentionPeriod: "90 days",
      description: "General application logs including request/response logs",
      storage: "Hot storage",
    },
    {
      category: "Security Events",
      retentionPeriod: "2 years",
      description:
        "Login attempts, MFA events, permission changes, account actions",
      storage: "Hot (90 days) + Cold archive",
    },
    {
      category: "Audit Logs",
      retentionPeriod: "2 years",
      description: "Data modifications, admin actions, configuration changes",
      storage: "Hot (90 days) + Cold archive",
    },
    {
      category: "Error Logs",
      retentionPeriod: "90 days",
      description: "Application errors and exceptions",
      storage: "Hot storage",
    },
  ],
  compliance: [
    "NIST SP 800-92 (Log Management)",
    "SOC 2 Type II audit trail requirements",
    "GDPR data retention principles",
  ],
};
