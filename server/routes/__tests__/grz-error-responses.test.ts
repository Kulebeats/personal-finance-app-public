import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { calculateTBillYield } from "../../services/grz-service";
import { apiErrorMiddleware } from "../../utils/errorHandler";
import auctions from "../grz-auctions";
import calculators from "../grz-calculators";

const { select } = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("../../db", () => ({ db: { select } }));
vi.mock("../../auth", () => ({
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../../middleware/householdGuard", () => ({
  householdGuard: (req: Request, _res: Response, next: NextFunction) => {
    req.householdContext = { householdId: "fixture-household", userId: "fixture-user", role: "admin" };
    next();
  },
}));
vi.mock("../../services/BusinessAuditService", () => ({ businessAuditService: {} }));
vi.mock("../../services/grz-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/grz-service")>()),
  calculateTBillYield: vi.fn(),
}));

const app = express()
  .use(express.json())
  .use("/api/investments/grz/calculate", calculators)
  .use("/api/investments/grz", auctions)
  .use(apiErrorMiddleware);
const resultsPath = "/api/investments/grz/auctions/results";
const yieldPath = "/api/investments/grz/calculate/tbill-yield";
const validTBill = { faceValue: 1000, discountRate: 0.12, tenorDays: 91 };
const internalError = {
  success: false,
  error: { code: "INTERNAL_ERROR", message: "An internal error occurred. Please try again." },
};

describe("GRZ route error responses", () => {
  it("returns the generic 500 body when reading auction results fails", async () => {
    select.mockReturnValueOnce({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockRejectedValueOnce(new Error("synthetic internal GRZ fixture")),
    });

    const response = await request(app).get(resultsPath).expect(500);
    expect(response.body).toEqual(internalError);
  });

  it("returns the generic 500 body when the T-bill calculation fails", async () => {
    vi.mocked(calculateTBillYield).mockImplementationOnce(() => {
      throw new Error("synthetic internal GRZ fixture");
    });

    const response = await request(app).post(yieldPath).send(validTBill).expect(500);
    expect(response.body).toEqual(internalError);
  });

  it("preserves the auction query and calculator body validation responses", async () => {
    const auctionsResponse = await request(app).get(resultsPath).query({ limit: 0 }).expect(400);
    expect(auctionsResponse.body).toEqual({
      success: false,
      error: [expect.objectContaining({ path: ["limit"] })],
    });

    const calculatorResponse = await request(app).post(yieldPath)
      .send({ ...validTBill, faceValue: 0 }).expect(400);
    expect(calculatorResponse.body).toEqual({
      success: false,
      error: [expect.objectContaining({ path: ["faceValue"] })],
    });
  });
});
