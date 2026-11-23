import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { redactSensitive, hashId } from "./log-redaction";

/**
 * Structured operational logging with bounded context redaction.
 * Messages should be static event labels; diagnostic values belong in context.
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

// Only exact source-declared static mount names may prefix a route template.
// Dynamic baseUrl/originalUrl/path values never become operational labels.
const staticMounts = new Set(["/api/auth", "/api/settings/security", "/api/settings", "/api/household", "/api/accounts",
  "/api/import", "/api/categories", "/api/merchants", "/api/tags", "/api/rules", "/api/reports", "/api/transactions",
  "/api/budgets", "/api/goals", "/api/recurring", "/api/receipts", "/api/notifications", "/api/investments/notifications",
  "/api/investments/tax", "/api/investments/pension", "/api/investments/recurring", "/api/investments/market",
  "/api/investments/grz/calculate", "/api/investments/grz", "/api/investments", "/api/grz", "/api/investments/analytics",
  "/api/weekly-recap", "/api/ai", "/api/filter-presets", "/api/cron", "/api/admin"]);
export function safeRouteTemplate(req: Pick<Request, "route" | "baseUrl">): string {
  const template: unknown = req.route?.path;
  if (typeof template !== "string") return "unmatched";
  const mount = staticMounts.has(req.baseUrl) ? req.baseUrl : req.baseUrl ? "mounted" : "";
  return `${mount}${template.replace(/\*/g, ":wildcard")}`;
}

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
 * Create structured log entry
 */
function createLogEntry(
  level: LogLevel,
  message: string,
  context?: LogContext,
  error?: Error
): string {
  const entry = {
    ...redactSensitive(context ?? {}),
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(error && { error: redactSensitive({ error }).error }),
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
      ...extra,
      requestId: req.requestId,
      householdId: req.householdContext?.householdId,
      userId: req.householdContext?.userId,
      route: safeRouteTemplate(req),
      method: req.method,
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
        route: safeRouteTemplate(req),
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
      route: safeRouteTemplate(req),
      method: req.method,
      statusCode: res.statusCode,
      duration,
    });
  });

  next();
}

export { redactSensitive, hashId };
