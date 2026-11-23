/**
 * Investments Module - Integration Tests
 *
 * Tests for validation schemas, HTTP API endpoints, and data integrity.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import { NotFoundError } from "../../../core/errors";
import { Money } from "../../../core/money";
import {
  createSecuritySchema,
  updateSecurityPriceSchema,
  createFxRateSchema,
  fxHistoricalQuerySchema,
  listFxRatesQuerySchema,
  createHoldingSchema,
  createInvestmentTransactionSchema,
} from "../investments.validation";

const openingDeclaration = { operationId: "77777777-7777-4777-8777-777777777777", expectedCurrency: "ZMW" };

describe("Investment Validation Schemas", () => {
  describe("createSecuritySchema", () => {
    it("validates valid security input", () => {
      const input = {
        symbol: "AAPL",
        name: "Apple Inc",
        type: "stock",
        currency: "USD",
      };

      const result = createSecuritySchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects invalid security type", () => {
      const input = {
        symbol: "AAPL",
        name: "Apple Inc",
        type: "invalid_type",
        currency: "USD",
      };

      const result = createSecuritySchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects invalid currency length", () => {
      const input = {
        symbol: "AAPL",
        name: "Apple Inc",
        type: "stock",
        currency: "USDX", // 4 chars instead of 3
      };

      const result = createSecuritySchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("accepts optional instrument metadata", () => {
      const input = {
        symbol: "TEST",
        name: "Test Security",
        type: "bond",
        currency: "ZMW",
        exchange: "luse",
        sector: "Financial",
        isOffshore: true,
      };

      const result = createSecuritySchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isOffshore).toBe(true);
        expect(result.data.sector).toBe("Financial");
      }
    });

    it.each([
      { label: "string", currentPrice: "100.50" },
      { label: "number", currentPrice: 100.5 },
      { label: "null", currentPrice: null },
    ])("rejects a $label current price during metadata creation", ({ currentPrice }) => {
      const result = createSecuritySchema.safeParse({
        symbol: "TEST",
        name: "Test Security",
        type: "stock",
        currentPrice,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(expect.arrayContaining([
          expect.objectContaining({ path: ["currentPrice"] }),
        ]));
      }
    });

    it("accepts all valid security types", () => {
      const types = [
        "stock", "bond", "etf", "mutual_fund", "unit_trust",
        "term_deposit", "tbill", "forex", "crypto", "other"
      ];

      for (const type of types) {
        const input = {
          symbol: "TEST",
          name: "Test Security",
          type,
          currency: "ZMW",
        };
        const result = createSecuritySchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });

    it("accepts all valid exchanges", () => {
      const exchanges = ["luse", "nyse", "nasdaq", "jse", "otc", "boz", "manual"];

      for (const exchange of exchanges) {
        const input = {
          symbol: "TEST",
          name: "Test Security",
          type: "stock",
          currency: "ZMW",
          exchange,
        };
        const result = createSecuritySchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });
  });

  describe("updateSecurityPriceSchema", () => {
    const window = { date: "2026-01-21", validThrough: "2026-01-31" };
    it.each(["0001-01-01", "2024-02-29", "9999-12-31"])("preserves the supplied effective date %s", date => {
      expect(updateSecurityPriceSchema.parse({ price: "150.00", date, validThrough: date })).toEqual({ price: "150.00", date, validThrough: date });
    });

    it.each([
      { price: "150.00", validThrough: "2026-01-31" },
      { price: "150.00", date: "2026-01-21" },
    ])("requires both explicit dates in %j", input => {
      expect(updateSecurityPriceSchema.safeParse(input).success).toBe(false);
    });

    it.each(["0000-01-01", "2026-04-31", "2026-01-20"])(
      "rejects an invalid or earlier end date %s",
      validThrough => {
        expect(updateSecurityPriceSchema.safeParse({ ...window, validThrough, price: "1.00" }).success).toBe(false);
      },
    );

    it.each(["01-21-2026", "0000-01-01", "2025-02-29", "2026-04-31", "2026-01-21\n"])(
      "rejects an invalid effective date %j",
      date => {
        const result = updateSecurityPriceSchema.safeParse({ price: "150.00", date, validThrough: "9999-12-31" });
        expect(result).toMatchObject({
          success: false,
          error: { issues: expect.arrayContaining([expect.objectContaining({ path: ["date"] })]) },
        });
      },
    );

    it.each(["99999999999.9999", "0.0001", "12.3400"])(
      "keeps the exact representable string price %s",
      price => {
        expect(updateSecurityPriceSchema.parse({ ...window, price }).price).toBe(price);
      },
    );

    it.each([
      { price: "1.23000", expected: "1.23" },
      { price: "1e-4", expected: "0.0001" },
      { price: "999999999999999e-4", expected: "99999999999.9999" },
    ])("converts $price to an exact storage decimal", ({ price, expected }) => {
      expect(updateSecurityPriceSchema.parse({ ...window, price }).price).toBe(expected);
    });

    it.each([
      { price: 150, expected: "150" },
      { price: 0.0001, expected: "0.0001" },
      { price: 99999999999.9999, expected: "99999999999.9999" },
    ])("converts the numeric price $price to its decimal string", ({ price, expected }) => {
      expect(updateSecurityPriceSchema.parse({ ...window, price }).price).toBe(expected);
    });

    it.each([
      "100000000000", "-100000000000", "99999999999.99995", "0.00001", "12.34567",
      "", " 1.25", "1.25\n", "1,25", "0x10", "1_000", "NaN", "Infinity", "-Infinity",
      "1e11", "1e-5", "1e-99999999999999999999", "1e+", 100000000000, 0.00001, 0.1 + 0.2,
    ])("rejects unsupported price %j", price => {
      const result = updateSecurityPriceSchema.safeParse({ ...window, price });
      expect(result).toMatchObject({ success: false, error: { issues: [{ path: ["price"] }] } });
    });

    it.each(["0", "0.0000", "-0", "-0.0001", "-1e-4", "-99999999999.9999", 0, -0, -12.3456])(
      "rejects the non-positive manual price %j", price => {
        const result = updateSecurityPriceSchema.safeParse({ ...window, price });
        expect(result).toMatchObject({ success: false, error: { issues: [{ path: ["price"],
          message: "Security price must be greater than zero" }] } });
      },
    );

    it.each([NaN, Infinity, -Infinity])("rejects nonfinite number %s", price => {
      const result = updateSecurityPriceSchema.safeParse({ ...window, price });
      expect(result).toMatchObject({ success: false, error: { issues: [{ path: ["price"] }] } });
    });
  });

  describe("createFxRateSchema", () => {
    const window = { date: "2026-01-21", validThrough: "2026-01-31" };

    it("validates valid FX rate input", () => {
      const input = {
        fromCurrency: "USD",
        toCurrency: "ZMW",
        rate: "27.50",
        ...window,
      };

      const result = createFxRateSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects invalid currency codes (too short)", () => {
      const input = {
        fromCurrency: "US", // Too short
        toCurrency: "ZMW",
        rate: "27.50",
        ...window,
      };

      const result = createFxRateSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects invalid currency codes (too long)", () => {
      const input = {
        fromCurrency: "USDD", // Too long
        toCurrency: "ZMW",
        rate: "27.50",
        ...window,
      };

      const result = createFxRateSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("refuses a caller-chosen source label (R12: a household rate is always manual)", () => {
      const result = createFxRateSchema.safeParse({
        fromCurrency: "EUR", toCurrency: "ZMW", rate: "29.50", ...window, source: "bank",
      });
      expect(result.success).toBe(false);
    });

    it("requires both validity dates, in order", () => {
      const base = { fromCurrency: "USD", toCurrency: "ZMW", rate: "27.50" };
      expect(createFxRateSchema.safeParse(base).success).toBe(false);
      expect(createFxRateSchema.safeParse({ ...base, date: "2026-01-21" }).success).toBe(false);
      expect(createFxRateSchema.safeParse({ ...base, date: "2026-01-21", validThrough: "2026-01-20" }).success).toBe(false);
    });

    it.each(["0", "0.00", "-1", "1.123456789", "abc", "100000000000"])("refuses the rate %s", rate => {
      expect(createFxRateSchema.safeParse({ fromCurrency: "USD", toCurrency: "ZMW", rate, ...window }).success).toBe(false);
    });

    it("refuses a pair of the same currency", () => {
      expect(createFxRateSchema.safeParse({ fromCurrency: "ZMW", toCurrency: "ZMW", rate: "1", ...window }).success).toBe(false);
    });
  });

  describe("listFxRatesQuerySchema", () => {
    it("accepts empty query", () => {
      const result = listFxRatesQuerySchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("validates from/to currency length", () => {
      const result = listFxRatesQuerySchema.safeParse({
        from: "USD",
        to: "ZMW",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid currency length", () => {
      const result = listFxRatesQuerySchema.safeParse({
        from: "US", // Too short
      });
      expect(result.success).toBe(false);
    });
  });

  describe("fxHistoricalQuerySchema", () => {
    it("applies defaults for from/to/limit", () => {
      const input = {};

      const result = fxHistoricalQuerySchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.from).toBe("USD");
        expect(result.data.to).toBe("ZMW");
        expect(result.data.limit).toBe(30);
      }
    });

    it("rejects limit over 365", () => {
      const input = {
        from: "USD",
        to: "ZMW",
        limit: 500,
      };

      const result = fxHistoricalQuerySchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("accepts valid limit", () => {
      const input = {
        from: "EUR",
        to: "GBP",
        limit: 365,
      };

      const result = fxHistoricalQuerySchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe("dateSchema validation (via createHoldingSchema)", () => {
    it("rejects invalid date like Feb 30", () => {
      const input = {
        accountId: "11111111-1111-1111-1111-111111111111",
        securityId: "22222222-2222-2222-2222-222222222222",
        quantity: "100",
        costBasis: "1000",
        acquiredDate: "2025-02-30", // Invalid date
      };

      const result = createHoldingSchema.safeParse({ ...openingDeclaration, ...input });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain("date does not exist");
      }
    });

    it("rejects invalid date like month 13", () => {
      const input = {
        accountId: "11111111-1111-1111-1111-111111111111",
        securityId: "22222222-2222-2222-2222-222222222222",
        quantity: "100",
        costBasis: "1000",
        acquiredDate: "2025-13-01", // Invalid month
      };

      const result = createHoldingSchema.safeParse({ ...openingDeclaration, ...input });
      expect(result.success).toBe(false);
    });

    it("accepts valid date", () => {
      const input = {
        accountId: "11111111-1111-1111-1111-111111111111",
        securityId: "22222222-2222-2222-2222-222222222222",
        quantity: "100",
        costBasis: "1000",
        acquiredDate: "2025-02-28",
      };

      const result = createHoldingSchema.safeParse({ ...openingDeclaration, ...input });
      expect(result.success).toBe(true);
    });

    it("accepts leap year date Feb 29", () => {
      const input = {
        accountId: "11111111-1111-1111-1111-111111111111",
        securityId: "22222222-2222-2222-2222-222222222222",
        quantity: "100",
        costBasis: "1000",
        acquiredDate: "2024-02-29", // 2024 is a leap year
      };

      const result = createHoldingSchema.safeParse({ ...openingDeclaration, ...input });
      expect(result.success).toBe(true);
    });

    it("rejects Feb 29 on non-leap year", () => {
      const input = {
        accountId: "11111111-1111-1111-1111-111111111111",
        securityId: "22222222-2222-2222-2222-222222222222",
        quantity: "100",
        costBasis: "1000",
        acquiredDate: "2025-02-29", // 2025 is NOT a leap year
      };

      const result = createHoldingSchema.safeParse({ ...openingDeclaration, ...input });
      expect(result.success).toBe(false);
    });
  });

  describe("createInvestmentTransactionSchema", () => {
    it("validates buy transaction", () => {
      const input = {
        accountId: "11111111-1111-1111-1111-111111111111",
        securityId: "44444444-4444-4444-4444-444444444444",
        holdingId: "55555555-5555-5555-5555-555555555555",
        type: "buy",
        quantity: "100",
        price: "50.00",
        amount: "5000.00",
        transactionDate: "2026-01-21",
      };

      const result = createInvestmentTransactionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("validates sell transaction", () => {
      const input = {
        accountId: "11111111-1111-1111-1111-111111111111",
        securityId: "44444444-4444-4444-4444-444444444444",
        holdingId: "22222222-2222-2222-2222-222222222222",
        type: "sell",
        quantity: "50",
        price: "55.00",
        amount: "2750.00",
        transactionDate: "2026-01-21",
      };

      const result = createInvestmentTransactionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("validates dividend transaction", () => {
      const input = {
        accountId: "11111111-1111-1111-1111-111111111111",
        securityId: "44444444-4444-4444-4444-444444444444",
        holdingId: "55555555-5555-5555-5555-555555555555",
        type: "dividend",
        amount: "150.00",
        transactionDate: "2026-01-21",
      };

      const result = createInvestmentTransactionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects invalid transaction type", () => {
      const input = {
        accountId: "11111111-1111-1111-1111-111111111111",
        type: "invalid_type",
        amount: "100.00",
        transactionDate: "2026-01-21",
      };

      const result = createInvestmentTransactionSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("leaves omitted currency unresolved until the writer reads the investment source", () => {
      const input = {
        accountId: "11111111-1111-1111-1111-111111111111",
        type: "fee", // H2 FIX: Use fee type which doesn't require holdingId/quantity/price
        amount: "5000.00",
        transactionDate: "2026-01-21",
      };

      const result = createInvestmentTransactionSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.currency).toBeUndefined();
      }
    });

    it("accepts all valid transaction types", () => {
      // H2 FIX: Each type has different required fields per new validation
      const typeInputs: Record<string, any> = {
        buy: {
          accountId: "11111111-1111-1111-1111-111111111111",
          securityId: "44444444-4444-4444-4444-444444444444",
          holdingId: "55555555-5555-5555-5555-555555555555",
          quantity: "10",
          price: "100.00",
        },
        sell: {
          accountId: "11111111-1111-1111-1111-111111111111",
          securityId: "44444444-4444-4444-4444-444444444444",
          holdingId: "55555555-5555-5555-5555-555555555555",
          quantity: "5",
          price: "110.00",
        },
        dividend: {
          accountId: "11111111-1111-1111-1111-111111111111",
          securityId: "44444444-4444-4444-4444-444444444444",
          holdingId: "55555555-5555-5555-5555-555555555555",
        },
        interest: {
          accountId: "11111111-1111-1111-1111-111111111111",
          securityId: "44444444-4444-4444-4444-444444444444",
          holdingId: "55555555-5555-5555-5555-555555555555",
        },
        fee: {
          accountId: "11111111-1111-1111-1111-111111111111",
        },
        split: {
          accountId: "11111111-1111-1111-1111-111111111111",
          holdingId: "55555555-5555-5555-5555-555555555555",
          quantity: "2", // 2-for-1 split
        },
        transfer_in: {
          accountId: "11111111-1111-1111-1111-111111111111",
          securityId: "44444444-4444-4444-4444-444444444444",
          quantity: "10",
        },
        transfer_out: {
          accountId: "11111111-1111-1111-1111-111111111111",
          securityId: "44444444-4444-4444-4444-444444444444",
          quantity: "10",
        },
        coupon: {
          accountId: "11111111-1111-1111-1111-111111111111",
          securityId: "44444444-4444-4444-4444-444444444444",
          holdingId: "55555555-5555-5555-5555-555555555555",
        },
        maturity: {
          accountId: "11111111-1111-1111-1111-111111111111",
          holdingId: "55555555-5555-5555-5555-555555555555",
        },
      };

      for (const [type, baseInput] of Object.entries(typeInputs)) {
        const input = {
          ...baseInput,
          type,
          amount: "100.00",
          transactionDate: "2026-01-21",
        };
        const result = createInvestmentTransactionSchema.safeParse(input);
        expect(result.success, `Expected ${type} to be valid`).toBe(true);
      }
    });
  });
});

// =============================================================================
// HTTP API Integration Tests
// =============================================================================

const TEST_HOUSEHOLD_ID = "11111111-1111-1111-1111-111111111111";
const TEST_USER_ID = "22222222-2222-2222-2222-222222222222";
const TEST_ACCOUNT_ID = "33333333-3333-3333-3333-333333333333";
const TEST_SECURITY_ID = "44444444-4444-4444-4444-444444444444";
const TEST_HOLDING_ID = "55555555-5555-5555-5555-555555555555";
const TEST_TRANSACTION_ID = "66666666-6666-6666-6666-666666666666";
const TEST_SESSION_ID = "synthetic-investments-http-session";

// Hoist mocks before imports
const mockInvestmentService = vi.hoisted(() => ({
  listSecurities: vi.fn(),
  getSecurityById: vi.fn(),
  getSecurityPrices: vi.fn(),
  createSecurity: vi.fn(),
  updateSecurityPrice: vi.fn(),
  getHoldings: vi.fn(),
  getVisibleHoldingById: vi.fn(),
  getHoldingById: vi.fn(),
  createHolding: vi.fn(),
  updateHolding: vi.fn(),
  deleteHolding: vi.fn(),
  getTransactions: vi.fn(),
  createTransaction: vi.fn(),
  listFxRates: vi.fn(),
  createFxRate: vi.fn(),
  getFxHistorical: vi.fn(),
}));

const mockPortfolioValuationService = vi.hoisted(() => ({
  getHouseholdInvestmentValue: vi.fn(),
  getTBillsValue: vi.fn(),
  getPensionValue: vi.fn(),
}));

// Controller transport tests isolate the read boundary; the signed real-DB
// custody suite verifies its actual authority and captured-source behavior.
const mockPortfolioRead = vi.hoisted(() => vi.fn(async (
  _caller: unknown, _session: unknown, calculate: (context: undefined) => Promise<unknown>, _includeAlternatives = true,
) => calculate(undefined)));

const mockPerformanceService = vi.hoisted(() => ({
  gethistory: vi.fn(),
}));

const mockBusinessAuditService = vi.hoisted(() => ({
  log: vi.fn().mockResolvedValue(undefined),
  logCreate: vi.fn().mockResolvedValue(undefined),
  logUpdate: vi.fn().mockResolvedValue(undefined),
  logDelete: vi.fn().mockResolvedValue(undefined),
  getIpAddress: vi.fn().mockReturnValue("127.0.0.1"),
}));

const mockHouseholdRepository = vi.hoisted(() => ({
  findById: vi.fn().mockResolvedValue({ currency: "ZMW" }),
}));

vi.mock("../investments.service", () => ({
  investmentService: mockInvestmentService,
}));

vi.mock("../../../services/PortfolioValuationService", () => ({
  portfolioValuationService: mockPortfolioValuationService,
}));

vi.mock("../investmentPortfolioRead", () => ({ valueVisiblePortfolio: mockPortfolioRead }));

vi.mock("../../../services/InvestmentPerformanceService", () => ({
  investmentPerformanceService: mockPerformanceService,
  TimeFrame: ["1M", "3M", "YTD", "1Y", "ALL"],
}));

vi.mock("../../../services/BusinessAuditService", () => ({
  businessAuditService: mockBusinessAuditService,
}));

vi.mock("../../../repositories/HouseholdRepository", () => ({
  householdRepository: mockHouseholdRepository,
}));

vi.mock("../../../middleware/rateLimit", () => ({
  generalLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  analyticsLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../../../middleware/householdGuard", () => ({
  householdGuard: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../../../middleware/validateEntity", () => ({
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

import { investmentsController } from "../investments.controller";

function createTestApp(signed = true) {
  const app = express();
  app.use(express.json());

  // Mock auth middleware
  app.use((req, _res, next) => {
    req.user = { id: TEST_USER_ID, email: "test@example.com", securityGeneration: 0 } as unknown as import("@shared/schema").User;
    req.session = { userId: signed ? TEST_USER_ID : undefined, securityGeneration: 0 } as any;
    req.sessionID = TEST_SESSION_ID;
    req.householdContext = {
      householdId: TEST_HOUSEHOLD_ID,
      userId: TEST_USER_ID,
      role: "owner",
    };
    next();
  });

  // Mount investments routes
  const router = express.Router();

  // Securities
  router.get("/securities", investmentsController.listSecurities);
  router.get("/securities/:id", investmentsController.getSecurityById);
  router.get("/securities/:id/prices", investmentsController.getSecurityPrices);
  router.post("/securities", investmentsController.createSecurity);
  router.put("/securities/:id/price", investmentsController.updateSecurityPrice);

  // Holdings
  router.get("/holdings", investmentsController.listHoldings);
  router.get("/holdings/:id", investmentsController.getHoldingById);
  router.post("/holdings", investmentsController.createHolding);
  router.put("/holdings/:id", investmentsController.updateHolding);
  router.delete("/holdings/:id", investmentsController.deleteHolding);

  // Portfolio
  router.get("/portfolio", investmentsController.getPortfolioSummary);
  router.get("/portfolio/allocation", investmentsController.getAllocation);
  router.get("/performance", investmentsController.getPerformanceHistory);

  // Transactions
  router.get("/transactions", investmentsController.listTransactions);
  router.post("/transactions", investmentsController.createTransaction);

  // FX Rates
  router.get("/fx-rates", investmentsController.listFxRates);
  router.post("/fx-rates", investmentsController.createFxRate);
  router.get("/analytics/fx-historical", investmentsController.getFxHistorical);

  app.use("/api/investments", router);

  // Error handler middleware - maps error names to status codes
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    let statusCode = err.statusCode || err.status || 500;

    // Map error names to HTTP status codes
    if (err.name === "ValidationError") statusCode = 400;
    if (err.name === "NotFoundError") statusCode = 404;
    if (err.name === "UnauthorizedError") statusCode = 401;
    if (err.name === "ForbiddenError") statusCode = 403;
    if (err.name === "ConflictError") statusCode = 409;

    res.status(statusCode).json({
      success: false,
      error: {
        code: err.code || err.name || "INTERNAL_ERROR",
        message: err.message || "Internal server error",
      },
    });
  });

  return app;
}

describe("Investments HTTP API Integration Tests", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  // ===========================================================================
  // Securities Endpoints
  // ===========================================================================
  describe("GET /api/investments/securities", () => {
    it("returns list of securities", async () => {
      const mockSecurities = [
        { id: TEST_SECURITY_ID, symbol: "AAPL", name: "Apple Inc", type: "stock", currency: "USD" },
        { id: "sec-2", symbol: "MSFT", name: "Microsoft", type: "stock", currency: "USD" },
      ];

      mockInvestmentService.listSecurities.mockResolvedValue(mockSecurities);

      const response = await request(app)
        .get("/api/investments/securities")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(mockInvestmentService.listSecurities).toHaveBeenCalledWith(
        {},
        { householdId: TEST_HOUSEHOLD_ID, userId: TEST_USER_ID, role: "owner" },
        { snapshot: expect.objectContaining({ id: TEST_USER_ID }), sessionId: TEST_SESSION_ID, generation: 0 },
      );
    });

    it("filters by type when provided", async () => {
      mockInvestmentService.listSecurities.mockResolvedValue([]);

      await request(app)
        .get("/api/investments/securities")
        .query({ type: "bond" })
        .expect(200);

      expect(mockInvestmentService.listSecurities).toHaveBeenCalledWith(
        expect.objectContaining({ type: "bond" }),
        { householdId: TEST_HOUSEHOLD_ID, userId: TEST_USER_ID, role: "owner" },
        { snapshot: expect.objectContaining({ id: TEST_USER_ID }), sessionId: TEST_SESSION_ID, generation: 0 },
      );
    });
  });

  describe("GET /api/investments/securities/:id", () => {
    it("returns security when found", async () => {
      const mockSecurity = {
        id: TEST_SECURITY_ID,
        symbol: "AAPL",
        name: "Apple Inc",
        type: "stock",
        currency: "USD",
        currentPrice: "150.00",
      };

      mockInvestmentService.getSecurityById.mockResolvedValue(mockSecurity);

      const response = await request(app)
        .get(`/api/investments/securities/${TEST_SECURITY_ID}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.symbol).toBe("AAPL");
      expect(mockInvestmentService.getSecurityById).toHaveBeenCalledWith(
        TEST_SECURITY_ID,
        { householdId: TEST_HOUSEHOLD_ID, userId: TEST_USER_ID, role: "owner" },
        { snapshot: expect.objectContaining({ id: TEST_USER_ID }), sessionId: TEST_SESSION_ID, generation: 0 },
      );
    });

    it("returns 404 when security not found", async () => {
      mockInvestmentService.getSecurityById.mockResolvedValue(null);

      const response = await request(app)
        .get("/api/investments/securities/nonexistent")
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe("POST /api/investments/securities", () => {
    it("creates security successfully", async () => {
      const newSecurity = {
        id: TEST_SECURITY_ID,
        symbol: "ZESCO",
        name: "Zesco Ltd",
        type: "stock",
        currency: "ZMW",
      };

      mockInvestmentService.createSecurity.mockResolvedValue(newSecurity);

      const response = await request(app)
        .post("/api/investments/securities")
        .send({
          symbol: "ZESCO",
          name: "Zesco Ltd",
          type: "stock",
          currency: "ZMW",
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.symbol).toBe("ZESCO");
      expect(mockInvestmentService.createSecurity).toHaveBeenCalledWith(
        { symbol: "ZESCO", name: "Zesco Ltd", type: "stock", currency: "ZMW", isOffshore: false },
        { householdId: TEST_HOUSEHOLD_ID, userId: TEST_USER_ID, role: "owner" },
        expect.any(String),
        { snapshot: { id: TEST_USER_ID, email: "test@example.com", securityGeneration: 0 }, sessionId: TEST_SESSION_ID, generation: 0 },
      );
      expect(mockBusinessAuditService.logCreate).not.toHaveBeenCalled();
    });

    it("requires the admitted request to carry the authenticated session before dispatching a write", async () => {
      mockInvestmentService.createSecurity.mockResolvedValue({ id: TEST_SECURITY_ID, symbol: "SYN" });
      await request(createTestApp(false)).post("/api/investments/securities")
        .send({ symbol: "SYN", name: "Synthetic instrument", type: "stock", currency: "ZMW" }).expect(401);
      expect(mockInvestmentService.createSecurity).not.toHaveBeenCalled();
    });

    it("returns 400 for invalid input", async () => {
      const response = await request(app)
        .post("/api/investments/securities")
        .send({ symbol: "X" }) // Missing required fields
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe("PUT /api/investments/securities/:id/price", () => {
    it("passes the chosen price window and signed identity to the household writer", async () => {
      mockInvestmentService.updateSecurityPrice.mockResolvedValue({
        id: "override-id",
        securityId: TEST_SECURITY_ID,
        symbol: "SYNTHETIC",
        price: "155.00",
        effectiveDate: "2026-01-21",
        validThrough: "2026-01-31",
      });

      const response = await request(app)
        .put(`/api/investments/securities/${TEST_SECURITY_ID}/price`)
        .send({ price: "155.00", date: "2026-01-21", validThrough: "2026-01-31" })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockInvestmentService.updateSecurityPrice).toHaveBeenCalledWith(
        TEST_SECURITY_ID,
        { price: "155.00", date: "2026-01-21", validThrough: "2026-01-31" },
        { householdId: TEST_HOUSEHOLD_ID, userId: TEST_USER_ID, role: "owner" },
        expect.any(String),
        {
          snapshot: expect.objectContaining({ id: TEST_USER_ID, securityGeneration: 0 }),
          sessionId: TEST_SESSION_ID,
          generation: 0,
        },
      );
      expect(mockInvestmentService.getSecurityById).not.toHaveBeenCalled();
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });

    it("returns 404 when security not found", async () => {
      mockInvestmentService.updateSecurityPrice.mockRejectedValueOnce(new NotFoundError("Security not found"));

      const response = await request(app)
        .put(`/api/investments/securities/${TEST_SECURITY_ID}/price`)
        .send({ price: "100.00", date: "2026-01-21", validThrough: "2026-01-31" })
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it("rejects malformed identifiers before calling the writer", async () => {
      await request(app)
        .put("/api/investments/securities/nonexistent/price")
        .send({ price: "100.00", date: "2026-01-21", validThrough: "2026-01-31" })
        .expect(400);
      expect(mockInvestmentService.updateSecurityPrice).not.toHaveBeenCalled();
    });

    it.each([
      { price: "100.00", date: "2026-01-21" },
      { price: "100.00", validThrough: "2026-01-31" },
      { price: "100.00", date: "2026-01-21", validThrough: "2026-01-20" },
    ])("rejects an incomplete or reversed price window %j", async input => {
      await request(app)
        .put(`/api/investments/securities/${TEST_SECURITY_ID}/price`)
        .send(input)
        .expect(400);
      expect(mockInvestmentService.updateSecurityPrice).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Holdings Endpoints
  // ===========================================================================
  describe("GET /api/investments/holdings", () => {
    it("returns holdings for household", async () => {
      const mockHoldings = [
        {
          id: TEST_HOLDING_ID,
          accountId: TEST_ACCOUNT_ID,
          securityId: TEST_SECURITY_ID,
          quantity: "100",
          currentValue: { amount: "15000.00", currency: "ZMW" },
        },
      ];

      mockInvestmentService.getHoldings.mockResolvedValue(mockHoldings);

      const response = await request(app)
        .get("/api/investments/holdings")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(mockInvestmentService.getHoldings).toHaveBeenCalledWith(
        { householdId: TEST_HOUSEHOLD_ID, userId: TEST_USER_ID, role: "owner" },
        expect.any(Object),
        "ZMW",
        { snapshot: expect.objectContaining({ id: TEST_USER_ID }), sessionId: TEST_SESSION_ID, generation: 0 },
      );
    });
  });

  describe("GET /api/investments/holdings/:id", () => {
    it("returns holding when found", async () => {
      const mockHolding = {
        id: TEST_HOLDING_ID,
        accountId: TEST_ACCOUNT_ID,
        quantity: "100",
        security: { symbol: "AAPL", name: "Apple Inc" },
      };

      mockInvestmentService.getVisibleHoldingById.mockResolvedValue(mockHolding);

      const response = await request(app)
        .get(`/api/investments/holdings/${TEST_HOLDING_ID}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(TEST_HOLDING_ID);
      expect(mockInvestmentService.getVisibleHoldingById).toHaveBeenCalledWith(
        TEST_HOLDING_ID,
        { householdId: TEST_HOUSEHOLD_ID, userId: TEST_USER_ID, role: "owner" },
        { snapshot: expect.objectContaining({ id: TEST_USER_ID }), sessionId: TEST_SESSION_ID, generation: 0 },
      );
    });

    it("returns 404 when holding not found", async () => {
      mockInvestmentService.getVisibleHoldingById.mockResolvedValue(null);

      const response = await request(app)
        .get("/api/investments/holdings/nonexistent")
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe("POST /api/investments/holdings", () => {
    it("creates holding successfully", async () => {
      const newHolding = {
        id: TEST_HOLDING_ID,
        accountId: TEST_ACCOUNT_ID,
        securityId: TEST_SECURITY_ID,
        quantity: "100",
        costBasis: "5000.00",
        acquiredDate: "2026-01-15",
      };

      mockInvestmentService.createHolding.mockResolvedValue(newHolding);

      const response = await request(app)
        .post("/api/investments/holdings")
        .send({
          ...openingDeclaration,
          accountId: TEST_ACCOUNT_ID,
          securityId: TEST_SECURITY_ID,
          quantity: "100",
          costBasis: "5000.00",
          acquiredDate: "2026-01-15", // Required field
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(TEST_HOLDING_ID);
      expect(mockInvestmentService.createHolding).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: TEST_ACCOUNT_ID, securityId: TEST_SECURITY_ID, acquiredDate: "2026-01-15" }),
        expect.objectContaining({ householdId: TEST_HOUSEHOLD_ID, userId: TEST_USER_ID, role: "owner" }),
        "127.0.0.1",
        { snapshot: expect.objectContaining({ id: TEST_USER_ID, securityGeneration: 0 }), sessionId: TEST_SESSION_ID, generation: 0 },
      );
    });

    it("returns 400 for invalid input", async () => {
      const response = await request(app)
        .post("/api/investments/holdings")
        .send({ accountId: "invalid-uuid" }) // Invalid UUID
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe("PUT /api/investments/holdings/:id", () => {
    it("delegates the holding edit admission result with current actor and session", async () => {
      mockInvestmentService.getHoldingById.mockResolvedValue({
        id: TEST_HOLDING_ID,
        quantity: "100",
        costBasis: "5000.00",
      });
      mockInvestmentService.updateHolding.mockResolvedValue({
        id: TEST_HOLDING_ID,
        quantity: "150",
        costBasis: "7500.00",
      });

      const response = await request(app)
        .put(`/api/investments/holdings/${TEST_HOLDING_ID}`)
        .send({ quantity: "150", costBasis: "7500.00" })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockInvestmentService.updateHolding).toHaveBeenCalledWith(TEST_HOLDING_ID,
        { quantity: "150", costBasis: "7500.00" }, { householdId: TEST_HOUSEHOLD_ID, userId: TEST_USER_ID, role: "owner" }, "127.0.0.1",
        { snapshot: expect.objectContaining({ id: TEST_USER_ID, securityGeneration: 0 }), sessionId: TEST_SESSION_ID, generation: 0 });
      expect(mockBusinessAuditService.logUpdate).not.toHaveBeenCalled();
    });

    it("returns 404 when holding not found", async () => {
      mockInvestmentService.updateHolding.mockRejectedValueOnce(new NotFoundError("Holding"));

      const response = await request(app)
        .put("/api/investments/holdings/nonexistent")
        .send({ quantity: "100" })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(mockInvestmentService.updateHolding).toHaveBeenCalledOnce();
      expect(mockInvestmentService.getHoldingById).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /api/investments/holdings/:id", () => {
    it("delegates an authorized shell deletion to the atomic service", async () => {
      mockInvestmentService.deleteHolding.mockResolvedValue(true);

      const response = await request(app)
        .delete(`/api/investments/holdings/${TEST_HOLDING_ID}`)
        .expect(204);

      expect(mockInvestmentService.deleteHolding).toHaveBeenCalledWith(
        TEST_HOLDING_ID,
        expect.objectContaining({ householdId: TEST_HOUSEHOLD_ID, userId: TEST_USER_ID }),
        "127.0.0.1",
        { snapshot: expect.objectContaining({ id: TEST_USER_ID, securityGeneration: 0 }), sessionId: TEST_SESSION_ID, generation: 0 },
      );
      expect(mockInvestmentService.getHoldingById).not.toHaveBeenCalled();
      expect(mockBusinessAuditService.logDelete).not.toHaveBeenCalled();
    });

    it("returns 404 when holding not found", async () => {
      mockInvestmentService.deleteHolding.mockRejectedValueOnce(new NotFoundError("Holding"));

      const response = await request(app)
        .delete("/api/investments/holdings/nonexistent")
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(mockInvestmentService.deleteHolding).toHaveBeenCalledOnce();
      expect(mockInvestmentService.getHoldingById).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Portfolio Endpoints
  // ===========================================================================
  describe("GET /api/investments/portfolio", () => {
    it("returns portfolio summary", async () => {
      // The valuation service returns Money; the response carries MoneyDto (NEW-35 class).
      mockPortfolioValuationService.getHouseholdInvestmentValue.mockResolvedValue({
        totalValue: Money.from("50000"), totalCostBasis: Money.from("45000"), totalGainLoss: Money.from("5000"),
        totalGainLossPercent: 11.11, holdingsCount: 2,
        byType: { stock: Money.from("40000"), bond: Money.from("10000") },
      });
      mockPortfolioValuationService.getTBillsValue.mockResolvedValue(Money.from("5000"));
      mockPortfolioValuationService.getPensionValue.mockResolvedValue(Money.from("15000"));

      const response = await request(app)
        .get("/api/investments/portfolio")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.totalValue).toEqual({ amount: "50000.00", currency: "ZMW" });
      expect(response.body.data.byType).toEqual({ stock: { amount: "40000.00", currency: "ZMW" }, bond: { amount: "10000.00", currency: "ZMW" } });
      expect(response.body.data.totalIncludingAlternatives).toEqual({ amount: "70000.00", currency: "ZMW" });
      expect(mockPortfolioRead).toHaveBeenCalledWith(
        { householdId: TEST_HOUSEHOLD_ID, userId: TEST_USER_ID, role: "owner" },
        { snapshot: expect.objectContaining({ id: TEST_USER_ID, securityGeneration: 0 }), sessionId: TEST_SESSION_ID, generation: 0 },
        expect.any(Function),
      );
    });
  });

  describe("GET /api/investments/portfolio/allocation", () => {
    it("returns allocation breakdown", async () => {
      mockPortfolioValuationService.getHouseholdInvestmentValue.mockResolvedValue({
        totalValue: Money.from("100000"),
        byType: { stock: Money.from("60000"), bond: Money.from("30000"), etf: Money.from("10000") },
      });

      const response = await request(app)
        .get("/api/investments/portfolio/allocation")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3);
      expect(response.body.data).toEqual(expect.arrayContaining([
        { category: "stock", value: { amount: "60000.00", currency: "ZMW" }, percentage: 60 },
        { category: "etf", value: { amount: "10000.00", currency: "ZMW" }, percentage: 10 },
      ]));
      expect(response.body.meta).toMatchObject({ totalValue: { amount: "100000.00", currency: "ZMW" } });
      expect(mockPortfolioRead).toHaveBeenCalledWith(
        { householdId: TEST_HOUSEHOLD_ID, userId: TEST_USER_ID, role: "owner" },
        { snapshot: expect.objectContaining({ id: TEST_USER_ID }), sessionId: TEST_SESSION_ID, generation: 0 },
        expect.any(Function), false,
      );
      expect(mockPortfolioValuationService.getTBillsValue).not.toHaveBeenCalled();
      expect(mockPortfolioValuationService.getPensionValue).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/investments/performance", () => {
    it("returns performance history", async () => {
      mockPerformanceService.gethistory.mockResolvedValue([
        { date: "2026-01-01", value: 45000 },
        { date: "2026-01-15", value: 48000 },
      ]);

      const response = await request(app)
        .get("/api/investments/performance")
        .query({ timeframe: "1M" })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
    });
  });

  // ===========================================================================
  // Transaction Endpoints
  // ===========================================================================
  describe("GET /api/investments/transactions", () => {
    it("returns investment transactions", async () => {
      const mockTransactions = [
        { id: TEST_TRANSACTION_ID, type: "buy", amount: "5000.00" },
      ];

      mockInvestmentService.getTransactions.mockResolvedValue(mockTransactions);

      const response = await request(app)
        .get("/api/investments/transactions")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
    });
  });

  describe("POST /api/investments/transactions", () => {
    it("creates buy transaction successfully", async () => {
      const newTransaction = {
        id: TEST_TRANSACTION_ID,
        type: "buy",
        amount: "5000.00",
        quantity: "100",
      };

      mockInvestmentService.createTransaction.mockResolvedValue(newTransaction);

      const response = await request(app)
        .post("/api/investments/transactions")
        .send({
          accountId: TEST_ACCOUNT_ID,
          securityId: TEST_SECURITY_ID, // H2 FIX: Required for buy transactions
          holdingId: TEST_HOLDING_ID, // H2 FIX: Required for buy transactions
          type: "buy",
          quantity: "100",
          price: "50.00",
          amount: "5000.00",
          transactionDate: "2026-01-21",
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.type).toBe("buy");
      expect(mockInvestmentService.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ type: "buy", amount: "5000.00" }),
        { householdId: TEST_HOUSEHOLD_ID, userId: TEST_USER_ID, role: "owner" }, "127.0.0.1",
      );
      // The real service owns its atomic financial CREATE proof. The route
      // cannot append a second household-wide private investment audit.
      expect(mockBusinessAuditService.logCreate).not.toHaveBeenCalled();
    });

    it("returns 400 for invalid transaction type", async () => {
      const response = await request(app)
        .post("/api/investments/transactions")
        .send({
          accountId: TEST_ACCOUNT_ID,
          type: "invalid_type",
          amount: "5000.00",
          transactionDate: "2026-01-21",
        })
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  // ===========================================================================
  // FX Rate Endpoints
  // ===========================================================================
  describe("GET /api/investments/fx-rates", () => {
    it("returns FX rates", async () => {
      const mockRates = [
        { id: "rate-1", fromCurrency: "USD", toCurrency: "ZMW", rate: "27.50" },
      ];

      mockInvestmentService.listFxRates.mockResolvedValue(mockRates);

      const response = await request(app)
        .get("/api/investments/fx-rates")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
    });
  });

  describe("POST /api/investments/fx-rates", () => {
    it("creates FX rate successfully", async () => {
      const newRate = {
        id: "rate-new",
        fromCurrency: "EUR",
        toCurrency: "ZMW",
        rate: "29.50",
        date: "2026-01-21",
      };

      mockInvestmentService.createFxRate.mockResolvedValue(newRate);

      const body = { fromCurrency: "EUR", toCurrency: "ZMW", rate: "29.50", date: "2026-01-21", validThrough: "2026-01-31" };
      const response = await request(app)
        .post("/api/investments/fx-rates")
        .send(body)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.fromCurrency).toBe("EUR");
      // The household writer audits inside its own transaction (real-DB proof in
      // completion-r12.household-fx-rates); the controller passes the caller through.
      const [input, caller, , session] = mockInvestmentService.createFxRate.mock.calls[0];
      expect(input).toEqual(body);
      expect(caller).toEqual({ householdId: TEST_HOUSEHOLD_ID, userId: TEST_USER_ID, role: "owner" });
      expect(session).toEqual({ snapshot: expect.objectContaining({ id: TEST_USER_ID }), sessionId: TEST_SESSION_ID, generation: 0 });
    });

    it("returns 400 for invalid currency code", async () => {
      const response = await request(app)
        .post("/api/investments/fx-rates")
        .send({
          fromCurrency: "INVALID", // Too long
          toCurrency: "ZMW",
          rate: "27.50",
          date: "2026-01-21",
          validThrough: "2026-01-31",
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(mockInvestmentService.createFxRate).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/investments/analytics/fx-historical", () => {
    it("returns historical FX data", async () => {
      const mockHistory = [
        { date: "2026-01-01", rate: 27.0 },
        { date: "2026-01-15", rate: 27.5 },
      ];

      mockInvestmentService.getFxHistorical.mockResolvedValue(mockHistory);

      const response = await request(app)
        .get("/api/investments/analytics/fx-historical")
        .query({ from: "USD", to: "ZMW" })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
    });
  });

  // ===========================================================================
  // Audit Logging Tests
  // ===========================================================================
  describe("Audit Logging", () => {
    it("delegates opening with the actor and IP for atomic financial audit", async () => {
      mockInvestmentService.createHolding.mockResolvedValue({
        id: TEST_HOLDING_ID,
        accountId: TEST_ACCOUNT_ID,
        securityId: TEST_SECURITY_ID,
        quantity: "100",
        costBasis: "5000.00",
        acquiredDate: "2026-01-15",
      });

      await request(app)
        .post("/api/investments/holdings")
        .send({
          ...openingDeclaration,
          accountId: TEST_ACCOUNT_ID,
          securityId: TEST_SECURITY_ID,
          quantity: "100",
          costBasis: "5000.00",
          acquiredDate: "2026-01-15", // Required field
        })
        .expect(201);

      expect(mockInvestmentService.createHolding).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: "100", costBasis: "5000.00", acquiredDate: "2026-01-15" }),
        { householdId: TEST_HOUSEHOLD_ID, userId: TEST_USER_ID, role: "owner" },
        "127.0.0.1",
        { snapshot: expect.objectContaining({ id: TEST_USER_ID, securityGeneration: 0 }), sessionId: TEST_SESSION_ID, generation: 0 },
      );
      expect(mockBusinessAuditService.logCreate).not.toHaveBeenCalled();
    });

    it("leaves the atomic delete audit to the actor-bound service", async () => {
      mockInvestmentService.deleteHolding.mockResolvedValue(true);

      await request(app)
        .delete(`/api/investments/holdings/${TEST_HOLDING_ID}`)
        .expect(204);

      expect(mockInvestmentService.deleteHolding).toHaveBeenCalledOnce();
      expect(mockInvestmentService.getHoldingById).not.toHaveBeenCalled();
      expect(mockBusinessAuditService.logDelete).not.toHaveBeenCalled();
    });
  });
});
