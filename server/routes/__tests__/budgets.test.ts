import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response } from "express";

vi.mock("../../middleware/householdGuard", () => ({
  householdGuard: (req: Request, _res: Response, next: () => void) => {
    req.householdContext = {
      householdId: "house-1",
      userId: "user-1",
      role: "member",
    };
    next();
  },
}));

vi.mock("../../middleware/validateEntity", () => ({
  requireRole: () => (_req: Request, _res: Response, next: () => void) => next(),
}));

vi.mock("../../services/BudgetService", () => ({
  budgetService: {
    ensureFlexBudget: vi.fn(),
    getBudgets: vi.fn(),
    getBudgetProgress: vi.fn(),
    getBudgetAlerts: vi.fn(),
    recalculateBudgets: vi.fn(),
    clearBudgets: vi.fn(),
    getBudgetForecast: vi.fn(),
    updateBudgetForecast: vi.fn(),
    moveBudgetAmount: vi.fn(),
    getBudgetById: vi.fn(),
    createBudget: vi.fn(),
    updateBudget: vi.fn(),
    deleteBudget: vi.fn(),
  },
}));

vi.mock("../../repositories/HouseholdRepository", () => ({
  householdRepository: {
    findPreferences: vi.fn(),
    createPreferences: vi.fn(),
    updatePreferences: vi.fn(),
  },
}));

vi.mock("../../services/budget/BudgetSettingsService", async (original) => ({
  ...await original<typeof import("../../services/budget/BudgetSettingsService")>(),
  updateBudgetSettings: vi.fn(async () => ({ budgetSystem: "flex", defaultApplyScope: "all_future" })),
}));

import router from "../../modules/budgets/budgets.routes";
import { updateBudgetSettings } from "../../services/budget/BudgetSettingsService";
import { budgetService } from "../../services/BudgetService";
import { householdRepository } from "../../repositories/HouseholdRepository";

function createMockResponse() {
  let resolveJson: (payload: unknown) => void;
  const jsonPromise = new Promise((resolve) => {
    resolveJson = resolve;
  });

  const res = {
    statusCode: 200,
    body: undefined as any,
    status: vi.fn(function status(this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function json(this: any, payload: unknown) {
      this.body = payload;
      resolveJson(payload);
      return this;
    }),
    waitForJson: () => jsonPromise,
  };

  return res;
}

async function runRoute(
  method: "get" | "put",
  path: string,
  reqOverrides: Partial<Request>
) {
  const layer = router.stack.find(
    (entry: any) => entry.route?.path === path && entry.route.methods[method]
  );

  if (!layer || !layer.route) {
    throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  }

  const handlers = layer.route.stack.map((entry: any) => entry.handle);
  const req = {
    method: method.toUpperCase(),
    path,
    ...reqOverrides,
  } as Request;
  const res = createMockResponse();

  let index = 0;
  const next = async (err?: unknown) => {
    if (err) throw err;
    const handler = handlers[index++];
    if (!handler) return;
    return handler(req, res, next);
  };

  await next();
  await res.waitForJson();
  return res;
}

describe("budget settings routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns default apply scope from stored preferences", async () => {
    (householdRepository.findPreferences as any).mockResolvedValueOnce(null);
    (householdRepository.createPreferences as any).mockResolvedValueOnce({
      budgetSystem: "category",
      defaultBudgetScope: "all_future",
    });

    const res = await runRoute("get", "/settings", {
      householdContext: {
        householdId: "house-1",
        userId: "user-1",
        role: "member",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({
      budgetSystem: "category",
      defaultApplyScope: "all_future",
    });
  });

  // The write, the flex budget and their audit rows are proven against real
  // Postgres in completion-r07.audit-completeness.realdb; this checks the wiring.
  it("passes the validated settings and the actor to the settings service", async () => {

    const res = await runRoute("put", "/settings", {
      householdContext: {
        householdId: "house-1",
        userId: "user-1",
        role: "member",
      },
      body: { budgetSystem: "flex", defaultApplyScope: "all_future" },
      socket: { remoteAddress: "127.0.0.1" } as Request["socket"],
    });

    expect(updateBudgetSettings).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: "house-1", userId: "user-1" }),
      { budgetSystem: "flex", defaultApplyScope: "all_future" },
    );
    expect(res.body.data).toEqual({
      budgetSystem: "flex",
      defaultApplyScope: "all_future",
    });
  });
});
