/**
 * Household Members Controller
 *
 * HTTP handlers for household member management. Request → validation →
 * ownership service → response. Every rule about who may change which role,
 * and the one-owner invariant, is enforced inside ownership.service under row
 * locks (NEW-12); nothing here reads membership to make a write decision.
 *
 * @module modules/household/members.controller
 */

import { Request, Response, NextFunction } from "express";
import { resolveRequestHousehold } from "../../core/authz/session-preconditions";
import { householdRepository } from "../../repositories/HouseholdRepository";
import { logger } from "../../utils/logger";
import { z } from "zod";
import { success } from "../../core/http";
import { ValidationError, NotFoundError } from "../../core/errors";
import { businessAuditService } from "../../services/BusinessAuditService";
import * as ownershipService from "./ownership.service";
import type { OwnershipActor } from "./ownership.service";
import { HOUSEHOLD_ROLES, type HouseholdMemberDto } from "@shared/household-members";

/** Shown only if a membership's user record is missing. */
const UNNAMED_MEMBER = "Household member";

// Schemas
const updateMemberRoleSchema = z.object({
  // "owner" parses so the service can answer 409 "use transfer ownership".
  role: z.enum(HOUSEHOLD_ROLES),
});
const transferOwnershipSchema = z.object({ newOwnerId: z.string().uuid() });

async function resolveActor(req: Request): Promise<OwnershipActor> {
  const actorUserId = req.session.userId!;
  const household = await resolveRequestHousehold(req, actorUserId);
  if (!household) {
    throw new NotFoundError("Household");
  }
  return {
    householdId: household.id,
    actorUserId,
    ipAddress: businessAuditService.getIpAddress(req),
  };
}

export const membersController = {
  async getMembers(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.session.userId!;
      const household = await resolveRequestHousehold(req, userId);
      if (!household) {
        throw new NotFoundError("No household found");
      }

      // PRIV-001: Check current user's role
      const currentMember = await householdRepository.findMember(
        household.id,
        userId
      );
      const canViewEmails = currentMember && ["owner", "admin"].includes(currentMember.role);

      const members = await householdRepository.findMembers(household.id);

      // AH-05: an explicit allow-list (shared/household-members.ts), even if
      // the repository later joins more user columns. Only owners and admins
      // see member email addresses.
      const memberDtos: HouseholdMemberDto[] = members.flatMap((member) =>
        member.userId
          ? [{
              userId: member.userId,
              name: member.name ?? UNNAMED_MEMBER,
              ...(canViewEmails && member.email ? { email: member.email } : {}),
              role: member.role,
              joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null,
            }]
          : [],
      );

      success(res, { members: memberDtos });
    } catch (error) {
      next(error);
    }
  },

  async updateMemberRole(req: Request, res: Response, next: NextFunction) {
    try {
      const parseResult = updateMemberRoleSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors
        );
      }

      const actor = await resolveActor(req);
      const updated = await ownershipService.changeMemberRole(
        actor,
        req.params.userId,
        parseResult.data.role
      );

      success(res, { member: updated });
    } catch (error) {
      next(error);
    }
  },

  async removeMember(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = await resolveActor(req);
      await ownershipService.removeMember(actor, req.params.userId);

      success(res, null);
    } catch (error) {
      next(error);
    }
  },

  async transferOwnership(req: Request, res: Response, next: NextFunction) {
    try {
      const parseResult = transferOwnershipSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors
        );
      }

      const actor = await resolveActor(req);
      await ownershipService.transferOwnership(actor, parseResult.data.newOwnerId);

      logger.info("Ownership transferred", {
        householdId: actor.householdId,
        fromUserId: actor.actorUserId,
        toUserId: parseResult.data.newOwnerId,
      });

      success(res, { transferred: true });
    } catch (error) {
      next(error);
    }
  },

  async leaveHousehold(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = await resolveActor(req);
      await ownershipService.leaveHousehold(actor);

      logger.info("User left household", {
        householdId: actor.householdId,
        userId: actor.actorUserId,
      });

      success(res, { left: true });
    } catch (error) {
      next(error);
    }
  },
};
