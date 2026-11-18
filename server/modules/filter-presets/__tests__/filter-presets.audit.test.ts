import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFilterPresetsService = vi.hoisted(() => ({
  createPreset: vi.fn(),
  updatePreset: vi.fn(),
  deletePreset: vi.fn(),
  getPresetById: vi.fn(),
}));

const mockBusinessAuditService = vi.hoisted(() => ({
  logCreate: vi.fn().mockResolvedValue(undefined),
  logUpdate: vi.fn().mockResolvedValue(undefined),
  logDelete: vi.fn().mockResolvedValue(undefined),
  getIpAddress: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("../filter-presets.service", () => ({
  filterPresetsService: mockFilterPresetsService,
}));

vi.mock("../../../services/BusinessAuditService", () => ({
  businessAuditService: mockBusinessAuditService,
}));

import { filterPresetsController } from "../filter-presets.controller";

const householdId = randomUUID();
const userId = randomUUID();

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.householdContext = {
      householdId,
      userId,
      role: "member",
    };
    next();
  });
  app.post("/api/filter-presets", filterPresetsController.create);
  app.patch("/api/filter-presets/:id", filterPresetsController.update);
  app.delete("/api/filter-presets/:id", filterPresetsController.delete);
  app.use(
    (
      error: Error,
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) => {
      res.status(500).json({ message: error.message });
    },
  );
  return app;
}

function buildPreset(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    householdId,
    userId,
    name: "Food Filters",
    context: "transactions",
    filters: {
      categoryIds: ["private-category"],
      search: "salary",
    },
    isDefault: false,
    isShared: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("filter preset mutation audit logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("audits create without storing raw filter criteria", async () => {
    const preset = buildPreset({ isDefault: true });
    mockFilterPresetsService.createPreset.mockResolvedValue(preset);

    const response = await request(buildApp())
      .post("/api/filter-presets")
      .send({
        name: "Food Filters",
        context: "transactions",
        filters: { categoryIds: ["private-category"], search: "salary" },
        isDefault: true,
      });

    expect(response.status).toBe(201);
    expect(mockBusinessAuditService.logCreate).toHaveBeenCalledWith({
      householdId,
      userId,
      entityType: "filter_preset",
      entityId: preset.id,
      newValue: {
        name: "Food Filters",
        context: "transactions",
        isDefault: true,
        isShared: false,
        filterKeyCount: 2,
      },
      ipAddress: "127.0.0.1",
    });
    expect(JSON.stringify(mockBusinessAuditService.logCreate.mock.calls[0][0]))
      .not.toContain("private-category");
    expect(JSON.stringify(mockBusinessAuditService.logCreate.mock.calls[0][0]))
      .not.toContain("salary");
  });

  it("audits update with sanitized before and after values", async () => {
    const presetId = randomUUID();
    const before = buildPreset({ id: presetId, name: "Old Name" });
    const after = buildPreset({
      id: presetId,
      name: "New Name",
      isShared: true,
      filters: { merchantIds: ["merchant-1"] },
    });
    mockFilterPresetsService.getPresetById.mockResolvedValue(before);
    mockFilterPresetsService.updatePreset.mockResolvedValue(after);

    const response = await request(buildApp())
      .patch(`/api/filter-presets/${presetId}`)
      .send({
        name: "New Name",
        filters: { merchantIds: ["merchant-1"] },
        isShared: true,
      });

    expect(response.status).toBe(200);
    expect(mockBusinessAuditService.logUpdate).toHaveBeenCalledWith({
      householdId,
      userId,
      entityType: "filter_preset",
      entityId: presetId,
      oldValue: {
        name: "Old Name",
        context: "transactions",
        isDefault: false,
        isShared: false,
        filterKeyCount: 2,
      },
      newValue: {
        name: "New Name",
        context: "transactions",
        isDefault: false,
        isShared: true,
        filterKeyCount: 1,
      },
      ipAddress: "127.0.0.1",
    });
    expect(JSON.stringify(mockBusinessAuditService.logUpdate.mock.calls[0][0]))
      .not.toContain("merchant-1");
  });

  it("audits delete with sanitized old value", async () => {
    const presetId = randomUUID();
    const before = buildPreset({ id: presetId, name: "Delete Me" });
    mockFilterPresetsService.getPresetById.mockResolvedValue(before);
    mockFilterPresetsService.deletePreset.mockResolvedValue(undefined);

    const response = await request(buildApp()).delete(
      `/api/filter-presets/${presetId}`,
    );

    expect(response.status).toBe(204);
    expect(mockBusinessAuditService.logDelete).toHaveBeenCalledWith({
      householdId,
      userId,
      entityType: "filter_preset",
      entityId: presetId,
      oldValue: {
        name: "Delete Me",
        context: "transactions",
        isDefault: false,
        isShared: false,
        filterKeyCount: 2,
      },
      ipAddress: "127.0.0.1",
    });
    expect(JSON.stringify(mockBusinessAuditService.logDelete.mock.calls[0][0]))
      .not.toContain("private-category");
  });
});
