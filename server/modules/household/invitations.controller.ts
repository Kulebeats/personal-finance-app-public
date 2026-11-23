/**
 * Household Invitations Controller
 *
 * HTTP handlers for household invitation management.
 * Extracted from household.controller.ts for better organization.
 *
 * @module modules/household/invitations.controller
 */

import { Request, Response, NextFunction } from "express";
import { resolveRequestHousehold } from "../../core/authz/session-preconditions";
import { householdRepository } from "../../repositories/HouseholdRepository";
import { userRepository } from "../../repositories/UserRepository";
import { logger } from "../../utils/logger";
import { z } from "zod";
import { success, created, noContent } from "../../core/http";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from "../../core/errors";
import { businessAuditService } from "../../services/BusinessAuditService";
import { assertMayGrantRole } from "./ownership.service";
import { sendEmail } from "../../services/emailService";
import { acceptInvitation, normalizeInviteEmail } from "./invitations.accept";
import { INVITABLE_ROLES } from "@shared/household-members";
import { buildInvitationEmailTemplate } from "./invitations.email-template";
import {
  generateInviteCode,
  invitationExpiresAt,
  rotateInvitationForResend,
} from "./invitations.resend";

// Constants
const APP_URL = (process.env.APP_URL || "http://localhost:5173").replace(
  /\/$/,
  ""
);

// Schemas
const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(INVITABLE_ROLES).default("member"),
});

async function sendInvitationEmail(params: {
  email: string;
  inviterName: string;
  householdName: string;
  role: string;
  inviteUrl: string;
  expiresAt: Date;
}): Promise<boolean> {
  const html = buildInvitationEmailTemplate({
    inviterName: params.inviterName,
    householdName: params.householdName,
    role: params.role,
    inviteUrl: params.inviteUrl,
    expiresAt: params.expiresAt,
    recipientEmail: params.email,
  });

  return sendEmail({
    to: params.email,
    subject: `Invitation to join ${params.householdName}`,
    html,
    text: `${params.inviterName} invited you to join ${params.householdName} as ${params.role.replace(
      "_",
      " "
    )}. Accept here: ${params.inviteUrl}. Expires on ${params.expiresAt.toISOString()}.`,
  });
}

