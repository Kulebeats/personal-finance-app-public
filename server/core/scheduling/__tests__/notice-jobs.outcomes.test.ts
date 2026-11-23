/** R6-03: the installed market runners call only FX and the custody-guarded stale reminder. */
import { describe, expect, it, vi } from "vitest";

const market = vi.hoisted(() => ({
  updateFXRates: vi.fn(async () => ({ success: true })),
  updateSecurityPrices: vi.fn(),
}));
const alerts = vi.hoisted(() => ({
  checkPriceAlerts: vi.fn(),
  checkStalePrices: vi.fn(async () => ({ triggered: 2 })),
}));
vi.mock("../../../services/MarketDataService", () => ({ marketDataService: market }));
vi.mock("../../../services/PriceAlertService", () => ({ priceAlertService: alerts }));
vi.mock("../../../db", () => ({ db: {}, pool: {} }));
vi.mock("../../../utils/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { SCHEDULED_JOBS } from "../jobRegistry";
import { runScheduledJob, type JobRunDependencies } from "../scheduledJob";

describe("installed market jobs", () => {
  it("journals the guarded stale reminder in its own UTC slot and keeps automatic FX independent", async () => {
    const jobs = SCHEDULED_JOBS.filter(job => job.name.startsWith("market."));
    expect(jobs.map(job => job.name)).toEqual(["market.fx-refresh", "market.stale-price-alerts"]);
    const [fx, stale] = jobs;
    expect(fx).toMatchObject({ cron: "30 0 * * *", lockKey: 101, intervalMs: 86_400_000 });
    expect(stale).toMatchObject({ cron: "55 0 * * *", lockKey: 118, intervalMs: 86_400_000 });

    const startRun = vi.fn<JobRunDependencies["startRun"]>().mockResolvedValue("synthetic-run");
    const finishRun = vi.fn<JobRunDependencies["finishRun"]>().mockResolvedValue(undefined);
    const deps: JobRunDependencies = {
      withLock: async (_request, work) => ({ acquired: true, result: await work({ isLost: () => false, onRenewed: () => {} }) }),
      hasCompletedPeriod: async () => false,
      startRun,
      renewRun: async () => {},
      finishRun,
    };

    const outcome = await runScheduledJob(stale, deps, new Date("2026-11-22T00:55:01.000Z"));
    expect(outcome).toEqual({ status: "completed", summary: { triggered: 2 } });
    expect(alerts.checkStalePrices).toHaveBeenCalledExactlyOnceWith();
    expect(market.updateFXRates).not.toHaveBeenCalled();
    expect(startRun).toHaveBeenCalledWith(stale.name, {
      identity: "market.stale-price-alerts@2026-11-22T00:55:00.000Z",
      scheduledFor: new Date("2026-11-22T00:55:00.000Z"),
    });
    expect(finishRun).toHaveBeenCalledWith("synthetic-run", { isOk: true, errorCode: null, summary: { triggered: 2 } });

    expect(await runScheduledJob(fx, deps, new Date("2026-11-22T00:30:01.000Z")))
      .toEqual({ status: "completed", summary: { refreshed: 1, failed: 0 } });
    expect(market.updateFXRates).toHaveBeenCalledExactlyOnceWith();
    expect(alerts.checkStalePrices).toHaveBeenCalledTimes(1);
    expect(market.updateSecurityPrices).not.toHaveBeenCalled();
    expect(alerts.checkPriceAlerts).not.toHaveBeenCalled();
  });
});
