/**
 * Object-Level Authorization
 *
 * Ensures resources belong to the specified household before allowing access.
 * Prevents horizontal privilege escalation (accessing other users' data).
 *
 * SEC-01: Object-level authorization
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";
import { logger } from "../../utils/logger";
import type { Request, Response, NextFunction } from "express";

/**
 * Resource tables and their householdId column mappings
 */
const RESOURCE_TABLES: Record<string, string> = {
  transactions: "household_id",
  accounts: "household_id",
  categories: "household_id",
  goals: "household_id",
  recurring_rules: "household_id",
  budgets: "household_id",
  tags: "household_id",
};

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Assert that a resource belongs to the specified household.
 * Throws ForbiddenError if the resource doesn't exist or belongs to another household.
 *
 * @param householdId - The household ID to verify ownership against
 * @param resourceType - The type of resource (e.g., "transactions", "accounts")
 * @param resourceId - The UUID of the resource
 * @param requestId - Optional request ID for logging
 */
export async function assertOwnership(
  householdId: string,
  resourceType: string,
  resourceId: string,
  requestId?: string
): Promise<void> {
  const tableName = resourceType.toLowerCase();

  // SEC-SQL-001: Strict whitelist validation to prevent SQL injection
  // Only allow table names that are explicitly defined in RESOURCE_TABLES
  const allowedTables = Object.keys(RESOURCE_TABLES);
  if (!allowedTables.includes(tableName)) {
    throw new Error(`Unknown resource type: ${resourceType}`);
  }

  const householdColumn = RESOURCE_TABLES[tableName];

  try {
    // Use raw SQL to check ownership (table name can't be parameterized)
    const result = await db.execute(sql`
      SELECT id, ${sql.raw(householdColumn)} as household_id
      FROM ${sql.raw(tableName)}
      WHERE id = ${resourceId}
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      logger.warn("Resource not found for ownership check", {
        requestId,
        resourceType,
        resourceId: resourceId.substring(0, 8) + "...",
      });
      throw new ForbiddenError("Resource not found");
    }

    const resource = result.rows[0] as { household_id: string };
    if (resource.household_id !== householdId) {
      logger.warn("Unauthorized resource access attempt", {
        requestId,
        resourceType,
        resourceId: resourceId.substring(0, 8) + "...",
        expectedHousehold: householdId.substring(0, 8) + "...",
        actualHousehold: resource.household_id?.substring(0, 8) + "...",
      });
      throw new ForbiddenError(
        "Access denied: resource belongs to another household"
      );
    }
  } catch (error) {
    if (error instanceof ForbiddenError) {
      throw error;
    }
    logger.error(
      "Ownership check failed",
      {
        requestId,
        resourceType,
        resourceId: resourceId.substring(0, 8) + "...",
      },
      error as Error
    );
    throw new ForbiddenError("Unable to verify resource ownership");
  }
}

/**
 * Check ownership without throwing - returns boolean
 */
export async function checkOwnership(
  householdId: string,
  resourceType: string,
  resourceId: string
): Promise<boolean> {
  try {
    await assertOwnership(householdId, resourceType, resourceId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Express middleware factory for ownership validation
 * Extracts resourceId from params and validates ownership
 */
export function requireOwnership(
  resourceType: string,
  paramName: string = "id"
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const householdId = req.householdContext?.householdId;
    const resourceId = req.params[paramName];

    if (!householdId) {
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Household context required" },
      });
    }

    if (!resourceId) {
      return res.status(400).json({
        success: false,
        error: {
          code: "BAD_REQUEST",
          message: `Missing ${paramName} parameter`,
        },
      });
    }

    try {
      await assertOwnership(
        householdId,
        resourceType,
        resourceId,
        req.requestId
      );
      next();
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN", message: error.message },
        });
      }
      return res.status(500).json({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "Ownership check failed" },
      });
    }
  };
}
