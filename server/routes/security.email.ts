/**
 * Security Email Routes
 *
 * Email verification and change operations.
 *
 * @module routes/security.email
 */

import { Router, Request, Response } from "express";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  sendVerificationEmail,
  generateVerificationToken,
  isEmailServiceConfigured,
} from "../services/emailService";
import { z } from "zod";
import { requireAuth } from "../auth";
import { logger } from "../utils/logger";
import { strictLimiter } from "../middleware/rateLimit";
import { sha256Hex } from "../core/tokenHash";

const router = Router();

// POST /email/verify - Verify email with token (no auth required)
const verifyEmailSchema = z.object({
  token: z.string().min(1, "Token is required"),
});

// SEC-RATE-002: Rate limit email verification to prevent token enumeration attacks
router.post("/verify", strictLimiter, async (req: Request, res: Response) => {
  try {
    const validation = verifyEmailSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: { message: "Invalid token" },
      });
    }

    const { token } = validation.data;

    // Only the SHA-256 hash of the token is persisted; hash the incoming
    // raw token before looking it up (see server/core/tokenHash.ts).
    const tokenHash = sha256Hex(token);

    // Find user with this token
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.emailVerificationToken, tokenHash))
      .limit(1);

    if (!user) {
      return res.status(400).json({
        error: { message: "Invalid or expired verification link" },
      });
    }

    // Check token expiry
    if (
      user.emailVerificationExpiry &&
      new Date() > user.emailVerificationExpiry
    ) {
      return res.status(400).json({
        error: { message: "Verification link has expired" },
      });
    }

    // Update user - if pendingEmail exists, use it (email change), else verify current
    const updateData: Partial<typeof users.$inferInsert> = {
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpiry: null,
      updatedAt: new Date(),
    };

    if (user.pendingEmail) {
      updateData.email = user.pendingEmail;
      updateData.pendingEmail = null;
    }

    await db.update(users).set(updateData).where(eq(users.id, user.id));

    res.json({
      success: true,
      message: user.pendingEmail
        ? "Email address updated successfully"
        : "Email verified successfully",
    });
  } catch (error) {
    logger.error(
      "Error verifying email",
      { requestId: req.requestId },
      error as Error
    );
    res.status(500).json({ error: { message: "Failed to verify email" } });
  }
});

// All remaining email routes require authentication
router.use(requireAuth);

// POST /change - Request email change
const emailChangeSchema = z.object({
  newEmail: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required to change email"),
});

router.post("/change", async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const validation = emailChangeSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: {
          message: validation.error.errors[0].message,
          fields: validation.error.errors.map((e) => e.path.join(".")),
        },
      });
    }

    const { newEmail, password } = validation.data;

    // Get current user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return res.status(404).json({ error: { message: "User not found" } });
    }

    // Verify password
    const bcrypt = await import("bcryptjs");
    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      return res.status(401).json({ error: { message: "Invalid password" } });
    }

    // Check if email is already in use
    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, newEmail))
      .limit(1);

    if (existingUser) {
      return res.status(400).json({
        error: { message: "This email is already in use" },
      });
    }

    // Generate verification token. Only the SHA-256 hash is persisted; the
    // raw token is emailed (and, in dev, returned) below - never stored.
    const token = generateVerificationToken();
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Update user with pending email and verification token
    await db
      .update(users)
      .set({
        pendingEmail: newEmail,
        emailVerificationToken: sha256Hex(token),
        emailVerificationExpiry: expiry,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    // Send verification email
    await sendVerificationEmail(newEmail, token, true);

    // In development (when SMTP not configured), return the verification link
    const baseUrl = process.env.APP_URL || "http://localhost:5000";
    const verifyUrl = `${baseUrl}/verify-email?token=${token}`;

    const response: {
      success: boolean;
      message: string;
      devVerifyUrl?: string;
      devMessage?: string;
    } = {
      success: true,
      message: "Verification email sent to new address",
    };

    // Only expose verification URL in development mode when email is not configured
    if (!isEmailServiceConfigured() && process.env.NODE_ENV === "development") {
      response.devVerifyUrl = verifyUrl;
      response.devMessage = "SMTP not configured. Use this link to verify:";
      logger.warn(
        "Email service not configured - verification URL in response",
        {
          requestId: req.requestId,
          userId: userId?.substring(0, 8) + "...",
        }
      );
    }

    res.json(response);
  } catch (error) {
    logger.error(
      "Error changing email",
      {
        requestId: req.requestId,
        userId: req.session.userId?.substring(0, 8) + "...",
      },
      error as Error
    );
    res.status(500).json({ error: { message: "Failed to change email" } });
  }
});

// POST /resend - Resend verification email
router.post("/resend", async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return res.status(404).json({ error: { message: "User not found" } });
    }

    // Determine which email to send to
    const emailToVerify = user.pendingEmail || user.email;
    const isEmailChange = !!user.pendingEmail;

    // Generate new token. Only the hash is persisted; the raw token is
    // emailed below and never stored.
    const token = generateVerificationToken();
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await db
      .update(users)
      .set({
        emailVerificationToken: sha256Hex(token),
        emailVerificationExpiry: expiry,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    await sendVerificationEmail(emailToVerify, token, isEmailChange);

    res.json({
      success: true,
      message: "Verification email sent",
    });
  } catch (error) {
    logger.error(
      "Error resending verification",
      {
        requestId: req.requestId,
        userId: req.session.userId?.substring(0, 8) + "...",
      },
      error as Error
    );
    res
      .status(500)
      .json({ error: { message: "Failed to resend verification email" } });
  }
});

// POST /cancel - Cancel pending email change
router.post("/cancel", async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;

    await db
      .update(users)
      .set({
        pendingEmail: null,
        emailVerificationToken: null,
        emailVerificationExpiry: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    res.json({
      success: true,
      message: "Email change cancelled",
    });
  } catch (error) {
    logger.error(
      "Error cancelling email change",
      {
        requestId: req.requestId,
        userId: req.session.userId?.substring(0, 8) + "...",
      },
      error as Error
    );
    res
      .status(500)
      .json({ error: { message: "Failed to cancel email change" } });
  }
});

export default router;
