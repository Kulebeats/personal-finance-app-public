/**
 * Settings Account Controller
 *
 * HTTP handlers for account-level management (erasure, data export).
 * Split from settings.controller.ts to maintain LOC limits.
 *
 * @module modules/settings/settings.account.controller
 */

import { Request, Response, NextFunction } from "express";
import { userRepository } from "../../repositories/UserRepository";
import { householdRepository } from "../../repositories/HouseholdRepository";
import { verifyPassword } from "../../auth";
import { logger } from "../../utils/logger";
import { success } from "../../core/http";
import {
  ValidationError,
  NotFoundError,
  UnauthorizedError,
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
        throw new UnauthorizedError("Password is incorrect");
      }

      // This route is user-level (no householdGuard), so resolve the household
      // here before erasing.
      const household = await householdRepository.findByUserId(userId);
      if (!household) {
        throw new NotFoundError("Household not found");
      }

      // Capture identifiers BEFORE destroying the session, so the audit row
      // (written inside eraseAccount) records the real actor. Reading
      // req.session.userId after destroy() would yield undefined.
      const ipAddress = businessAuditService.getIpAddress(req);

      await accountDeletionService.eraseAccount({
        userId,
        householdId: household.id,
        userEmail: user.email,
        ipAddress,
      });

      logger.info("Account erased (right to erasure)", {
        userId: userId.substring(0, 8),
        householdId: household.id.substring(0, 8),
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

  async exportData(req: Request, res: Response, next: NextFunction) {
    try {
      // Placeholder for data export functionality
      await userRepository.findById(req.session.userId!);

      return success(res, { exportId: `export_${Date.now()}` }, 200, {
        message: "Data export initiated",
      });
    } catch (error) {
      next(error);
    }
  },
};