export const invitationsController = {
  async inviteMember(req: Request, res: Response, next: NextFunction) {
    try {
      const currentUserId = req.session.userId!;
      const parseResult = inviteMemberSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors
        );
      }

      const household = await resolveRequestHousehold(req, currentUserId);
      if (!household) {
        throw new NotFoundError("No household found");
      }

      // SEC-CRITICAL-002: Check current user role - only owner/admin can invite
      const currentMember = await householdRepository.findMember(
        household.id,
        currentUserId
      );
      if (!currentMember || !["owner", "admin"].includes(currentMember.role)) {
        throw new ForbiddenError("Only owners and admins can invite members");
      }
      assertMayGrantRole(currentMember.role, parseResult.data.role); // §A3: admin invites are owner-only

      const normalizedEmail = normalizeInviteEmail(parseResult.data.email);

      // Check if user is already a member of this household
      const existingUser = await userRepository.findByEmail(normalizedEmail);
      if (existingUser) {
        const existingMember = await householdRepository.findMember(
          household.id,
          existingUser.id
        );
        if (existingMember) {
          throw new ConflictError("User is already a member of this household");
        }
      }

      // Check if there's already a pending invitation for this email
      const existingInvitation =
        await householdRepository.findPendingInvitationByEmail(
          household.id,
          normalizedEmail
        );
      if (existingInvitation) {
        throw new ConflictError(
          "An invitation for this email is already pending"
        );
      }

      const inviteCode = generateInviteCode();
      const expiresAt = invitationExpiresAt();

      // Create the invitation
      const invitation = await householdRepository.createInvitation({
        householdId: household.id,
        email: normalizedEmail,
        role: parseResult.data.role,
        inviteCode,
        invitedBy: currentUserId,
        expiresAt,
      });

      const invitePath = `/invite/${inviteCode}`;
      const inviteUrl = `${APP_URL}${invitePath}`;
      const inviter =
        (await userRepository.findById(currentUserId)) ?? null;
      const inviterName =
        inviter?.fullName || inviter?.displayName || inviter?.username || "A household member";

      const emailSent = await sendInvitationEmail({
        email: normalizedEmail,
        inviterName,
        householdName: household.name,
        role: parseResult.data.role,
        inviteUrl,
        expiresAt,
      });

      logger.info("Invitation created", {
        householdId: household.id,
        invitationId: invitation.id,
        email: `${normalizedEmail.slice(0, 2)}***`,
        role: parseResult.data.role,
        expiresAt,
        emailSent,
      });

      // Audit logging
      await businessAuditService.logCreate({
        householdId: household.id,
        userId: currentUserId,
        entityType: "household_invitation",
        entityId: invitation.id,
        newValue: {
          email: normalizedEmail,
          role: parseResult.data.role,
          expiresAt: expiresAt.toISOString(),
        },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      created(res, {
        invitation: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  async acceptInvite(req: Request, res: Response, next: NextFunction) {
    try {
      const currentUserId = req.session.userId!;
      const parseResult = z
        .object({ inviteCode: z.string().min(1).max(100) })
        .safeParse(req.body);

      if (!parseResult.success) {
        throw new ValidationError(
          "Invalid request data",
          parseResult.error.errors
        );
      }

      // AH-06: every check, the join and its audit row run in one locked
      // transaction (invitations.accept.ts).
      const accepted = await acceptInvitation(
        { userId: currentUserId, ipAddress: businessAuditService.getIpAddress(req) },
        parseResult.data.inviteCode
      );

      logger.info("Invitation accepted", {
        householdId: accepted.household.id,
        userId: currentUserId,
        role: accepted.role,
      });

      success(res, { accepted: true, ...accepted });
    } catch (error) {
      next(error);
    }
  },

  async resendInvite(req: Request, res: Response, next: NextFunction) {
    try {
      const { inviteId } = req.params;
      const currentUserId = req.session.userId!;

      const household = await resolveRequestHousehold(req, currentUserId);
      if (!household) {
        throw new NotFoundError("No household found");
      }

      // AH-05: a new code and a fresh expiry, locked and audited in one
      // transaction (invitations.resend.ts). The old link stops working.
      const { invitation, inviteCode } = await rotateInvitationForResend(
        {
          userId: currentUserId,
          householdId: household.id,
          ipAddress: businessAuditService.getIpAddress(req),
        },
        inviteId
      );
      const newExpiresAt = invitation.expiresAt;

      const invitePath = `/invite/${inviteCode}`;
      const inviteUrl = `${APP_URL}${invitePath}`;
      const inviter =
        (await userRepository.findById(currentUserId)) ?? null;
      const inviterName =
        inviter?.fullName || inviter?.displayName || inviter?.username || "A household member";
      const emailSent = await sendInvitationEmail({
        email: invitation.email,
        inviterName,
        householdName: household.name,
        role: invitation.role,
        inviteUrl,
        expiresAt: newExpiresAt,
      });

      logger.info("Invitation resent", {
        householdId: household.id,
        invitationId: invitation.id,
        email: `${invitation.email.slice(0, 2)}***`,
        newExpiresAt,
        emailSent,
      });

      success(res, {
        invitation: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expiresAt: newExpiresAt,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  async getInvitations(req: Request, res: Response, next: NextFunction) {
    try {
      const currentUserId = req.session.userId!;

      const household = await resolveRequestHousehold(req, currentUserId);
      if (!household) {
        throw new NotFoundError("No household found");
      }

      // Check permissions
      const currentMember = await householdRepository.findMember(
        household.id,
        currentUserId
      );
      if (!currentMember || !["owner", "admin"].includes(currentMember.role)) {
        throw new ForbiddenError("Only owners and admins can view invitations");
      }

      // Fetch pending invitations
      const invitations =
        await householdRepository.findPendingInvitationsByHousehold(
          household.id
        );

      logger.info("Fetched invitations", {
        householdId: household.id,
        count: invitations.length,
      });

      // Map to safe response format (exclude inviteCode)
      const safeInvitations = invitations.map((inv) => ({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        invitedBy: inv.invitedBy,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt,
      }));

      success(res, { invitations: safeInvitations });
    } catch (error) {
      next(error);
    }
  },

  async cancelInvitation(req: Request, res: Response, next: NextFunction) {
    try {
      const { inviteId } = req.params;
      const currentUserId = req.session.userId!;

      const household = await resolveRequestHousehold(req, currentUserId);
      if (!household) {
        throw new NotFoundError("No household found");
      }

      // Check permissions
      const currentMember = await householdRepository.findMember(
        household.id,
        currentUserId
      );
      if (!currentMember || !["owner", "admin"].includes(currentMember.role)) {
        throw new ForbiddenError("Only owners and admins can cancel invitations");
      }

      // Find the invitation first to verify it exists
      const invitation = await householdRepository.findInvitationById(
        inviteId,
        household.id
      );
      if (!invitation) {
        throw new NotFoundError("Invitation not found");
      }

      // Check if already accepted
      if (invitation.acceptedAt) {
        throw new ConflictError(
          "Cannot cancel an invitation that has already been accepted"
        );
      }

      // Delete the invitation
      await householdRepository.deleteInvitation(inviteId, household.id);

      logger.info("Invitation cancelled", {
        householdId: household.id,
        invitationId: inviteId,
        email: invitation.email,
      });

      // Audit logging
      await businessAuditService.logDelete({
        householdId: household.id,
        userId: currentUserId,
        entityType: "household_invitation",
        entityId: inviteId,
        oldValue: {
          email: invitation.email,
          role: invitation.role,
          invitedBy: invitation.invitedBy,
        },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      noContent(res);
    } catch (error) {
      next(error);
    }
  },
};
