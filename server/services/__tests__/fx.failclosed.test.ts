/**
 * SCP-321 follow-up: FX conversion must FAIL CLOSED on a missing rate in the
 * snapshot worker, account-reporting, FX-attribution, and portfolio-valuation
 * services. A missing rate must throw CalculationError("MISSING_FX_RATE"), never
 * silently default to rate=1 (which corrupts multi-currency totals).
 *
 * These are fast unit tests that stub the FX repository boundary plus
 * the minimal DB/repository surface each service touches.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { CalculationError } from "../../core/calculations/errors";
import { accountWorthCaptures, accounts, households } from "@shared/schema";
import { createAccountSummarySqlFixture } from "./accountSummarySql.fixture";

// --- Shared mocks -----------------------------------------------------------

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  transaction: vi.fn(),
  execute: vi.fn(),
  query: {
    holdings: {
      findMany: vi.fn(),
    },
  },
};
const redisState = vi.hoisted(() => ({ productionRedis: null as null | { assertCurrent: () => void } }));

vi.mock("../../db", () => ({ db: mockDb }));

vi.mock("../../core/calculations", () => ({
  getLatestFxRates: vi.fn(),
}));

vi.mock("../../config/redis", () => ({ redis: null, get productionRedis() { return redisState.productionRedis; } }));

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
    orderBy: vi.fn(() => builder),
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
    redisState.productionRedis = null;
  });

  // -------------------------------------------------------------------------
  // PortfolioValuationService.computeHoldingMetrics (pure, no DB)
  // -------------------------------------------------------------------------
  describe("PortfolioValuationService", () => {
    it("keeps current ZMW value when historical basis is unknown and withholds incomplete portfolio returns", async () => {
      const { portfolioValuationService } = await import("../PortfolioValuationService");
      const foreign = { id: "usd", householdId: "house", accountId: "account", securityId: "security",
        quantity: "5", costBasis: "10.00", costBasisZmw: null, acquisitionFxRate: null, acquiredDate: "2020-01-01" };
      const security = { id: "security", currency: "USD", type: "stock" as const, currentPrice: "3" };
      const rates = new Map([["USD", "25"]]);
      const unknown = portfolioValuationService.computeHoldingMetrics(foreign, security, "ZMW", rates);
      expect(unknown.currentValueBase).toMatchObject({ currency: "ZMW" });
      expect(unknown.currentValueBase.toString()).toBe("375.00");
      expect(unknown.currentValueLocal.toString()).toBe("15.00");
      expect(unknown).toMatchObject({ fxRateUsed: 25, costBasisBase: null, gainLoss: null, gainLossPercent: null });

      const known = { ...foreign, id: "known", costBasisZmw: "200.00" };
      const mixed = await portfolioValuationService.getHouseholdInvestmentValue("house", "ZMW", {
        database: mockDb as never, getLatestFxRates: async () => rates,
        source: { holdings: [known, foreign].map(holding => ({ holding, security })), bills: [], pensions: [] },
      });
      expect(mixed.totalValue.toString()).toBe("750.00");
      expect(mixed.byType.stock.toString()).toBe("750.00");
      expect(mixed).toMatchObject({ totalCostBasis: null, totalGainLoss: null, totalGainLossPercent: null, holdingsCount: 2 });
    });

    it("preserves the stored ZMW basis or a proven acquisition rate and native USD cost", async () => {
      const { portfolioValuationService } = await import("../PortfolioValuationService");
      const holding = { id: "usd", householdId: "house", accountId: "account", securityId: "security",
        quantity: "5", costBasis: "10.00", costBasisZmw: null, acquisitionFxRate: "20", acquiredDate: "2020-01-01" };
      const security = { id: "security", currency: "USD", type: "stock" as const, currentPrice: "3" };
      const rates = new Map([["USD", 25]]);
      expect(portfolioValuationService.computeHoldingMetrics(holding, security, "ZMW", rates).costBasisBase).toBeNull();
      const proven = { ...holding, verifiedOpeningRate: true };
      expect(portfolioValuationService.computeHoldingMetrics(proven, security, "ZMW", rates).costBasisBase?.toString()).toBe("200.00");
      const stored = portfolioValuationService.computeHoldingMetrics({ ...holding, costBasisZmw: "210.00" }, security, "ZMW", rates);
      expect(stored.costBasisBase?.toString()).toBe("210.00");
      expect(stored.gainLoss?.toString()).toBe("165.00");
      const undated = portfolioValuationService.computeHoldingMetrics({ ...holding, acquiredDate: null }, security, "ZMW", rates);
      expect(undated.costBasisBase).toBeNull();
      expect(portfolioValuationService.computeHoldingMetrics({ ...proven, acquisitionFxRate: "0" }, security, "ZMW", rates).costBasisBase).toBeNull();
      const rounded = portfolioValuationService.computeHoldingMetrics({ ...holding, quantity: "1", costBasis: "0.00", acquisitionFxRate: null }, security, "ZMW", rates);
      expect(rounded).toMatchObject({ costBasisBase: null, gainLoss: null, gainLossPercent: null });
      const native = portfolioValuationService.computeHoldingMetrics({ ...holding, acquisitionFxRate: null }, security, "USD", EMPTY_RATES);
      expect(native.costBasisBase?.toString()).toBe("10.00");
      expect(native.costBasisBase?.currency).toBe("USD");
      expect(native.gainLoss?.toString()).toBe("5.00");
    });

    it("does not make a portfolio's return unavailable because it includes an empty foreign shell", async () => {
      const { portfolioValuationService } = await import("../PortfolioValuationService");
      const holding = { id: "usd", householdId: "house", accountId: "account", securityId: "security",
        quantity: "0", costBasis: null, costBasisZmw: null, acquisitionFxRate: null, acquiredDate: "2020-01-01" };
      const foreign = { id: "security", currency: "USD", type: "stock" as const, currentPrice: "3" };
      const native = { id: "native", currency: "ZMW", type: "stock" as const, currentPrice: "5" };
      const result = await portfolioValuationService.getHouseholdInvestmentValue("house", "ZMW", {
        database: mockDb as never, getLatestFxRates: async () => new Map([["USD", 25]]),
        source: { holdings: [{ holding, security: foreign },
          { holding: { ...holding, id: "other", securityId: native.id, quantity: "10", costBasis: "40" }, security: native }], bills: [], pensions: [] },
      });
      expect(result.totalValue.toString()).toBe("50.00");
      expect(result.totalCostBasis?.toString()).toBe("40.00");
      expect(result.totalGainLoss?.toString()).toBe("10.00");
    });

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
      expect(metrics.currentValueBase.amount.toString()).toBe("1000");
      expect(metrics.currentValueBase.currency).toBe("ZMW");
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
  // AccountReportingService.getNetWorthSummary
  // -------------------------------------------------------------------------
  describe("AccountReportingService", () => {
    it("getNetWorthSummary throws MISSING_FX_RATE when an account's rate is absent", async () => {
      const { getLatestFxRates } = await import("../../core/calculations");
      const fixture = createAccountSummarySqlFixture([
        { id: "acc-1", balance: "1000", isAsset: true, type: "checking", currency: "USD" },
      ]); // Real transaction-bound trusted quote repository finds no USD->ZMW row.
      mockDb.transaction.mockImplementation(fixture.transaction);
      mockDb.execute.mockImplementation(fixture.publication);

      const { AccountReportingService } = await import(
        "../account/AccountReportingService"
      );
      const service = new AccountReportingService();

      const attempt = service.getNetWorthSummary("house-1", "user-1");
      await expect(attempt).rejects.toBeInstanceOf(CalculationError);
      await expect(attempt).rejects.toMatchObject({ code: "MISSING_FX_RATE" });
      expect(mockDb.transaction).toHaveBeenCalledOnce();
      expect(fixture.publication).toHaveBeenCalledOnce(); // One fresh final SQL cut.
      expect(fixture.tx.selectDistinctOn).toHaveBeenCalledOnce();
      expect(getLatestFxRates).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // SnapshotWorker.processHousehold
  // -------------------------------------------------------------------------
  describe("SnapshotWorker", () => {
    it("refuses to run snapshots until the admitted profile has a lock contract", async () => {
      redisState.productionRedis = { assertCurrent: vi.fn() };
      mockDb.select.mockReturnValue(createSelectQuery([]));
      const { snapshotWorker } = await import("../../jobs/snapshotWorker");

      await expect(snapshotWorker.processAll()).rejects.toThrow("REDIS_PROFILE_SNAPSHOT_LOCK_UNAVAILABLE");
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it("processHousehold throws MISSING_FX_RATE when an account's rate is absent", async () => {
      const { getLatestFxRates } = await import("../../core/calculations");
      // Exercise the real worker and real transaction-bound FX factory. Only
      // its SQL surface is stubbed; the global singleton is not this caller.
      const observedAt = new Date().toISOString(), date = observedAt.slice(0, 10);
      const native = { accountId: "acc-1", accountType: "checking", sourceAmount: "1000", sourceCurrency: "USD",
        excluded: false, hidden: false, archived: false, deleted: false, investments: { holdings: 0, tbills: 0, pensions: 0, bonds: 0 } };
      mockDb.execute.mockResolvedValue({ rows: [{ date }] });
      let payload: { evidence?: unknown } = {};
      const insert = { values: vi.fn((value: typeof payload) => { payload = value; return insert; }),
        onConflictDoUpdate: vi.fn(() => insert), returning: vi.fn(async () => [{ evidence: payload.evidence }]) };
      const clear = { set: vi.fn(() => clear), where: vi.fn().mockResolvedValue(undefined) };
      const captureDb = {
        execute: vi.fn().mockResolvedValue({ rows: [{ householdId: "house-1", date, capturedAt: observedAt, currency: "ZMW", accounts: [native] }] }),
        insert: vi.fn(() => insert), update: vi.fn(() => clear),
        select: vi.fn(() => ({ from: (table: unknown) => createSelectQuery(
          table === accounts ? [{ id: "acc-1", type: "checking", balance: "1000", estimatedValue: null,
            isHidden: false, isArchived: false, deletedAt: null, excluded: false, currency: "USD" }]
            : table === households ? [{ currency: "ZMW" }] : [{ count: 0 }],
        ) })),
        // Successful real repository lookups (household rate, then shared) find no USD->ZMW row.
        selectDistinctOn: vi.fn(() => createSelectQuery([])),
      };
      mockDb.transaction.mockImplementationOnce(async (operation: (tx: typeof captureDb) => Promise<unknown>) => operation(captureDb));

      const { snapshotWorker } = await import("../../jobs/snapshotWorker");

      const attempt = snapshotWorker.processHousehold("house-1");
      await expect(attempt).rejects.toBeInstanceOf(CalculationError);
      await expect(attempt).rejects.toMatchObject({ code: "MISSING_FX_RATE" });
      expect(mockDb.transaction).toHaveBeenCalledOnce();
      expect(captureDb.selectDistinctOn).toHaveBeenCalledTimes(2);
      expect(captureDb.insert).toHaveBeenCalledExactlyOnceWith(accountWorthCaptures);
      expect(insert.values).toHaveBeenCalledWith(expect.objectContaining({ currency: "ZMW", evidence: expect.objectContaining({ accounts: [native] }) }));
      expect(captureDb.update).not.toHaveBeenCalled(); // Preserve every field of any prior global receipt.
      expect(getLatestFxRates).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });
});
