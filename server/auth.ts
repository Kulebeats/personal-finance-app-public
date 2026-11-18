import { type Request, type Response, type NextFunction } from "express";
import bcrypt from "bcryptjs";
import { userRepository } from "./repositories/UserRepository";
import type { User } from "@shared/schema";
import { logger } from "./utils/logger";

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/**
 * Middleware to check if user is authenticated
 * FIX AUTH-SESSION-001: Also verify user exists and populate req.user
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required",
      },
    });
  }

  try {
    const user = await userRepository.findById(req.session.userId);
    if (!user) {
      // Session references deleted user - destroy session and return 401
      req.session.destroy((err) => {
        if (err) {
          logger.error(
            "Failed to destroy session for deleted user",
            { requestId: req.requestId },
            err
          );
        }
      });
      return res.status(401).json({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "User account no longer exists",
        },
      });
    }
    req.user = user;
    next();
  } catch (error) {
    logger.error(
      "Error verifying user existence in requireAuth",
      { requestId: req.requestId },
      error as Error
    );
    return res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to verify user",
      },
    });
  }
}

/**
 * FIX AUTH-SESSION-001: Middleware to check auth AND verify user exists
 * Use this instead of requireAuth for routes that use req.user!
 */
export async function requireAuthWithUser(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required",
      },
    });
  }

  try {
    const user = await userRepository.findById(req.session.userId);
    if (!user) {
      // Session references deleted user - destroy session and return 401
      req.session.destroy((err) => {
        if (err) {
          logger.error(
            "Failed to destroy session for deleted user",
            { requestId: req.requestId },
            err
          );
        }
      });
      return res.status(401).json({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "User account no longer exists",
        },
      });
    }
    req.user = user;
    next();
  } catch (error) {
    logger.error(
      "Error verifying user existence",
      { requestId: req.requestId },
      error as Error
    );
    return res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to verify user",
      },
    });
  }
}

/**
 * Middleware to attach user to request
 */
export async function attachUser(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (req.session.userId) {
    try {
      const user = await userRepository.findById(req.session.userId);
      if (user) {
        req.user = user;
      }
    } catch (error) {
      logger.error(
        "Error attaching user",
        { requestId: req.requestId },
        error as Error
      );
    }
  }
  next();
}

/**
 * Hash password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 12;
  return await bcrypt.hash(password, saltRounds);
}

/**
 * Verify password against hash
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return await bcrypt.compare(password, hash);
}

/**
 * Validate password complexity
 * Requirements: minimum 8 characters, uppercase, numbers, special characters
 */
export function validatePasswordComplexity(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push("Password must be at least 8 characters long");
  }

  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }

  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number");
  }

  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push("Password must contain at least one special character");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
