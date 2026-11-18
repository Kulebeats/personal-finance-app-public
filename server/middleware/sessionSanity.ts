import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";
import "express-session";

/**
 * Middleware to ensure req.session exists.
 * Prevents 500 errors when session store fails or session is malformed.
 *
 * If req.session is undefined (e.g. store failure), we initialize an empty object
 * so that downstream code accessing req.session.userId simply sees 'undefined'
 * (unauthenticated) rather than crashing with "Cannot read property of undefined".
 */
export const sessionSanity = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!req.session) {
    // Only log warning if not in test (tests might mock things freely)
    if (process.env.NODE_ENV !== "test") {
      logger.warn(
        "Session object missing on request - treating as unauthenticated",
        {
          path: req.path,
          // Use safe IP access
          ip: req.ip || req.socket.remoteAddress,
        },
      );
    }

    // Initialize empty session to prevent crashes
    req.session = {} as typeof req.session;
  } else if (req.session.userId) {
    // SECURITY: Ensure userId is a valid UUID
    // This prevents attacks where userId is injected as a non-UUID string
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(req.session.userId)) {
      if (process.env.NODE_ENV !== "test") {
        logger.warn("Invalid non-UUID userId found in session - destroying", {
          ip: req.ip,
          invalidUserId: req.session.userId,
        });
      }
      req.session.destroy((err) => {
        if (err) logger.error("Failed to destroy invalid session", err);
      });
      // Clear session on request immediately
      req.session = {} as typeof req.session;
    }
  }
  next();
};
