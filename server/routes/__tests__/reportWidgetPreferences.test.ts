/**
 * Tests for /api/settings/report-widgets endpoints
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";
import { userRepository } from "../../repositories/UserRepository";
import { HttpError } from "../../core/errors/HttpError";

// Mock userRepository - use correct method names that match the route
vi.mock("../../repositories/UserRepository", () => ({
  userRepository: {
    getDisplaySettings: vi.fn(),
    createDisplaySettings: vi.fn(),
    updateDisplaySettings: vi.fn(),
  },
}));

const mockUserRepository = userRepository as any;

// Create test app with session middleware
async function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: false,
    })
  );

  // Mock auth middleware
  app.use((req, _res, next) => {
    (req.session as any).userId = "test-user-id";
    (req.session as any).householdId = "test-household-id";
    next();
  });

  // Import routes after mocking using dynamic import
  const settingsModule = await import("../settings.report-widgets");
  app.use("/api/settings", settingsModule.default);

  // Error handler for async route errors
  app.use((err: any, _req: any, res: any, _next: any) => {
    if (err instanceof HttpError) {
      return res.status(err.statusCode).json(err.toJSON());
    }
    return res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: err?.message ?? "Error" },
    });
  });

  return app;
}

describe("Report Widget Preferences API", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await createTestApp();
  });

  describe("GET /api/settings/report-widgets", () => {
    it("returns default preferences when none exist", async () => {
      mockUserRepository.getDisplaySettings.mockResolvedValue(null);

      const res = await request(app)
        .get("/api/settings/report-widgets")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.preferences).toBeDefined();
      expect(res.body.data.preferences.coreWidgets).toBeDefined();
      expect(res.body.data.preferences.optionalWidgets).toBeDefined();
    });

    it("returns stored preferences when they exist", async () => {
      const stored = {
        reportWidgetPreferences: {
          coreWidgets: { foo: { enabled: true, order: 0, chartType: "bar" } },
          optionalWidgets: {},
          customCharts: [],
        },
      };
      mockUserRepository.getDisplaySettings.mockResolvedValue(stored);

      const res = await request(app)
        .get("/api/settings/report-widgets")
        .expect(200);

      expect(res.body.data.preferences.coreWidgets.foo).toBeDefined();
    });
  });

  describe("PATCH /api/settings/report-widgets", () => {
    it("updates optional widget preferences", async () => {
      mockUserRepository.getDisplaySettings.mockResolvedValue({});
      mockUserRepository.updateDisplaySettings.mockResolvedValue({});

      const body = {
        optionalWidgets: {
          monthlyTrends: { enabled: false, order: 0, chartType: "line" },
        },
      };

      const res = await request(app)
        .patch("/api/settings/report-widgets")
        .send(body)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockUserRepository.updateDisplaySettings).toHaveBeenCalled();
    });

    it("validates chartType is required", async () => {
      const body = {
        optionalWidgets: {
          monthlyTrends: { enabled: false, order: 0 }, // Missing chartType
        },
      };

      const res = await request(app)
        .patch("/api/settings/report-widgets")
        .send(body)
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("validates order is non-negative", async () => {
      const body = {
        optionalWidgets: {
          monthlyTrends: { enabled: true, order: -1, chartType: "bar" },
        },
      };

      const res = await request(app)
        .patch("/api/settings/report-widgets")
        .send(body)
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("persists custom charts array", async () => {
      mockUserRepository.getDisplaySettings.mockResolvedValue({});
      mockUserRepository.updateDisplaySettings.mockResolvedValue({});

      const body = {
        customCharts: [
          {
            id: "chart-1",
            name: "My Custom Chart",
            chartType: "bar",
            primaryMetric: "income",
            order: 0,
            enabled: true,
          },
        ],
      };

      const res = await request(app)
        .patch("/api/settings/report-widgets")
        .send(body)
        .expect(200);

      expect(res.body.success).toBe(true);
      const updateCall = mockUserRepository.updateDisplaySettings.mock.calls[0];
      expect(updateCall[1].reportWidgetPreferences.customCharts).toHaveLength(
        1
      );
    });

    it("rejects invalid custom chart missing required fields", async () => {
      const body = {
        customCharts: [
          {
            // Missing id, name, chartType, primaryMetric
            order: 0,
            enabled: true,
          },
        ],
      };

      const res = await request(app)
        .patch("/api/settings/report-widgets")
        .send(body)
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it("handles database error gracefully", async () => {
      mockUserRepository.getDisplaySettings.mockRejectedValue(
        new Error("Database connection failed")
      );

      const body = {
        optionalWidgets: {
          monthlyTrends: { enabled: true, order: 0, chartType: "bar" },
        },
      };

      const res = await request(app)
        .patch("/api/settings/report-widgets")
        .send(body)
        .expect(500);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("INTERNAL_ERROR");
    });

    it("merges new preferences with existing ones", async () => {
      mockUserRepository.getDisplaySettings.mockResolvedValue({
        reportWidgetPreferences: {
          coreWidgets: {
            summaryCards: { enabled: true, order: 0, chartType: "cards" },
          },
          optionalWidgets: {
            existing: { enabled: true, order: 0, chartType: "bar" },
          },
          customCharts: [],
        },
      });
      mockUserRepository.updateDisplaySettings.mockResolvedValue({});

      const body = {
        optionalWidgets: {
          newWidget: { enabled: true, order: 1, chartType: "line" },
        },
      };

      const res = await request(app)
        .patch("/api/settings/report-widgets")
        .send(body)
        .expect(200);

      expect(res.body.success).toBe(true);
      const updateCall = mockUserRepository.updateDisplaySettings.mock.calls[0];
      const prefs = updateCall[1].reportWidgetPreferences;
      expect(prefs.optionalWidgets.existing).toBeDefined();
      expect(prefs.optionalWidgets.newWidget).toBeDefined();
    });
  });
});
