/**
 * Household Invitations Controller
 *
 * HTTP handlers for household invitation management.
 * Extracted from household.controller.ts for better organization.
 *
 * @module modules/household/invitations.controller
 */

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
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
import { sendEmail } from "../../services/emailService";
import {
  assertInvitationAcceptableBy,
  normalizeInviteEmail,
} from "./invitations.accept";

// Constants
const INVITATION_EXPIRY_DAYS = 7;
const APP_URL = (process.env.APP_URL || "http://localhost:5173").replace(
  /\/$/,
  ""
);

// Schemas
const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member", "view_only"]).default("member"),
});

function buildInvitationEmailTemplate(params: {
  inviterName: string;
  householdName: string;
  role: string;
  inviteUrl: string;
  expiresAt: Date;
  recipientEmail: string;
}): string {
  const { inviterName, householdName, role, inviteUrl, expiresAt, recipientEmail } =
    params;
  const expiresOn = expiresAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `
  <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #111827; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h1 style="margin-bottom: 8px;">Household Invitation</h1>
      <p><strong>${inviterName}</strong> invited you to join <strong>${householdName}</strong> as <strong>${role.replace("_", " ")}</strong>.</p>
      <p>This invitation expires on <strong>${expiresOn}</strong>.</p>
      <p style="margin: 24px 0;">
        <a href="${inviteUrl}" style="display: inline-block; background: #f97316; color: #ffffff; text-decoration: none; padding: 12px 18px; border-radius: 6px; font-weight: 600;">Accept Invitation</a>
      </p>
      <p>If the button does not work, open this link:</p>
      <p><a href="${inviteUrl}" style="word-break: break-all;">${inviteUrl}</a></p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
      <p style="font-size: 12px; color: #6b7280;">This invitation was sent to ${recipientEmail}.</p>
    </body>
  </html>
  `;
}

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

      const household = await householdRepository.findByUserId(currentUserId);
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

      // Generate secure invite code (64 hex chars from 32 random bytes)
      const inviteCode = crypto.randomBytes(32).toString("hex");

      // Set expiration to 7 days from now
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);

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
        inviteUrl: invitePath,
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

      // Find the invitation by code
      const invitation = await householdRepository.findInvitationByCode(
        parseResult.data.inviteCode
      );

      if (!invitation) {
        throw new NotFoundError("Invitation not found or invalid code");
      }

      // Unused, unexpired, and addressed to the signed-in user's email
      await assertInvitationAcceptableBy(invitation, currentUserId);

      // Check if user is already a member of this household
      const existingMember = await householdRepository.findMember(
        invitation.householdId,
        currentUserId
      );
      if (existingMember) {
        throw new ConflictError("You are already a member of this household");
      }

      // Check if user already belongs to another household
      const userHousehold = await householdRepository.findByUserId(currentUserId);
      if (userHousehold) {
        throw new ConflictError(
          "You are already a member of another household. Leave that household first to join a new one."
        );
      }

      // SCP-318: add the member + mark the invitation accepted atomically (with
      // the invitation row locked and re-checked) so concurrent accepts of the
      // same code can't double-add the member or reuse the invite.
      await householdRepository.acceptInvite(
        invitation.id,
        invitation.householdId,
        currentUserId,
        invitation.role
      );

      // Get the household details to return
      const household = await householdRepository.findById(invitation.householdId);

      logger.info("Invitation accepted", {
        invitationId: invitation.id,
        householdId: invitation.householdId,
        userId: currentUserId,
        role: invitation.role,
      });

      // Audit logging
      await businessAuditService.log({
        householdId: invitation.householdId,
        userId: currentUserId,
        action: "CREATE",
        entityType: "household_member",
        entityId: currentUserId,
        details: {
          invitationId: invitation.id,
          email: invitation.email,
          role: invitation.role,
          invitedBy: invitation.invitedBy,
        },
        ipAddress: businessAuditService.getIpAddress(req),
      });

      success(res, {
        accepted: true,
        household: household
          ? {
              id: household.id,
              name: household.name,
              currency: household.currency,
            }
          : null,
        role: invitation.role,
      });
    } catch (error) {
      next(error);
    }
  },

  async resendInvite(req: Request, res: Response, next: NextFunction) {
    try {
      const { inviteId } = req.params;
      const currentUserId = req.session.userId!;

      const household = await householdRepository.findByUserId(currentUserId);
      if (!household) {
        throw new NotFoundError("No household found");
      }

      // Check permissions
      const currentMember = await householdRepository.findMember(
        household.id,
        currentUserId
      );
      if (!currentMember || !["owner", "admin"].includes(currentMember.role)) {
        throw new ForbiddenError("Only owners and admins can resend invitations");
      }

      // Find the invitation
      const invitation = await householdRepository.findInvitationById(
        inviteId,
        household.id
      );
      if (!invitation) {
        throw new NotFoundError("Invitation not found");
      }

      // Check if already accepted
      if (invitation.acceptedAt) {
        throw new ConflictError("This invitation has already been accepted");
      }

      // Update expiration to 7 days from now
      const newExpiresAt = new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + INVITATION_EXPIRY_DAYS);

      const updatedInvitation = await householdRepository.updateInvitationExpiry(
        inviteId,
        household.id,
        newExpiresAt
      );

      const invitePath = `/invite/${invitation.inviteCode}`;
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

      // Audit logging
      await businessAuditService.logUpdate({
        householdId: household.id,
        userId: currentUserId,
        entityType: "household_invitation",
        entityId: invitation.id,
        oldValue: { expiresAt: invitation.expiresAt },
        newValue: { expiresAt: newExpiresAt },
        ipAddress: businessAuditService.getIpAddress(req),
        metadata: { action: "resend_invitation" },
      });

      success(res, {
        invitation: {
          id: updatedInvitation?.id ?? invitation.id,
          email: invitation.email,
          role: invitation.role,
          expiresAt: newExpiresAt,
        },
        inviteUrl: invitePath,
      });
    } catch (error) {
      next(error);
    }
  },

  async getInvitations(req: Request, res: Response, next: NextFunction) {
    try {
      const currentUserId = req.session.userId!;

      const household = await householdRepository.findByUserId(currentUserId);
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

      const household = await householdRepository.findByUserId(currentUserId);
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
