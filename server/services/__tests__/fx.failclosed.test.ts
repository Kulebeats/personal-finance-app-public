/**
 * SCP-321 follow-up: FX conversion must FAIL CLOSED on a missing rate in the
 * snapshot worker, account-reporting, FX-attribution, and portfolio-valuation
 * services. A missing rate must throw CalculationError("MISSING_FX_RATE"), never
 * silently default to rate=1 (which corrupts multi-currency totals).
 *
 * These are fast unit tests that stub the FX rate source (getLatestFxRates) plus
 * the minimal DB/repository surface each service touches.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { CalculationError } from "../../core/calculations/errors";

// --- Shared mocks -----------------------------------------------------------

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  query: {
    holdings: {
      findMany: vi.fn(),
    },
  },
};

vi.mock("../../db", () => ({ db: mockDb }));

vi.mock("../../core/calculations", () => ({
  getLatestFxRates: vi.fn(),
}));

vi.mock("../../config/redis", () => ({ redis: null }));

const mockAccountRepository = { getBalancesForNetWorth: vi.fn() };
const mockHouseholdRepository = { findById: vi.fn() };

vi.mock("../../repositories/AccountRepository", () => ({
  accountRepository: mockAccountRepository,
}));
vi.mock("../../repositories/HouseholdRepository", () => ({
  householdRepository: mockHouseholdRepository,
}));

// --- Helpers ----------------------------------------------------------------

type SelectResult = readonly unknown[];

/** Minimal chainable Drizzle select-builder stub that resolves to `result`. */
function createSelectQuery(result: SelectResult) {
  const builder = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    innerJoin: vi.fn(() => builder),
    limit: vi.fn(() => Promise.resolve(result)),
    then: (
      onFulfilled: (value: SelectResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return builder;
}

const EMPTY_RATES = new Map<string, number>();

describe("FX fail-closed (SCP-321 follow-up)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // PortfolioValuationService.computeHoldingMetrics (pure, no DB)
  // -------------------------------------------------------------------------
  describe("PortfolioValuationService", () => {
    it("computeHoldingMetrics throws MISSING_FX_RATE when the rate is absent", async () => {
      const { portfolioValuationService } = await import(
        "../PortfolioValuationService"
      );

      const holding = {
        id: "holding-1",
        quantity: "10",
        currentPrice: "100",
        costBasis: "500",
      } as never;
      const security = {
        id: "sec-1",
        currency: "USD",
        currentPrice: "100",
        type: "equity",
      } as never;

      try {
        portfolioValuationService.computeHoldingMetrics(
          holding,
          security,
          "ZMW",
          EMPTY_RATES, // USD->ZMW rate missing
        );
        throw new Error("expected computeHoldingMetrics to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(CalculationError);
        expect((err as CalculationError).code).toBe("MISSING_FX_RATE");
      }
    });

    it("computeHoldingMetrics succeeds for self-currency (rate 1 is legitimate)", async () => {
      const { portfolioValuationService } = await import(
        "../PortfolioValuationService"
      );

      const holding = {
        id: "holding-1",
        quantity: "10",
        currentPrice: "100",
        costBasis: "500",
      } as never;
      const security = {
        id: "sec-1",
        currency: "ZMW",
        currentPrice: "100",
        type: "equity",
      } as never;

      const metrics = portfolioValuationService.computeHoldingMetrics(
        holding,
        security,
        "ZMW",
        EMPTY_RATES,
      );
      expect(metrics.fxRateUsed).toBe(1);
      expect(metrics.currentValueBase).toBe(1000);
    });

    it("getTBillsValue throws MISSING_FX_RATE when the ZMW->base rate is absent", async () => {
      const { getLatestFxRates } = await import("../../core/calculations");
      vi.mocked(getLatestFxRates).mockResolvedValue(EMPTY_RATES);
      mockDb.select.mockReturnValueOnce(
        createSelectQuery([{ faceValue: "1000" }]),
      );

      const { portfolioValuationService } = await import(
        "../PortfolioValuationService"
      );

      await expect(
        portfolioValuationService.getTBillsValue("house-1", "USD"),
      ).rejects.toThrow(CalculationError);
    });

    it("getPensionValue throws MISSING_FX_RATE when the ZMW->base rate is absent", async () => {
      const { getLatestFxRates } = await import("../../core/calculations");
      vi.mocked(getLatestFxRates).mockResolvedValue(EMPTY_RATES);
      mockDb.select.mockReturnValueOnce(
        createSelectQuery([{ balance: "1000" }]),
      );

      const { portfolioValuationService } = await import(
        "../PortfolioValuationService"
      );

      await expect(
        portfolioValuationService.getPensionValue("house-1", "USD"),
      ).rejects.toThrow(CalculationError);
    });
  });

  // -------------------------------------------------------------------------
  // FXAttributionService
  // -------------------------------------------------------------------------
  describe("FXAttributionService", () => {
    it("calculateAttribution throws MISSING_FX_RATE when a holding's rate is absent", async () => {
      const { getLatestFxRates } = await import("../../core/calculations");
      vi.mocked(getLatestFxRates).mockResolvedValue(EMPTY_RATES); // USD missing

      mockDb.query.holdings.findMany.mockResolvedValue([
        {
          id: "holding-1",
          quantity: "10",
          costBasis: "900",
          security: {
            id: "sec-1",
            name: "Example Corp",
            symbol: "EXM",
            currency: "USD",
            currentPrice: "120",
          },
        },
      ]);
      // taxLots select -> empty
      mockDb.select.mockReturnValueOnce(createSelectQuery([]));

      const { fxAttributionService } = await import("../FXAttributionService");

      await expect(
        fxAttributionService.calculateAttribution("house-1", "ZMW"),
      ).rejects.toThrow(CalculationError);
    });
  });

  // -------------------------------------------------------------------------
  // AccountReportingService.getNetWorthSummary
  // -------------------------------------------------------------------------
  describe("AccountReportingService", () => {
    it("getNetWorthSummary throws MISSING_FX_RATE when an account's rate is absent", async () => {
      const { getLatestFxRates } = await import("../../core/calculations");
      vi.mocked(getLatestFxRates).mockResolvedValue(EMPTY_RATES); // USD missing

      mockHouseholdRepository.findById.mockResolvedValue({ currency: "ZMW" });
      mockAccountRepository.getBalancesForNetWorth.mockResolvedValue([
        { balance: "1000", isAsset: true, currency: "USD" },
      ]);

      const { AccountReportingService } = await import(
        "../account/AccountReportingService"
      );
      const service = new AccountReportingService();

      await expect(
        service.getNetWorthSummary("house-1", "user-1"),
      ).rejects.toThrow(CalculationError);
    });
  });

  // -------------------------------------------------------------------------
  // SnapshotWorker.processHousehold
  // -------------------------------------------------------------------------
  describe("SnapshotWorker", () => {
    it("processHousehold throws MISSING_FX_RATE when an account's rate is absent", async () => {
      const { getLatestFxRates } = await import("../../core/calculations");
      vi.mocked(getLatestFxRates).mockResolvedValue(EMPTY_RATES); // USD missing

      // 1st select -> accounts (one USD account); 2nd select -> household currency
      mockDb.select
        .mockReturnValueOnce(
          createSelectQuery([
            {
              id: "acc-1",
              type: "checking",
              balance: "1000",
              estimatedValue: null,
              isHidden: false,
              currency: "USD",
            },
          ]),
        )
        .mockReturnValueOnce(createSelectQuery([{ currency: "ZMW" }]));

      const { snapshotWorker } = await import("../../jobs/snapshotWorker");

      await expect(
        snapshotWorker.processHousehold("house-1"),
      ).rejects.toThrow(CalculationError);
    });
  });
});
