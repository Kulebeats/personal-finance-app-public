import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response } from "express";

vi.mock("../../services/ImportService", () => ({
  importService: {
    parseCsv: vi.fn(),
    executeImport: vi.fn(),
  },
}));

vi.mock("../../repositories/HouseholdRepository", () => ({
  householdRepository: {
    findByUserId: vi.fn(),
    findMember: vi.fn(),
  },
}));

import router from "../import";
import { importService } from "../../services/ImportService";
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
  method: "post",
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

describe("import routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when household is missing", async () => {
    (householdRepository.findByUserId as any).mockResolvedValueOnce(undefined);

    const res = await runRoute("post", "/execute", {
      session: { userId: "user-1" } as any,
      body: {
        rows: [{ id: "1" }],
        mapping: { date: "Date", amount: "Amount" },
        strategy: "prioritize_csv",
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.body.message).toBe("Household not found");
    expect(importService.executeImport).not.toHaveBeenCalled();
  });

  it("rejects household override when membership is missing", async () => {
    (householdRepository.findByUserId as any).mockResolvedValueOnce({
      id: "house-1",
    });
    (householdRepository.findMember as any).mockResolvedValueOnce(null);

    const res = await runRoute("post", "/execute", {
      session: { userId: "user-1" } as any,
      body: {
        householdId: "11111111-1111-4111-8111-111111111112",
        rows: [{ id: "1" }],
        mapping: { date: "Date", amount: "Amount" },
        strategy: "prioritize_csv",
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(importService.executeImport).not.toHaveBeenCalled();
  });

  it("uses the user's household when none is provided", async () => {
    (householdRepository.findByUserId as any).mockResolvedValueOnce({
      id: "house-1",
    });
    (householdRepository.findMember as any).mockResolvedValueOnce({
      id: "m1",
      role: "admin",
    });
    (importService.executeImport as any).mockResolvedValueOnce({
      importedCount: 1,
    });

    const res = await runRoute("post", "/execute", {
      session: { userId: "user-1" } as any,
      body: {
        rows: [{ id: "1" }],
        mapping: { date: "Date", amount: "Amount" },
        strategy: "prioritize_csv",
      },
    });

    expect(importService.executeImport).toHaveBeenCalledWith(
      [{ id: "1" }],
      expect.objectContaining({ householdId: "house-1", userId: "user-1" })
    );
    expect(res.statusCode).toBe(200);
  });

  it("allows household override with membership", async () => {
    (householdRepository.findByUserId as any).mockResolvedValueOnce({
      id: "house-1",
    });
    (householdRepository.findMember as any).mockResolvedValueOnce({
      id: "m1",
      role: "member",
    });
    (importService.executeImport as any).mockResolvedValueOnce({
      importedCount: 1,
    });

    const res = await runRoute("post", "/execute", {
      session: { userId: "user-1" } as any,
      body: {
        householdId: "11111111-1111-4111-8111-111111111112",
        rows: [{ id: "1" }],
        mapping: { date: "Date", amount: "Amount" },
        strategy: "prioritize_csv",
      },
    });

    expect(importService.executeImport).toHaveBeenCalledWith(
      [{ id: "1" }],
      expect.objectContaining({
        householdId: "11111111-1111-4111-8111-111111111112",
        userId: "user-1",
      })
    );
    expect(res.statusCode).toBe(200);
  });
});
