/**
 * Household Members Controller
 *
 * HTTP handlers for household member management.
 * Extracted from household.controller.ts for better organization.
 *
 * @module modules/household/members.controller
 */

import { Request, Response, NextFunction } from "express";
import { householdRepository } from "../../repositories/HouseholdRepository";
import { logger } from "../../utils/logger";
import { z } from "zod";
import { success } from "../../core/http";
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
} from "../../core/errors";
import { businessAuditService } from "../../services/BusinessAuditService";

// Schemas
const updateMemberRoleSchema = z.object({
  role: z.enum(["owner", "admin", "member", "view_only"]),
});

export const membersController = {
  async getMembers(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.session.userId!;
      const household = await householdRepository.findByUserId(userId);
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

      // PRIV-001: Filter out emails for non-admin/owner users
      // Note: Email comes from joined user data, not household_members table
      // Type assertion for member with potential email field from user join
      type MemberWithEmail = typeof members[number] & { email?: string };
      const sanitizedMembers = members.map(member => ({
        ...member,
        // Only expose email to owners and admins (email is from user join if available)
        email: canViewEmails ? (member as MemberWithEmail).email : undefined,
      }));

      success(res, { members: sanitizedMembers });
    } catch (error) {
      next(error);
    }
  },

  async updateMemberRole(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId: targetUserId } = req.params;
      const currentUserId = req.session.userId!;
      const parseResult = updateMemberRoleSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors
        );
      }

      const household = await householdRepository.findByUserId(currentUserId);
      if (!household) {
        throw new NotFoundError("No household found");
      }

      // SEC-CRITICAL-002: Check current user role - only owner/admin can change roles
      const currentMember = await householdRepository.findMember(
        household.id,
        currentUserId
      );
      if (!currentMember || !["owner", "admin"].includes(currentMember.role)) {
        throw new ForbiddenError("Only owners and admins can change member roles");
      }

      // SEC-CRITICAL-002: Prevent self-modification of role
      if (targetUserId === currentUserId) {
        throw new ValidationError("Cannot modify your own role");
      }

      // SEC-CRITICAL-002: Prevent non-owners from changing owner role or promoting to owner
      const targetMember = await householdRepository.findMember(
        household.id,
        targetUserId
      );
      if (!targetMember) {
        throw new NotFoundError("Member not found");
      }

      if (currentMember.role !== "owner") {
        // Admins cannot demote owners or promote to owner
        if (targetMember.role === "owner") {
          throw new ForbiddenError("Only owners can modify owner roles");
        }
        if (parseResult.data.role === "owner") {
          throw new ForbiddenError("Only owners can promote members to owner");
        }
      }

      const oldRole = targetMember.role;
      // SCP-333: write the role change atomically (locked, re-checked under the
      // lock) so a concurrent remove/transfer can't race the read-then-write.
      const updated = await householdRepository.updateMemberRoleAtomic(
        household.id,
        targetUserId,
        parseResult.data.role
      );

      // Audit logging
      await businessAuditService.logUpdate({
        householdId: household.id,
        userId: currentUserId,
        entityType: "user",
        entityId: targetUserId,
        oldValue: { role: oldRole },
        newValue: { role: parseResult.data.role },
        ipAddress: businessAuditService.getIpAddress(req),
        metadata: { action: "role_change" },
      });

      success(res, { member: updated });
    } catch (error) {
      next(error);
    }
  },

  async removeMember(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId: targetUserId } = req.params;
      const currentUserId = req.session.userId!;

      const household = await householdRepository.findByUserId(currentUserId);
      if (!household) {
        throw new NotFoundError("No household found");
      }

      // Cannot remove self
      if (targetUserId === currentUserId) {
        throw new ValidationError("Cannot remove yourself");
      }

      // SEC-CRITICAL-002: Check current user role - only owner/admin can remove members
      const currentMember = await householdRepository.findMember(
        household.id,
        currentUserId
      );
      if (!currentMember || !["owner", "admin"].includes(currentMember.role)) {
        throw new ForbiddenError("Only owners and admins can remove members");
      }

      // SEC-CRITICAL-002: Verify target member exists and check role hierarchy
      const targetMember = await householdRepository.findMember(
        household.id,
        targetUserId
      );
      if (!targetMember) {
        throw new NotFoundError("Member not found");
      }

      // Admins cannot remove owners
      if (currentMember.role !== "owner" && targetMember.role === "owner") {
        throw new ForbiddenError("Only owners can remove other owners");
      }

      // HOUSEHOLD-EDGE-003 + SCP-333: remove the member atomically with a
      // race-safe last-member guard. The member rows are locked FOR UPDATE and
      // the "not the last member" invariant is re-checked under the lock before
      // the delete, so two concurrent removals can't both pass the count check
      // and empty the household.
      await householdRepository.removeMemberWithLastMemberGuard(
        household.id,
        targetUserId
      );

      // Audit logging
      await businessAuditService.logDelete({
        householdId: household.id,
        userId: currentUserId,
        entityType: "user",
        entityId: targetUserId,
        oldValue: { role: targetMember.role },
        ipAddress: businessAuditService.getIpAddress(req),
        metadata: { action: "member_removed" },
      });

      success(res, null);
    } catch (error) {
      next(error);
    }
  },

  async transferOwnership(req: Request, res: Response, next: NextFunction) {
    try {
      const currentUserId = req.session.userId!;
      const parseResult = z
        .object({ newOwnerId: z.string().uuid() })
        .safeParse(req.body);

      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors
        );
      }

      const household = await householdRepository.findByUserId(currentUserId);
      if (!household) {
        throw new NotFoundError("No household found");
      }

      // Only current owner can transfer ownership
      const currentMember = await householdRepository.findMember(
        household.id,
        currentUserId
      );
      if (!currentMember || currentMember.role !== "owner") {
        throw new ForbiddenError("Only the owner can transfer ownership");
      }

      // Verify target member exists
      const targetMember = await householdRepository.findMember(
        household.id,
        parseResult.data.newOwnerId
      );
      if (!targetMember) {
        throw new NotFoundError("Target member not found");
      }

      // SCP-318: transfer ownership atomically (locked, re-checked) so a partial
      // failure or a concurrent transfer can't leave two owners or no owner.
      await householdRepository.transferOwnership(
        household.id,
        currentUserId,
        parseResult.data.newOwnerId
      );

      // Audit logging
      await businessAuditService.log({
        householdId: household.id,
        userId: currentUserId,
        action: "TRANSFER",
        entityType: "user",
        entityId: parseResult.data.newOwnerId,
        details: {
          action: "ownership_transfer",
          fromUserId: currentUserId,
          toUserId: parseResult.data.newOwnerId,
        },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      logger.info("Ownership transferred", {
        householdId: household.id,
        fromUserId: currentUserId,
        toUserId: parseResult.data.newOwnerId,
      });

      success(res, { transferred: true });
    } catch (error) {
      next(error);
    }
  },

  async leaveHousehold(req: Request, res: Response, next: NextFunction) {
    try {
      const currentUserId = req.session.userId!;

      const household = await householdRepository.findByUserId(currentUserId);
      if (!household) {
        throw new NotFoundError("No household found");
      }

      const currentMember = await householdRepository.findMember(
        household.id,
        currentUserId
      );
      if (!currentMember) {
        throw new NotFoundError("Not a member of any household");
      }

      // Owner cannot leave without transferring ownership first
      if (currentMember.role === "owner") {
        throw new ForbiddenError(
          "Owner must transfer ownership before leaving household"
        );
      }

      // Remove self from household
      await householdRepository.removeMember(household.id, currentUserId);

      // Audit logging
      await businessAuditService.log({
        householdId: household.id,
        userId: currentUserId,
        action: "DELETE",
        entityType: "user",
        entityId: currentUserId,
        details: {
          action: "self_removal",
          role: currentMember.role,
        },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      logger.info("User left household", {
        householdId: household.id,
        userId: currentUserId,
      });

      success(res, { left: true });
    } catch (error) {
      next(error);
    }
  },
};
