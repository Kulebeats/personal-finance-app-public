import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response } from "express";

vi.mock("../../services/ImportService", () => ({
  importService: {
    parseCsv: vi.fn(),
    executeImport: vi.fn(),
  },
}));

const limiters = vi.hoisted(() => {
  const passThrough = () => Object.assign((_req: unknown, _res: unknown, next: () => unknown) => next(), {});
  return { uploadLimiter: passThrough(), analyticsLimiter: passThrough() };
});
vi.mock("../../middleware/rateLimit", () => limiters);
// These unit tests call the route handlers with plain request objects; the body is already an object.
vi.mock("../../middleware/importBody", () => ({ importJson: (_req: unknown, _res: unknown, next: () => unknown) => next() }));

// Execute needs a visible target account (IMP-01 review r4): every request below names one.
const TARGET = "11111111-1111-4111-8111-111111111113";
vi.mock("../../repositories/AccountRepository", () => ({
  accountRepository: {
    findByIdWithVisibility: vi.fn(async (id: string) => ({ id, currency: "USD" })),
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

  it("refuses execute without a target account before any service call (review r4 P1)", async () => {
    // Household and write access are checked first (R02), so a writer reaches the target check.
    vi.mocked(householdRepository.findByUserId).mockResolvedValueOnce({ id: "house-1" } as Awaited<ReturnType<typeof householdRepository.findByUserId>>);
    vi.mocked(householdRepository.findMember).mockResolvedValueOnce({ role: "member" } as Awaited<ReturnType<typeof householdRepository.findMember>>);
    const res = await runRoute("post", "/execute", { session: { userId: "user-1" } as Request["session"],
      body: { rows: [{ Date: "2026-02-01", Amount: "1", Currency: "ZMW" }],
        mapping: { date: "Date", amount: "Amount", currency: "Currency" }, strategy: "prioritize_coppercoin" } });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR", message: "Target account is required" });
    expect(importService.executeImport).not.toHaveBeenCalled();
  });

  it("spends the hourly upload budget only on parse and execute; preview is limited per minute", () => {
    const handlersFor = (path: string) => router.stack.find((entry: any) => entry.route?.path === path)!.route!.stack
      .map((entry: any) => entry.handle);
    expect(handlersFor("/parse")).toContain(limiters.uploadLimiter);
    expect(handlersFor("/execute")).toContain(limiters.uploadLimiter);
    expect(handlersFor("/preview")).toContain(limiters.analyticsLimiter);
    expect(handlersFor("/preview")).not.toContain(limiters.uploadLimiter);
    expect(router.stack.some((entry: any) => !entry.route && entry.handle === limiters.uploadLimiter)).toBe(false);
  });

  it("does not expose unexpected import errors", async () => {
    vi.mocked(householdRepository.findByUserId).mockResolvedValueOnce({ id: "house-1" } as Awaited<ReturnType<typeof householdRepository.findByUserId>>);
    vi.mocked(householdRepository.findMember).mockResolvedValueOnce({ role: "member" } as Awaited<ReturnType<typeof householdRepository.findMember>>);
    vi.mocked(importService.executeImport).mockRejectedValueOnce(new Error("private SQL connection detail"));
    const res = await runRoute("post", "/execute", { session: { userId: "user-1" } as Request["session"],
      body: { targetAccountId: TARGET, rows: [{ Date: "2026-02-01", Amount: "1" }], mapping: { date: "Date", amount: "Amount" }, strategy: "prioritize_csv" } });
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("private SQL");
  });

  it.each([
    ["owner", 200], ["admin", 200], ["member", 200],
    ["view_only", 403], ["professional", 403], ["unknown", 403],
  ])("requires financial.write for %s import execution (UNIT handler)", async (role, status) => {
    vi.mocked(householdRepository.findByUserId).mockResolvedValueOnce({ id: "house-1" } as Awaited<ReturnType<typeof householdRepository.findByUserId>>);
    vi.mocked(householdRepository.findMember).mockResolvedValueOnce({ role } as Awaited<ReturnType<typeof householdRepository.findMember>>);
    vi.mocked(importService.executeImport).mockResolvedValueOnce({ importId: "import-1", replayed: false, imported: 1, duplicate: 0, skipped: 0, failed: 0, deleted: 0, errors: [] });
    const res = await runRoute("post", "/execute", {
      session: { userId: "user-1" } as Request["session"],
      body: { targetAccountId: TARGET, rows: [{ Date: "2026-02-01", Amount: "1" }],
        mapping: { date: "Date", amount: "Amount" }, strategy: "prioritize_coppercoin" },
    });
    expect(res.statusCode).toBe(status);
    expect(importService.executeImport).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
    if (status === 403) expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects unsupported date format before calling the import service", async () => {
    const res = await runRoute("post", "/execute", { body: {
      targetAccountId: TARGET,
      rows: [{ Date: "01/02/2026", Amount: "1" }],
      mapping: { date: "Date", amount: "Amount" },
      strategy: "prioritize_coppercoin", dateFormat: "locale-default",
    } });
    expect(res.statusCode).toBe(400);
    expect(res.body.error.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ["dateFormat"] }),
    ]));
    expect(importService.executeImport).not.toHaveBeenCalled();
  });

  it.each(["auto", "DD/MM/YYYY", "MM/DD/YYYY"])("forwards %s unchanged (UNIT route handler)", async dateFormat => {
    vi.mocked(householdRepository.findByUserId).mockResolvedValueOnce({ id: "house-1" } as any);
    vi.mocked(householdRepository.findMember).mockResolvedValueOnce({ role: "member" } as any);
    vi.mocked(importService.executeImport).mockResolvedValueOnce({ importId: "import-1", replayed: false, imported: 1, duplicate: 0, skipped: 0, failed: 0, deleted: 0, errors: [] });
    const res = await runRoute("post", "/execute", {
      session: { userId: "user-1" } as any,
      body: { targetAccountId: TARGET, rows: [{ Date: "2026-02-01", Amount: "1" }],
        mapping: { date: "Date", amount: "Amount" }, strategy: "prioritize_coppercoin", dateFormat },
    });
    expect(res.statusCode).toBe(200);
    expect(importService.executeImport).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ dateFormat }));
  });

  it("returns 404 when household is missing", async () => {
    (householdRepository.findByUserId as any).mockResolvedValueOnce(undefined);

    const res = await runRoute("post", "/execute", {
      session: { userId: "user-1" } as any,
      body: {
        targetAccountId: TARGET,
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
        targetAccountId: TARGET,
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
        targetAccountId: TARGET,
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
        targetAccountId: TARGET,
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
