/**
 * A report 500 never carries raw error text in its body, on any NODE_ENV.
 *
 * handleReportError once added `debug: error.message` whenever NODE_ENV was not
 * "production", so a DrizzleQueryError's "Failed query … params …" text reached
 * the client on staging or any other non-production deploy. The real reports
 * router and the real apiErrorMiddleware are mounted as app.ts mounts them;
 * only the service, the preference read and the auth/limiter middleware are
 * stubbed.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiErrorMiddleware } from "../../../utils/errorHandler";

const { getAnnual } = vi.hoisted(() => ({ getAnnual: vi.fn() }));
vi.mock("../reports.service", () => ({ reportsService: { getAnnual } }));
vi.mock("../../../services/BusinessAuditService", () => ({ businessAuditService: {} }));
vi.mock("../../../middleware/householdGuard", () => ({
  householdGuard: (req: Request, _res: Response, next: NextFunction) => {
    req.householdContext = { householdId: "fixture-household", userId: "fixture-user", role: "admin" };
    next();
  },
}));
vi.mock("../../../middleware/rateLimit", () => ({
  analyticsLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  expensiveAnalyticsLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../../../repositories/HouseholdRepository", () => ({
  householdRepository: { findPreferences: vi.fn().mockResolvedValue({ showPendingTransactions: true }) },
}));

const { default: reportsRouter } = await import("../reports.routes");
const app = express().use("/api/reports", reportsRouter).use(apiErrorMiddleware);
const queryError = new Error(
  'Failed query: select "SQL_SENTINEL" from "households" where "id" = $1\nparams: PARAM_SENTINEL',
);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("report 500 body", () => {
  it.each([
    ["development", "development"],
    ["unset", undefined],
  ])("carries no raw error text with NODE_ENV %s", async (_label, nodeEnv) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    getAnnual.mockRejectedValueOnce(queryError);

    const response = await request(app).get("/api/reports/annual").query({ year: 2026 }).expect(500);

    expect(response.body).toEqual({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Unexpected error" },
    });
    expect(response.text).not.toMatch(/SQL_SENTINEL|PARAM_SENTINEL|Failed query/);
    // The detail stays server-side, through the existing logger.
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({
      level: "error", message: "GET /reports/annual error", error: { name: "Error" },
    });
  });
});
