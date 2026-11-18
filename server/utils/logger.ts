import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

/**
 * Structured Logger - Production-ready logging with PII redaction
 * Phase 0A.4 - Observability foundation
 */

// Extend Express Request to include requestId
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

type LogLevel = "info" | "warn" | "error" | "debug";

interface LogContext {
  requestId?: string;
  householdId?: string;
  userId?: string;
  route?: string;
  method?: string;
  duration?: number;
  statusCode?: number;
  // SEC-05: Enhanced logging context
  ipAddress?: string;
  action?: string;
  outcome?: "success" | "failure" | "error";
  [key: string]: unknown;
}

/**
 * Hash sensitive IDs for logging (prevents PII exposure)
 */
function hashId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  // Simple hash for logging - just show first 8 chars
  return id.substring(0, 8) + "...";
}

/**
 * Redact sensitive fields from objects
 */
function redactSensitive(
  obj: Record<string, unknown>
): Record<string, unknown> {
  const sensitiveFields = [
    "password",
    "passwordHash",
    "secret",
    "token",
    "sessionToken",
    "nrc",
    "salaryRange",
    "annualIncome",
    "phoneNumber",
    "phoneNumberMobile",
    "email",
  ];

  const redacted = { ...obj };
  for (const field of sensitiveFields) {
    if (field in redacted) {
      redacted[field] = "[REDACTED]";
    }
  }
  return redacted;
}

/**
 * Create structured log entry
 */
function createLogEntry(
  level: LogLevel,
  message: string,
  context?: LogContext,
  error?: Error
): string {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    requestId: context?.requestId,
    householdId: hashId(context?.householdId),
    userId: hashId(context?.userId),
    route: context?.route,
    method: context?.method,
    duration: context?.duration,
    statusCode: context?.statusCode,
    ...(error && {
      error: {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
    }),
  };

  // Remove undefined values
  const cleaned = Object.fromEntries(
    Object.entries(entry).filter(([, v]) => v !== undefined)
  );

  return JSON.stringify(cleaned);
}

/**
 * Logger instance with methods for each log level
 */
export const logger = {
  info(message: string, context?: LogContext) {
    console.log(createLogEntry("info", message, context));
  },

  warn(message: string, context?: LogContext, error?: Error) {
    console.warn(createLogEntry("warn", message, context, error));
  },

  error(message: string, context?: LogContext, error?: Error) {
    console.error(createLogEntry("error", message, context, error));
  },

  debug(message: string, context?: LogContext) {
    if (process.env.NODE_ENV === "development") {
      console.debug(createLogEntry("debug", message, context));
    }
  },

  /**
   * Log API request with context
   */
  request(req: Request, message: string, extra?: Record<string, unknown>) {
    this.info(message, {
      requestId: req.requestId,
      householdId: req.householdContext?.householdId,
      userId: req.householdContext?.userId,
      route: req.path,
      method: req.method,
      ...extra,
    });
  },

  /**
   * Log API error with context
   */
  requestError(req: Request, message: string, error: Error) {
    this.error(
      message,
      {
        requestId: req.requestId,
        householdId: req.householdContext?.householdId,
        userId: req.householdContext?.userId,
        route: req.path,
        method: req.method,
      },
      error
    );
  },
};

/**
 * Middleware to generate and attach request ID
 * Also logs request start and completion
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Generate request ID
  req.requestId = randomUUID();
  res.setHeader("X-Request-ID", req.requestId);

  // Log request start
  const startTime = Date.now();

  // Log response when finished
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    const level = res.statusCode >= 400 ? "warn" : "info";

    logger[level]("Request completed", {
      requestId: req.requestId,
      route: req.path,
      method: req.method,
      statusCode: res.statusCode,
      duration,
    });
  });

  next();
}

export { redactSensitive, hashId };
