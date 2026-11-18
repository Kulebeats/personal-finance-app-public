/**
 * Health Controller
 *
 * Provides liveness and readiness probes for infrastructure monitoring.
 *
 * @module modules/health/health.controller
 */

import { Request, Response } from "express";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { cacheStore } from "../../core/cache/store";
import { logger } from "../../utils/logger";

interface HealthCheck {
  status: "healthy" | "unhealthy";
  latency?: number;
  error?: string;
}

interface HealthResponse {
  status: "healthy" | "unhealthy";
  checks: Record<string, HealthCheck>;
  version: string;
  uptime: number;
}

/**
 * Liveness probe
 * GET /health/live
 *
 * Checks if the application process is running.
 */
export async function getLive(_req: Request, res: Response) {
  res.status(200).json({
    status: "healthy",
    uptime: process.uptime(),
  });
}

/**
 * Readiness probe
 * GET /health/ready
 *
 * Checks if the application dependencies (DB, Cache) are ready.
 */
export async function getReady(_req: Request, res: Response) {
  const checks: Record<string, HealthCheck> = {};
  let overallHealthy = true;

  if (_req.app.locals.isShuttingDown) {
    const response: HealthResponse = {
      status: "unhealthy",
      checks: {
        shutdown: {
          status: "unhealthy",
          error: "shutting_down",
        },
      },
      version: process.env.npm_package_version || "unknown",
      uptime: process.uptime(),
    };

    res.status(503).json(response);
    return;
  }

  // Check database
  const dbStart = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    checks.database = { status: "healthy", latency: Date.now() - dbStart };
  } catch (error) {
    checks.database = { status: "unhealthy", error: (error as Error).message };
    overallHealthy = false;
  }

  // Check cache
  const cacheStart = Date.now();
  try {
    // Verify cache is operational via stats lookup or ping
    // Using simple stats check to avoid writing to cache during heavy load if acceptable
    const stats = cacheStore.getStats();
    checks.cache = {
      status: "healthy",
      latency: Date.now() - cacheStart, // Mostly instant for in-memory
    };
  } catch (error) {
    checks.cache = { status: "unhealthy", error: (error as Error).message };
    // Cache failure is not critical - degrade gracefully
    logger.warn("Cache health check failed", {
      error: (error as Error).message,
    });
  }

  const response: HealthResponse = {
    status: overallHealthy ? "healthy" : "unhealthy",
    checks,
    version: process.env.npm_package_version || "unknown",
    uptime: process.uptime(),
  };

  res.status(overallHealthy ? 200 : 503).json(response);
}

/**
 * Startup probe
 * GET /health/startup
 *
 * Checks if startup tasks are complete.
 */
export async function getStartup(req: Request, res: Response) {
  // Reuse readiness check for now
  return getReady(req, res);
}

export const healthController = {
  getLive,
  getReady,
  getStartup,
};
