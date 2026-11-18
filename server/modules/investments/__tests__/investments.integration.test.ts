/**
 * Investments Module - Integration Tests
 *
 * Tests for validation schemas, HTTP API endpoints, and data integrity.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import {
  createSecuritySchema,
  updateSecurityPriceSchema,
  createFxRateSchema,
  fxHistoricalQuerySchema,
  listFxRatesQuerySchema,
  createHoldingSchema,
  createInvestmentTransactionSchema,
} from "../investments.validation";

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

    it("accepts optional fields", () => {
      const input = {
        symbol: "TEST",
        name: "Test Security",
        type: "bond",
        currency: "ZMW",
        exchange: "luse",
        sector: "Financial",
        isOffshore: true,
        currentPrice: "100.50",
      };

      const result = createSecuritySchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isOffshore).toBe(true);
        expect(result.data.sector).toBe("Financial");
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
    it("validates valid price update", () => {
      const input = {
        price: "150.00",
        date: "2026-01-21",
      };

      const result = updateSecurityPriceSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts price without date", () => {
      const input = {
        price: "150.00",
      };

      const result = updateSecurityPriceSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects invalid date format", () => {
      const input = {
        price: "150.00",
        date: "01-21-2026", // Wrong format
      };

      const result = updateSecurityPriceSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("accepts numeric price", () => {
      const input = {
        price: 150.00,
      };

      const result = updateSecurityPriceSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        // Price should be converted to string
        expect(result.data.price).toBe("150");
      }
    });
  });

  describe("createFxRateSchema", () => {
    it("validates valid FX rate input", () => {
      const input = {
        fromCurrency: "USD",
        toCurrency: "ZMW",
        rate: "27.50",
      };

      const result = createFxRateSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects invalid currency codes (too short)", () => {
      const input = {
        fromCurrency: "US", // Too short
        toCurrency: "ZMW",
        rate: "27.50",
      };

      const result = createFxRateSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects invalid currency codes (too long)", () => {
      const input = {
        fromCurrency: "USDD", // Too long
        toCurrency: "ZMW",
        rate: "27.50",
      };

      const result = createFxRateSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("accepts optional date and source", () => {
      const input = {
        fromCurrency: "EUR",
        toCurrency: "ZMW",
        rate: "29.50",
        date: "2026-01-21",
        source: "bank",
      };

      const result = createFxRateSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("defaults source to manual", () => {
      const input = {
        fromCurrency: "USD",
        toCurrency: "ZMW",
        rate: "27.50",
      };

      const result = createFxRateSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.source).toBe("manual");
      }
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

      const result = createHoldingSchema.safeParse(input);
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

      const result = createHoldingSchema.safeParse(input);
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

      const result = createHoldingSchema.safeParse(input);
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

      const result = createHoldingSchema.safeParse(input);
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

      const result = createHoldingSchema.safeParse(input);
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

    it("defaults currency to ZMW", () => {
      const input = {
        accountId: "11111111-1111-1111-1111-111111111111",
        type: "fee", // H2 FIX: Use fee type which doesn't require holdingId/quantity/price
        amount: "5000.00",
        transactionDate: "2026-01-21",
      };

      const result = createInvestmentTransactionSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.currency).toBe("ZMW");
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

// Hoist mocks before imports
const mockInvestmentService = vi.hoisted(() => ({
  listSecurities: vi.fn(),
  getSecurityById: vi.fn(),
  getSecurityPrices: vi.fn(),
  createSecurity: vi.fn(),
  updateSecurityPrice: vi.fn(),
  getHoldings: vi.fn(),
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

function createTestApp() {
  const app = express();
  app.use(express.json());

  // Mock auth middleware
  app.use((req, _res, next) => {
    req.user = { id: TEST_USER_ID, email: "test@example.com" } as unknown as import("@shared/schema").User;
    req.session = { userId: TEST_USER_ID } as any;
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
      expect(mockInvestmentService.listSecurities).toHaveBeenCalled();
    });

    it("filters by type when provided", async () => {
      mockInvestmentService.listSecurities.mockResolvedValue([]);

      await request(app)
        .get("/api/investments/securities")
        .query({ type: "bond" })
        .expect(200);

      expect(mockInvestmentService.listSecurities).toHaveBeenCalledWith(
        expect.objectContaining({ type: "bond" })
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
      expect(mockBusinessAuditService.logCreate).toHaveBeenCalled();
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
    it("updates security price successfully", async () => {
      mockInvestmentService.getSecurityById.mockResolvedValue({
        id: TEST_SECURITY_ID,
        currentPrice: "100.00",
      });
      mockInvestmentService.updateSecurityPrice.mockResolvedValue({
        id: TEST_SECURITY_ID,
        currentPrice: "155.00",
      });

      const response = await request(app)
        .put(`/api/investments/securities/${TEST_SECURITY_ID}/price`)
        .send({ price: "155.00" })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockBusinessAuditService.logUpdate).toHaveBeenCalled();
    });

    it("returns 404 when security not found", async () => {
      mockInvestmentService.getSecurityById.mockResolvedValue(null);

      const response = await request(app)
        .put("/api/investments/securities/nonexistent/price")
        .send({ price: "100.00" })
        .expect(404);

      expect(response.body.success).toBe(false);
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
          currentValue: 15000,
        },
      ];

      mockInvestmentService.getHoldings.mockResolvedValue(mockHoldings);

      const response = await request(app)
        .get("/api/investments/holdings")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(mockInvestmentService.getHoldings).toHaveBeenCalledWith(
        TEST_HOUSEHOLD_ID,
        expect.any(Object),
        "ZMW"
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

      mockInvestmentService.getHoldingById.mockResolvedValue(mockHolding);

      const response = await request(app)
        .get(`/api/investments/holdings/${TEST_HOLDING_ID}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(TEST_HOLDING_ID);
    });

    it("returns 404 when holding not found", async () => {
      mockInvestmentService.getHoldingById.mockResolvedValue(null);

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
          accountId: TEST_ACCOUNT_ID,
          securityId: TEST_SECURITY_ID,
          quantity: "100",
          costBasis: "5000.00",
          acquiredDate: "2026-01-15", // Required field
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(TEST_HOLDING_ID);
      expect(mockBusinessAuditService.logCreate).toHaveBeenCalled();
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
    it("updates holding successfully", async () => {
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
      expect(mockBusinessAuditService.logUpdate).toHaveBeenCalled();
    });

    it("returns 404 when holding not found", async () => {
      mockInvestmentService.getHoldingById.mockResolvedValue(null);

      const response = await request(app)
        .put("/api/investments/holdings/nonexistent")
        .send({ quantity: "100" })
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe("DELETE /api/investments/holdings/:id", () => {
    it("deletes holding successfully", async () => {
      mockInvestmentService.getHoldingById.mockResolvedValue({
        id: TEST_HOLDING_ID,
        accountId: TEST_ACCOUNT_ID,
        quantity: "100",
      });
      mockInvestmentService.deleteHolding.mockResolvedValue(true);

      const response = await request(app)
        .delete(`/api/investments/holdings/${TEST_HOLDING_ID}`)
        .expect(204);

      expect(mockBusinessAuditService.logDelete).toHaveBeenCalled();
    });

    it("returns 404 when holding not found", async () => {
      mockInvestmentService.getHoldingById.mockResolvedValue(null);

      const response = await request(app)
        .delete("/api/investments/holdings/nonexistent")
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  // ===========================================================================
  // Portfolio Endpoints
  // ===========================================================================
  describe("GET /api/investments/portfolio", () => {
    it("returns portfolio summary", async () => {
      mockPortfolioValuationService.getHouseholdInvestmentValue.mockResolvedValue({
        totalValue: 50000,
        byType: { stock: 40000, bond: 10000 },
      });
      mockPortfolioValuationService.getTBillsValue.mockResolvedValue(5000);
      mockPortfolioValuationService.getPensionValue.mockResolvedValue(15000);

      const response = await request(app)
        .get("/api/investments/portfolio")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.totalValue).toBe(50000);
      expect(response.body.data.totalIncludingAlternatives).toBe(70000);
    });
  });

  describe("GET /api/investments/portfolio/allocation", () => {
    it("returns allocation breakdown", async () => {
      mockPortfolioValuationService.getHouseholdInvestmentValue.mockResolvedValue({
        totalValue: 100000,
        byType: { stock: 60000, bond: 30000, etf: 10000 },
      });

      const response = await request(app)
        .get("/api/investments/portfolio/allocation")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3);
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
      expect(mockBusinessAuditService.logCreate).toHaveBeenCalled();
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

      const response = await request(app)
        .post("/api/investments/fx-rates")
        .send({
          fromCurrency: "EUR",
          toCurrency: "ZMW",
          rate: "29.50",
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.fromCurrency).toBe("EUR");
      expect(mockBusinessAuditService.logCreate).toHaveBeenCalled();
    });

    it("returns 400 for invalid currency code", async () => {
      const response = await request(app)
        .post("/api/investments/fx-rates")
        .send({
          fromCurrency: "INVALID", // Too long
          toCurrency: "ZMW",
          rate: "27.50",
        })
        .expect(400);

      expect(response.body.success).toBe(false);
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
    it("logs create action for new holding", async () => {
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
          accountId: TEST_ACCOUNT_ID,
          securityId: TEST_SECURITY_ID,
          quantity: "100",
          costBasis: "5000.00",
          acquiredDate: "2026-01-15", // Required field
        })
        .expect(201);

      expect(mockBusinessAuditService.logCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          householdId: TEST_HOUSEHOLD_ID,
          entityType: "holding",
          entityId: TEST_HOLDING_ID,
        })
      );
    });

    it("logs delete action for holding", async () => {
      mockInvestmentService.getHoldingById.mockResolvedValue({
        id: TEST_HOLDING_ID,
        accountId: TEST_ACCOUNT_ID,
        securityId: TEST_SECURITY_ID,
        quantity: "100",
        costBasis: "5000.00",
      });
      mockInvestmentService.deleteHolding.mockResolvedValue(true);

      await request(app)
        .delete(`/api/investments/holdings/${TEST_HOLDING_ID}`)
        .expect(204);

      expect(mockBusinessAuditService.logDelete).toHaveBeenCalledWith(
        expect.objectContaining({
          householdId: TEST_HOUSEHOLD_ID,
          entityType: "holding",
          entityId: TEST_HOLDING_ID,
        })
      );
    });
  });
});
