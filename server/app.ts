import { type Server } from "node:http";

import express, {
  type Express,
  type Request,
  Response,
  NextFunction,
} from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { doubleCsrf } from "csrf-csrf";
import { sessionSanity } from "./middleware/sessionSanity";
import { pool } from "./db";
import { registerRoutes } from "./routes";
import { attachUser, requireAuth } from "./auth";
import { householdGuard } from "./middleware/householdGuard";
import { serveUpload } from "./middleware/uploadsAuth";
import { requestIdMiddleware, logger } from "./utils/logger";
import { apiErrorMiddleware } from "./utils/errorHandler";
import { initializeServices } from "./startup";
import { validateEnvOrThrow } from "./utils/validateEnv";

// SEC-STARTUP-001: Validate environment variables before app initialization
// This prevents the app from starting with missing/invalid configuration
validateEnvOrThrow();

export const app = express();
app.locals.isShuttingDown = false;

// Behind a TLS-terminating proxy/load balancer (Render and most PaaS), Express
// must trust the proxy so `secure` session cookies are set and req.ip reflects
// the real client (correct rate limiting). Defaults on in production; override
// with TRUST_PROXY ("true"/"false", a hop count, or an Express trust list).
const trustProxyRaw = process.env.TRUST_PROXY;
let trustProxy: boolean | number | string | undefined;
if (trustProxyRaw === undefined || trustProxyRaw === "") {
  trustProxy = process.env.NODE_ENV === "production" ? 1 : undefined;
} else if (trustProxyRaw === "true") {
  trustProxy = true;
} else if (trustProxyRaw === "false") {
  trustProxy = false;
} else {
  const hops = Number(trustProxyRaw);
  trustProxy = Number.isNaN(hops) ? trustProxyRaw : hops;
}
if (trustProxy !== undefined) {
  app.set("trust proxy", trustProxy);
}

// Security middleware
// Enhanced security headers for production, relaxed for development
const isDevelopment = process.env.NODE_ENV !== "production";
app.use(
  helmet({
    // Content Security Policy - restrict resource loading
    contentSecurityPolicy: isDevelopment
      ? false
      : {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: [
              "'self'",
              "'unsafe-inline'",
              "https://fonts.googleapis.com",
            ],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            connectSrc: ["'self'"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            upgradeInsecureRequests: [],
            // CSP violation reporting - set CSP_REPORT_URI to receive reports
            // Example: https://your-csp-reporting-service.com/report
            ...(process.env.CSP_REPORT_URI && {
              reportUri: [process.env.CSP_REPORT_URI],
            }),
          },
        },
    // HTTP Strict Transport Security - force HTTPS
    hsts: isDevelopment
      ? false
      : {
          maxAge: 31536000, // 1 year
          includeSubDomains: true,
          preload: true,
        },
    // Prevent clickjacking
    frameguard: { action: "deny" },
    // Hide X-Powered-By header
    hidePoweredBy: true,
    // Prevent MIME type sniffing
    noSniff: true,
    // XSS filter (legacy browsers)
    xssFilter: true,
    // Referrer Policy - control referrer information
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }),
);

// CORS configuration with production validation
const corsOrigin = process.env.CLIENT_URL;
if (!corsOrigin && process.env.NODE_ENV === "production") {
  throw new Error("CLIENT_URL environment variable is required in production");
}

app.use(
  cors({
    origin: corsOrigin || "http://localhost:5000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Request-ID",
      "X-CSRF-Token",
    ],
  }),
);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: false }));

// Session configuration
if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}

const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "session",
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
  }),
);

// Ensure session object exists to prevent 500s
app.use(sessionSanity);

// Cookie parser (MUST be after express-session when using csrf-csrf)
app.use(cookieParser());

// CSRF Protection using double-submit cookie pattern
const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.SESSION_SECRET || "dev-secret",
  getSessionIdentifier: (req) => {
    // Use session ID if available, otherwise use a cookie-based identifier
    return req.sessionID || req.cookies?.["connect.sid"] || "anonymous";
  },
  cookieName:
    process.env.NODE_ENV === "production" ? "__Host-csrf" : "csrf-token",
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  },
  size: 64,
  getCsrfTokenFromRequest: (req) => req.headers["x-csrf-token"] as string,
});

// Export for use in routes
export { generateCsrfToken };

