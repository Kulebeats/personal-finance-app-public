/**
 * Household Module - Controller
 *
 * HTTP handlers for household settings.
 * Member and invitation management extracted to separate controllers.
 *
 * @module modules/household/controller
 */

import { Request, Response, NextFunction } from "express";
import { householdRepository } from "../../repositories/HouseholdRepository";
import { userRepository } from "../../repositories/UserRepository";
import { logger } from "../../utils/logger";
import { z } from "zod";
import { success, created } from "../../core/http";
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  HouseholdNotFoundError,
} from "../../core/errors";
import { businessAuditService } from "../../services/BusinessAuditService";

// Re-export member and invitation controllers
import { membersController } from "./members.controller";
import { invitationsController } from "./invitations.controller";

// Re-export member and invitation controllers
export { membersController, invitationsController };

// Schemas
const createHouseholdSchema = z.object({
  name: z.string().min(1).max(255),
  currency: z.string().length(3).default("ZMW"),
});

const updateHouseholdSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  currency: z.string().length(3).optional(),
  fiscalYearStartMonth: z.number().min(1).max(12).optional(),
});

export const householdController = {
  ...membersController,
  ...invitationsController,
  async getGeneral(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.session.userId!;
      const household = await householdRepository.findByUserId(userId);
      if (!household) {
        // This is the "brand-new user, no household yet" case the client's
        // onboarding gate keys off. Use the distinguishable HOUSEHOLD_NOT_FOUND
        // code (not the generic NotFoundError code shared by every resource
        // type) so the client can branch structurally instead of on message
        // prose. Message text is unchanged for backward compatibility.
        throw new HouseholdNotFoundError();
      }

      const preferences = await userRepository.getUserPreferences(userId);
      success(res, { household, preferences });
    } catch (error) {
      next(error);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.session.userId!;
      const parseResult = createHouseholdSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      // Create the household, its owner membership, and default tags (CODE-003)
      // as one atomic unit. createWithOwner is the authoritative single-household
      // guard: it serializes concurrent creates per user with an advisory lock
      // and re-checks membership inside its transaction, throwing ConflictError
      // if the user already belongs to a household. A bare findByUserId pre-check
      // here would reintroduce a TOCTOU race (two concurrent creates both
      // passing it), so it is intentionally not duplicated.
      const household = await householdRepository.createWithOwner({
        name: parseResult.data.name,
        currency: parseResult.data.currency,
        userId,
      });

      const preferences = await userRepository.getUserPreferences(userId);

      // AUDIT-005: Log household creation
      await businessAuditService.logCreate({
        householdId: household.id,
        userId,
        entityType: "household_preferences",
        entityId: household.id,
        newValue: {
          name: household.name,
          currency: household.currency,
        },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      logger.info("Created household", { householdId: household.id });
      created(res, { household, preferences });
    } catch (error) {
      next(error);
    }
  },

  async updateGeneral(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.session.userId!;
      const parseResult = updateHouseholdSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors,
        );
      }

      const household = await householdRepository.findByUserId(userId);
      if (!household) {
        throw new NotFoundError("No household found");
      }

      // SCP-333: only owners/admins may rename the household or change its base
      // currency. Without this check a view_only (or plain member) could rename
      // the household or change the base currency. Mirrors the role-check
      // pattern in members.controller.ts.
      const currentMember = await householdRepository.findMember(
        household.id,
        userId,
      );
      if (!currentMember || !["owner", "admin"].includes(currentMember.role)) {
        throw new ForbiddenError(
          "Only owners and admins can change household settings",
        );
      }

      const oldValues = {
        name: household.name,
        currency: household.currency,
        fiscalYearStartMonth: household.fiscalYearStartMonth,
      };

      const updatedHousehold = await householdRepository.update(
        household.id,
        parseResult.data,
      );

      // AUDIT-006: Log settings updates
      await businessAuditService.logUpdate({
        householdId: household.id,
        userId,
        entityType: "household_preferences",
        entityId: household.id,
        oldValue: oldValues,
        newValue: parseResult.data,
        ipAddress: businessAuditService.getIpAddress(req),
        metadata: { action: "settings_update" },
      });

      success(res, { household: updatedHousehold });
    } catch (error) {
      next(error);
    }
  },
};
