/**
 * Health Endpoints Integration Tests
 *
 * Tests for /health/live, /health/ready, /health/startup endpoints
 */

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { Express } from "express";
import healthRoutes from "../health.routes";
import { db } from "../../../db";
import { cacheStore } from "../../../core/cache/store";

// Create test app
function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/health", healthRoutes);
  return app;
}

describe("Health Endpoints Integration Tests", () => {
  let app: Express;

  beforeAll(() => {
    app = createTestApp();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe("GET /health/live", () => {
    it("should return healthy status with uptime", async () => {
      const response = await request(app).get("/health/live");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status", "healthy");
      expect(response.body).toHaveProperty("uptime");
      expect(typeof response.body.uptime).toBe("number");
      expect(response.body.uptime).toBeGreaterThan(0);
    });

    it("should always succeed even if dependencies are down", async () => {
      // Liveness probe should succeed regardless of dependencies
      const response = await request(app).get("/health/live");

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("healthy");
    });
  });

  describe("GET /health/ready", () => {
    it("should return healthy status when all dependencies are up", async () => {
      const response = await request(app).get("/health/ready");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status", "healthy");
      expect(response.body).toHaveProperty("checks");
      expect(response.body).toHaveProperty("version");
      expect(response.body).toHaveProperty("uptime");

      // Check database health
      expect(response.body.checks).toHaveProperty("database");
      expect(response.body.checks.database.status).toBe("healthy");
      expect(response.body.checks.database).toHaveProperty("latency");
      expect(typeof response.body.checks.database.latency).toBe("number");

      // Check cache health
      expect(response.body.checks).toHaveProperty("cache");
      expect(response.body.checks.cache.status).toBe("healthy");
    });

    it("should return unhealthy status when database is down", async () => {
      // Mock database failure
      const originalExecute = db.execute.bind(db);
      vi.spyOn(db, "execute").mockRejectedValueOnce(
        new Error("Connection refused")
      );

      const response = await request(app).get("/health/ready");

      expect(response.status).toBe(503);
      expect(response.body.status).toBe("unhealthy");
      expect(response.body.checks.database.status).toBe("unhealthy");
      expect(response.body.checks.database.error).toBe("Connection refused");

      // Restore original
      db.execute = originalExecute;
    });

    it("should handle cache failure gracefully", async () => {
      // Mock cache failure
      const originalGetStats = cacheStore.getStats.bind(cacheStore);
      vi.spyOn(cacheStore, "getStats").mockImplementationOnce(() => {
        throw new Error("Cache unavailable");
      });

      const response = await request(app).get("/health/ready");

      // Cache failure should not make the overall health check fail
      // (it's not critical, we degrade gracefully)
      expect(response.status).toBe(200);
      expect(response.body.checks.cache.status).toBe("unhealthy");
      expect(response.body.checks.cache.error).toBe("Cache unavailable");

      // Restore original
      cacheStore.getStats = originalGetStats;
    });

    it("should include version information", async () => {
      const response = await request(app).get("/health/ready");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("version");
      expect(typeof response.body.version).toBe("string");
    });

    it("should include uptime in readiness check", async () => {
      const response = await request(app).get("/health/ready");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("uptime");
      expect(typeof response.body.uptime).toBe("number");
      expect(response.body.uptime).toBeGreaterThan(0);
    });

    it("should return unhealthy while the app is draining for shutdown", async () => {
      app.locals.isShuttingDown = true;

      const response = await request(app).get("/health/ready");

      expect(response.status).toBe(503);
      expect(response.body.status).toBe("unhealthy");
      expect(response.body.checks.shutdown.status).toBe("unhealthy");
      expect(response.body.checks.shutdown.error).toBe("shutting_down");

      app.locals.isShuttingDown = false;
    });

    it("should report latency for database check", async () => {
      const response = await request(app).get("/health/ready");

      expect(response.status).toBe(200);
      expect(response.body.checks.database).toHaveProperty("latency");
      expect(typeof response.body.checks.database.latency).toBe("number");
      expect(response.body.checks.database.latency).toBeGreaterThanOrEqual(0);
    });

    it("should report latency for cache check", async () => {
      const response = await request(app).get("/health/ready");

      expect(response.status).toBe(200);
      expect(response.body.checks.cache).toHaveProperty("latency");
      expect(typeof response.body.checks.cache.latency).toBe("number");
      expect(response.body.checks.cache.latency).toBeGreaterThanOrEqual(0);
    });
  });

  describe("GET /health/startup", () => {
    it("should return healthy status on successful startup", async () => {
      const response = await request(app).get("/health/startup");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status", "healthy");
      expect(response.body).toHaveProperty("checks");
      expect(response.body).toHaveProperty("version");
      expect(response.body).toHaveProperty("uptime");
    });

    it("should return unhealthy status if dependencies are not ready", async () => {
      // Mock database failure
      const originalExecute = db.execute.bind(db);
      vi.spyOn(db, "execute").mockRejectedValueOnce(
        new Error("Database not ready")
      );

      const response = await request(app).get("/health/startup");

      expect(response.status).toBe(503);
      expect(response.body.status).toBe("unhealthy");
      expect(response.body.checks.database.status).toBe("unhealthy");

      // Restore original
      db.execute = originalExecute;
    });

    it("should include all required health check information", async () => {
      const response = await request(app).get("/health/startup");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("status");
      expect(response.body).toHaveProperty("checks");
      expect(response.body.checks).toHaveProperty("database");
      expect(response.body.checks).toHaveProperty("cache");
      expect(response.body).toHaveProperty("version");
      expect(response.body).toHaveProperty("uptime");
    });
  });

  describe("Health Check Response Structure", () => {
    it("should have consistent response structure across all endpoints", async () => {
      const liveResponse = await request(app).get("/health/live");
      const readyResponse = await request(app).get("/health/ready");
      const startupResponse = await request(app).get("/health/startup");

      // All should have status
      expect(liveResponse.body).toHaveProperty("status");
      expect(readyResponse.body).toHaveProperty("status");
      expect(startupResponse.body).toHaveProperty("status");

      // Ready and startup should have detailed checks
      expect(readyResponse.body).toHaveProperty("checks");
      expect(startupResponse.body).toHaveProperty("checks");

      // Ready and startup should have version and uptime
      expect(readyResponse.body).toHaveProperty("version");
      expect(readyResponse.body).toHaveProperty("uptime");
      expect(startupResponse.body).toHaveProperty("version");
      expect(startupResponse.body).toHaveProperty("uptime");
    });
  });

  describe("Error Scenarios", () => {
    it("should handle multiple dependency failures", async () => {
      // Mock both database and cache failures
      const originalExecute = db.execute.bind(db);
      const originalGetStats = cacheStore.getStats.bind(cacheStore);

      vi.spyOn(db, "execute").mockRejectedValueOnce(
        new Error("Database error")
      );
      vi.spyOn(cacheStore, "getStats").mockImplementationOnce(() => {
        throw new Error("Cache error");
      });

      const response = await request(app).get("/health/ready");

      expect(response.status).toBe(503);
      expect(response.body.status).toBe("unhealthy");
      expect(response.body.checks.database.status).toBe("unhealthy");
      expect(response.body.checks.cache.status).toBe("unhealthy");

      // Restore originals
      db.execute = originalExecute;
      cacheStore.getStats = originalGetStats;
    });

    it("should handle unexpected errors in health checks", async () => {
      // Mock database to throw non-Error object
      const originalExecute = db.execute.bind(db);
      vi.spyOn(db, "execute").mockRejectedValueOnce("Unexpected error");

      const response = await request(app).get("/health/ready");

      expect(response.status).toBe(503);
      expect(response.body.checks.database.status).toBe("unhealthy");

      // Restore original
      db.execute = originalExecute;
    });
  });
});
