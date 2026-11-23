/**
 * Settings Account Controller
 *
 * HTTP handlers for account-level management (erasure). The personal-data
 * export lives in settings.privacy-export.controller.ts.
 * Split from settings.controller.ts to maintain LOC limits.
 *
 * @module modules/settings/settings.account.controller
 */

import { Request, Response, NextFunction } from "express";
import { userRepository } from "../../repositories/UserRepository";
import { resolveRequestHousehold } from "../../core/authz/session-preconditions";
import { verifyPassword } from "../../auth";
import { logger } from "../../utils/logger";
import { success } from "../../core/http";
import {
  ValidationError,
  InvalidCredentialsError,
} from "../../core/errors";
import { businessAuditService } from "../../services/BusinessAuditService";
import * as accountDeletionService from "./settings.account-deletion.service";

export const settingsAccountController = {
  /**
   * DPA right-to-erasure. Hard-deletes the household's financial data and
   * anonymises the user atomically, writes a durable audit row, THEN destroys
   * the session. Session identifiers are captured before destroy so the audit
   * records the real actor.
   */
  async deleteAccount(req: Request, res: Response, next: NextFunction) {
    try {
      const { password } = req.body;

      const userId = req.session.userId!;
      const user = await userRepository.findById(userId);
      if (!user || !user.passwordHash) {
        throw new ValidationError("Cannot delete account");
      }

      const isValid = await verifyPassword(password, user.passwordHash);
      if (!isValid) {
        throw new InvalidCredentialsError("Password is incorrect");
      }

      // This route is user-level (no householdGuard), so resolve the household
      // here before erasing. A user with no household is erased too (A-20).
      const household = await resolveRequestHousehold(req, userId);
      const householdId = household?.id ?? null;

      // Capture identifiers BEFORE destroying the session, so the audit row
      // (written inside eraseAccount) records the real actor. Reading
      // req.session.userId after destroy() would yield undefined.
      const ipAddress = businessAuditService.getIpAddress(req);

      await accountDeletionService.eraseAccount({
        userId,
        householdId,
        userEmail: user.email,
        ipAddress,
      });

      logger.info("Account erased (right to erasure)", {
        userId: userId.substring(0, 8),
        householdId: householdId?.substring(0, 8),
      });

      // Destroy the session AFTER the audit log is written. Handle the callback
      // error explicitly instead of swallowing it, then still respond.
      req.session.destroy((destroyErr) => {
        if (destroyErr) {
          logger.error(
            "Failed to destroy session after account erasure",
            { userId: userId.substring(0, 8) },
            destroyErr instanceof Error
              ? destroyErr
              : new Error(String(destroyErr)),
          );
        }
        res.clearCookie("connect.sid");
        success(res, null, 200, {
          message: "Account permanently deleted",
        });
      });
    } catch (error) {
      next(error);
    }
  },
};