// Apply CSRF protection to all routes except safe methods
app.use((req, res, next) => {
  // Skip CSRF for safe methods and specific paths
  if (
    process.env.NODE_ENV === "test" || // Skip CSRF in test environment
    ["GET", "HEAD", "OPTIONS"].includes(req.method) ||
    req.path === "/api/csrf-token" ||
    req.path.startsWith("/healthz") ||
    req.path.startsWith("/api/cron") || // Cron uses secret header auth
    req.path === "/api/auth/login" || // Pre-auth routes don't need CSRF
    req.path === "/api/auth/verify-mfa" || // Pre-auth MFA verification
    req.path === "/api/auth/mfa/verify" || // Pre-auth MFA verification
    req.path === "/api/auth/mfa/resend" || // Pre-auth MFA code resend (rate-limited)
    req.path === "/api/auth/resend-verification" || // Pre-auth email resend (rate-limited)
    req.path === "/api/auth/forgot-password" || // Pre-auth reset request (strict rate limit)
    req.path === "/api/auth/reset-password" || // Pre-auth reset completion (strict rate limit)
    req.path === "/api/auth/register" ||
    req.path === "/api/auth/logout" // Logout is safe to exempt - only destroys current session
  ) {
    return next();
  }
  doubleCsrfProtection(req, res, next);
});

// Attach user to request if authenticated
app.use(attachUser);

// Request ID middleware - generates unique ID for each request
app.use(requestIdMiddleware);

// SEC-327 (CWE-639): Serve uploaded files behind authentication and an
// ownership check instead of an unauthenticated static mount. Files are
// household-scoped (uploads/{type}/{householdId}/...); requireAuth +
// householdGuard establish the caller's household, and serveUpload rejects
// path traversal and cross-household access.
app.get("/uploads/*", requireAuth, householdGuard, serveUpload);

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      // Only log request metadata, NOT response bodies (PII risk)
      const logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      logger.info(logLine, { requestId: req.requestId });
    }
  });

  next();
});

export default async function runApp(
  setup: (app: Express, server: Server) => Promise<void>,
) {
  // Initialize core services (FX rates, etc.)
  initializeServices();

  const server = await registerRoutes(app);

  // Health check endpoint (Kubernetes-style)
  app.get("/healthz", (_req: Request, res: Response) => {
    if (app.locals.isShuttingDown) {
      res.status(503).json({ status: "shutting_down" });
      return;
    }
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Use structured error middleware
  app.use(apiErrorMiddleware);

  // Fallback error handler for unhandled errors
  app.use((err: Error & { status?: number; statusCode?: number }, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    const statusMap: Record<number, { code: string; message: string }> = {
      401: {
        code: "UNAUTHORIZED",
        message: "Authentication required. Please sign in and try again.",
      },
      403: {
        code: "FORBIDDEN",
        message: "Access denied.",
      },
      429: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please wait and try again.",
      },
    };

    const mapped = statusMap[status];
    const errorCode =
      mapped?.code || (status >= 500 ? "SERVER_ERROR" : "HTTP_ERROR");
    const errorMessage =
      status >= 500
        ? "An unexpected error occurred"
        : message || mapped?.message || "Request failed";

    // Log using structured logger
    logger.error(
      "Unhandled error",
      {
        requestId: req.requestId,
        route: req.path,
        method: req.method,
        statusCode: status,
      },
      err,
    );

    res.status(status).json({
      success: false,
      error: {
        code: errorCode,
        message: errorMessage,
      },
    });
  });

  // importantly run the final setup after setting up all the other routes so
  // the catch-all route doesn't interfere with the other routes
  await setup(app, server);

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST || "0.0.0.0";
  server.listen(port, host, () => {
    logger.info(`Server listening on ${host}:${port}`);
  });

  // Graceful shutdown handling
  const SHUTDOWN_TIMEOUT_MS = parseInt(
    process.env.SHUTDOWN_TIMEOUT_MS || "10000",
    10,
  );

  let isShuttingDown = false;

  async function gracefulShutdown(signal: string): Promise<void> {
    if (isShuttingDown) {
      logger.warn("Shutdown already in progress, ignoring signal", { signal });
      return;
    }
    isShuttingDown = true;
    app.locals.isShuttingDown = true;

    logger.info("Graceful shutdown initiated", { signal });

    // Stop accepting new connections
    server.close(() => {
      logger.info("HTTP server closed, no more connections accepted");
    });

    // Wait for existing connections to drain
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        logger.warn("Shutdown timeout reached, forcing close", {
          timeoutMs: SHUTDOWN_TIMEOUT_MS,
        });
        resolve();
      }, SHUTDOWN_TIMEOUT_MS);

      // Check for connection drain
      const checkConnections = setInterval(() => {
        server.getConnections((err, count) => {
          if (err) {
            logger.error("Error getting connection count", { err });
            return;
          }
          if (count === 0) {
            clearInterval(checkConnections);
            clearTimeout(timeout);
            logger.info("All connections drained");
            resolve();
          } else {
            logger.debug("Waiting for connections to drain", { count });
          }
        });
      }, 500);
    });

    // Close database pool
    try {
      await pool.end();
      logger.info("Database pool closed");
    } catch (err) {
      logger.error("Error closing database pool", { err });
    }

    logger.info("Graceful shutdown complete");
    process.exit(0);
  }

  // Register signal handlers
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}
