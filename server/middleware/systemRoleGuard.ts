import { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { userSystemRoles, systemRoles } from "../../shared/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../utils/logger";

/**
 * Middleware to require the user has one of the specified system roles.
 * Must be used after requireAuth middleware.
 */
export function requireSystemRole(...allowedRoles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.session?.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required",
          },
        });
      }

      // Get user's system roles
      const userRoles = await db
        .select({
          roleName: systemRoles.name,
        })
        .from(userSystemRoles)
        .innerJoin(systemRoles, eq(userSystemRoles.roleId, systemRoles.id))
        .where(eq(userSystemRoles.userId, userId));

      if (userRoles.length === 0) {
        logger.warn("System role denied - no roles assigned", {
          requestId: req.requestId,
          userId: userId.substring(0, 8) + "...",
          requiredRoles: allowedRoles,
        });

        return res.status(403).json({
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "You do not have permission to access this resource",
          },
        });
      }

      // Check if user has one of the allowed roles
      const hasPermission = userRoles.some((ur) =>
        allowedRoles.includes(ur.roleName)
      );

      if (!hasPermission) {
        logger.warn("System role denied - insufficient role", {
          requestId: req.requestId,
          userId: userId.substring(0, 8) + "...",
          userRoles: userRoles.map((r) => r.roleName),
          requiredRoles: allowedRoles,
        });

        return res.status(403).json({
          success: false,
          error: {
            code: "FORBIDDEN",
            message:
              "You do not have the required role to access this resource",
          },
        });
      }

      // Attach roles to request for potential use downstream
      (req as Request & { systemRoles: string[] }).systemRoles = userRoles.map((r) => r.roleName);

      logger.info("System role access granted", {
        requestId: req.requestId,
        userId: userId.substring(0, 8) + "...",
        role: userRoles.map((r) => r.roleName).join(", "),
      });

      next();
    } catch (error) {
      logger.error(
        "System role check failed",
        { requestId: req.requestId },
        error as Error
      );
      return res.status(500).json({
        success: false,
        error: {
          code: "SERVER_ERROR",
          message: "Failed to verify permissions",
        },
      });
    }
  };
}

/**
 * Middleware to require the user has ANY system role.
 * Useful for admin-only areas where any admin can access.
 */
export function requireAnySystemRole() {
  return requireSystemRole(
    "super_admin",
    "support",
    "analyst",
    "readonly_admin"
  );
}

/**
 * Middleware to require super_admin role only.
 */
export function requireSuperAdmin() {
  return requireSystemRole("super_admin");
}

/**
 * Helper function to check if a user has a specific system role.
 * Can be used in routes where you need conditional logic based on role.
 */
export async function hasSystemRole(
  userId: string,
  role: string
): Promise<boolean> {
  const userRoles = await db
    .select({ roleName: systemRoles.name })
    .from(userSystemRoles)
    .innerJoin(systemRoles, eq(userSystemRoles.roleId, systemRoles.id))
    .where(eq(userSystemRoles.userId, userId));

  return userRoles.some((ur) => ur.roleName === role);
}

/**
 * Helper function to get all system roles for a user.
 */
export async function getUserSystemRoles(userId: string): Promise<string[]> {
  const userRoles = await db
    .select({ roleName: systemRoles.name })
    .from(userSystemRoles)
    .innerJoin(systemRoles, eq(userSystemRoles.roleId, systemRoles.id))
    .where(eq(userSystemRoles.userId, userId));

  return userRoles.map((r) => r.roleName);
}
