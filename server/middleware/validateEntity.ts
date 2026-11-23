import { type Request, type Response, type NextFunction } from "express";
import { db } from "../db";
import { accounts, categories, merchants, tags } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { logger } from "../utils/logger";
import { isHouseholdRole, type HouseholdRole } from "../core/authz/capabilities";

/**
 * Entity Validation Middleware - Phase 0A.5
 *
 * Validates that referenced entities (accounts, categories, merchants, tags)
 * belong to the current user's household BEFORE running the main query.
 *
 * This prevents cross-household data inference attacks.
 *
 * Per Canonical Invariant 1: Entity validation MUST happen before any query.
 */

interface EntityValidationOptions {
  /** Check accountId from params/query/body */
  accountId?: boolean;
  /** Check toAccountId from params/query/body (for transfers) */
  toAccountId?: boolean;
  /** Check categoryId from params/query/body */
  categoryId?: boolean;
  /** Check merchantId from params/query/body */
  merchantId?: boolean;
  /** Check tagId from params/query/body */
  tagId?: boolean;
  /** Optional: also check privacy (is_private) for accounts/transactions */
  checkPrivacy?: boolean;
}

/**
 * Extract entity ID from request (params > query > body)
 */
function extractId(req: Request, key: string): string | undefined {
  return req.params[key] || (req.query[key] as string) || req.body?.[key];
}

/**
 * Create entity validation middleware
 *
 * @example
 * // Validate accountId belongs to household
 * router.get('/accounts/:accountId', validateEntity({ accountId: true }), handler);
 *
 * // Validate multiple entities
 * router.post('/transactions', validateEntity({ accountId: true, categoryId: true }), handler);
 */
export function validateEntity(options: EntityValidationOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Must have household context (from householdGuard middleware)
    if (!req.householdContext) {
      logger.warn("validateEntity called without householdContext", {
        requestId: req.requestId,
        route: req.path,
      });
      return res.status(500).json({
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Household context not available",
        },
      });
    }

    const { householdId, userId } = req.householdContext;

    try {
      // Validate accountId
      if (options.accountId) {
        const accountId =
          extractId(req, "accountId") || extractId(req, "fromAccountId");
        if (accountId) {
          const account = await db.query.accounts.findFirst({
            where: and(
              eq(accounts.id, accountId),
              eq(accounts.householdId, householdId),
              isNull(accounts.deletedAt)
            ),
          });

          if (!account) {
            logger.warn("Account not found or not in household", {
              requestId: req.requestId,
              householdId,
            });
            return res.status(404).json({
              success: false,
              error: {
                code: "NOT_FOUND",
                message: "Account not found",
              },
            });
          }

          // Check privacy if enabled
          if (
            options.checkPrivacy &&
            account.isPrivate &&
            account.ownerUserId !== userId
          ) {
            logger.warn("Access denied to private account", {
              requestId: req.requestId,
            });
            return res.status(403).json({
              success: false,
              error: {
                code: "FORBIDDEN",
                message: "Access denied to private account",
              },
            });
          }
        }
      }

      // Validate toAccountId (for transfers)
      if (options.toAccountId) {
        const toAccountId = extractId(req, "toAccountId");
        if (toAccountId) {
          const account = await db.query.accounts.findFirst({
            where: and(
              eq(accounts.id, toAccountId),
              eq(accounts.householdId, householdId),
              isNull(accounts.deletedAt)
            ),
          });

          if (!account) {
            logger.warn("Destination account not found or not in household", {
              requestId: req.requestId,
              householdId,
            });
            return res.status(404).json({
              success: false,
              error: {
                code: "NOT_FOUND",
                message: "Destination account not found",
              },
            });
          }

          // Check privacy if enabled
          if (
            options.checkPrivacy &&
            account.isPrivate &&
            account.ownerUserId !== userId
          ) {
            logger.warn("Access denied to private destination account", {
              requestId: req.requestId,
            });
            return res.status(403).json({
              success: false,
              error: {
                code: "FORBIDDEN",
                message: "Access denied to private account",
              },
            });
          }
        }
      }

      // Validate categoryId
      if (options.categoryId) {
        const categoryId = extractId(req, "categoryId");
        if (categoryId) {
          const category = await db.query.categories.findFirst({
            where: and(
              eq(categories.id, categoryId),
              eq(categories.householdId, householdId),
              isNull(categories.deletedAt)
            ),
          });

          if (!category) {
            logger.warn("Category not found or not in household", {
              requestId: req.requestId,
              householdId,
            });
            return res.status(404).json({
              success: false,
              error: {
                code: "NOT_FOUND",
                message: "Category not found",
              },
            });
          }
        }
      }

      // Validate merchantId
      if (options.merchantId) {
        const merchantId = extractId(req, "merchantId");
        if (merchantId) {
          const merchant = await db.query.merchants.findFirst({
            where: and(
              eq(merchants.id, merchantId),
              eq(merchants.householdId, householdId)
            ),
          });

          if (!merchant) {
            logger.warn("Merchant not found or not in household", {
              requestId: req.requestId,
              householdId,
            });
            return res.status(404).json({
              success: false,
              error: {
                code: "NOT_FOUND",
                message: "Merchant not found",
              },
            });
          }
        }
      }

      // Validate tagId
      if (options.tagId) {
        const tagId = extractId(req, "tagId");
        if (tagId) {
          const tag = await db.query.tags.findFirst({
            where: and(eq(tags.id, tagId), eq(tags.householdId, householdId)),
          });

          if (!tag) {
            logger.warn("Tag not found or not in household", {
              requestId: req.requestId,
              householdId,
            });
            return res.status(404).json({
              success: false,
              error: {
                code: "NOT_FOUND",
                message: "Tag not found",
              },
            });
          }
        }
      }

      next();
    } catch (error) {
      logger.requestError(req, "Entity validation error", error as Error);
      return res.status(500).json({
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to validate entity ownership",
        },
      });
    }
  };
}

/**
 * Role-based access control middleware
 *
 * Compatibility adapter for existing minimum-role callers. New operations use
 * named capabilities; this adapter does not infer authority from ordinal values.
 */
export function requireRole(
  minRole: "owner" | "admin" | "member" | "view_only"
) {
  const permitted: Record<typeof minRole, readonly HouseholdRole[]> = {
    owner: ["owner"],
    admin: ["owner", "admin"],
    member: ["owner", "admin", "member"],
    view_only: ["owner", "admin", "member", "view_only", "professional"],
  };

  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.householdContext) {
      return res.status(500).json({
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Household context not available",
        },
      });
    }

    const role = req.householdContext.role;
    if (!isHouseholdRole(role) || !Object.hasOwn(permitted, minRole) ||
        !permitted[minRole].includes(role)) {
      logger.warn("Insufficient role for action", {
        requestId: req.requestId,
        route: req.path,
      });
      return res.status(403).json({
        success: false,
        error: {
          code: "FORBIDDEN",
          message: `This action requires ${minRole} role or higher`,
        },
      });
    }

    next();
  };
}
