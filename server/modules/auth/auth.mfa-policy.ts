/**
 * MFA Enrollment Policy (P3-46)
 *
 * Decides when multi-factor authentication should be SUGGESTED to a user.
 *
 * ENFORCEMENT IS NOT IMPLEMENTED. Read this before trusting the module name.
 *
 * `MfaPolicyResult.required` is computed here but no code consumes it. The only
 * caller that matters, `authService.login` (auth.service.ts), reads
 * `suggestEnrollment` and completes the login regardless; grep `.required`
 * across `server/modules/auth/` and you will find zero read sites. MFA is
 * therefore OPTIONAL for every user, including owners and admins.
 *
 * This module previously carried an `MFA_ENFORCEMENT_ENABLED` constant marked
 * "Set to true to enforce". It was inert — flipping it changed a field nobody
 * reads. It has been removed rather than left as a switch that silently does
 * nothing, because a control that looks load-bearing and is not is worse than
 * no control: it invites a false "MFA is enforced" claim in an audit.
 *
 * Turning enforcement on is a real packet, not a constant: gate login on
 * `required`, add an enrollment grace flow so a privileged user without MFA is
 * walked through setup instead of being locked out, and cover it with real-DB
 * tests. Until that ships, `required` stays false and is advisory shape only.
 *
 * @module modules/auth/auth.mfa-policy
 */

import { db } from "../../db";
import { users, households, householdMembers, accounts } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { Money } from "../../core/money";

// ============================================================================
// MFA POLICY CONFIGURATION
// ============================================================================

/**
 * Threshold for high-value household MFA requirement.
 * Households with total balance above this require MFA for all members.
 */
const HIGH_VALUE_THRESHOLD = new Money("10000.00"); // $10,000 equivalent

/**
 * Roles that always require MFA regardless of household value.
 */
const MFA_REQUIRED_ROLES: string[] = ["owner", "admin"];

// ============================================================================
// MFA POLICY FUNCTIONS
// ============================================================================

export interface MfaPolicyResult {
  /**
   * ADVISORY ONLY — always false, and no caller reads it. See the module
   * header. Retained because it is the right shape for enforcement when that
   * is actually built; do NOT read a true here as meaning MFA was enforced.
   */
  required: boolean;
  reason?: string;
  suggestEnrollment: boolean;
}

/**
 * Check if MFA should be required or suggested for a user
 *
 * Evaluates multiple criteria:
 * 1. User role (owner/admin always require MFA)
 * 2. Household value (high-value households require MFA)
 * 3. User's MFA preference (already enabled)
 */
export async function checkMfaPolicy(userId: string): Promise<MfaPolicyResult> {
  try {
    // Get user's MFA status
    const [user] = await db
      .select({
        id: users.id,
        mfaEnabled: users.mfaEnabled,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return { required: false, suggestEnrollment: false };
    }

    // Already has MFA enabled
    if (user.mfaEnabled) {
      return { required: false, suggestEnrollment: false };
    }

    // Get user's household memberships
    const memberships = await db
      .select({
        householdId: householdMembers.householdId,
        role: householdMembers.role,
      })
      .from(householdMembers)
      .where(eq(householdMembers.userId, userId));

    if (memberships.length === 0) {
      return { required: false, suggestEnrollment: false };
    }

    // Check if user has admin/owner role in any household
    const hasPrivilegedRole = memberships.some((m) =>
      MFA_REQUIRED_ROLES.includes(m.role || ""),
    );

    if (hasPrivilegedRole) {
      return {
        // Advisory only — enforcement is unimplemented (see module header).
        required: false,
        reason: "Administrative role requires enhanced security",
        suggestEnrollment: true,
      };
    }

    // Check household total value for each membership
    for (const membership of memberships) {
      if (!membership.householdId) continue;
      const isHighValue = await isHighValueHousehold(membership.householdId);
      if (isHighValue) {
        return {
          // Advisory only — enforcement is unimplemented (see module header).
          required: false,
          reason: "High-value account requires enhanced security",
          suggestEnrollment: true,
        };
      }
    }

    return { required: false, suggestEnrollment: false };
  } catch (error) {
    logger.error(
      "Error checking MFA policy",
      { userId: userId.substring(0, 8) + "..." },
      error as Error,
    );
    // Fail open - don't block access on error
    return { required: false, suggestEnrollment: false };
  }
}

/**
 * Check if a household is high-value (total balance > threshold)
 */
async function isHighValueHousehold(householdId: string): Promise<boolean> {
  try {
    // Sum all account balances for the household
    const result = await db
      .select({
        totalBalance: sql<string>`COALESCE(SUM(${accounts.balance}), 0)`,
      })
      .from(accounts)
      .where(eq(accounts.householdId, householdId));

    if (!result[0]) {
      return false;
    }

    const totalBalance = new Money(result[0].totalBalance);
    return totalBalance.gte(HIGH_VALUE_THRESHOLD);
  } catch (error) {
    logger.error(
      "Error checking household value",
      { householdId: householdId.substring(0, 8) + "..." },
      error as Error,
    );
    return false;
  }
}

/**
 * Get MFA policy configuration for display
 */
export function getMfaPolicyConfig() {
  return {
    highValueThreshold: HIGH_VALUE_THRESHOLD.toNumber(),
    highValueThresholdFormatted: HIGH_VALUE_THRESHOLD.toString(),
    requiredRoles: MFA_REQUIRED_ROLES,
    // Always false: enforcement is unimplemented (see module header). This
    // getter currently has no callers.
    enforcementEnabled: false,
  };
}

/**
 * Check if MFA enrollment should be prompted after login
 *
 * Returns true if user should see an MFA enrollment prompt.
 */
export async function shouldPromptMfaEnrollment(
  userId: string,
): Promise<boolean> {
  const policy = await checkMfaPolicy(userId);
  return policy.suggestEnrollment;
}
