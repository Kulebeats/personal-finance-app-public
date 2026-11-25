import { describe, expect, it, vi } from "vitest";
import type { AnalyticsCacheBackend } from "../analytics-cache-backend";

vi.mock("../../config/redis", () => ({ redis: null, productionRedis: null }));
import { AnalyticsCache } from "../AnalyticsCache";

const liveReads = [
  { endpoint: "netWorth", params: { userId: "member" } },
  { endpoint: "netWorthChanges", params: { userId: "member" } },
  { endpoint: "financialRatios", params: { userId: "member" } },
  { endpoint: "debtAnalysis", params: { userId: "member" } },
  { endpoint: "budgetComparison", params: { userId: "member" } },
  { endpoint: "cashflow", params: { userId: "member", includeForecast: true } },
];
function binding(assertCurrent = () => {}) {
  return { assertCurrent, getJson: vi.fn(async () => null), setJson: vi.fn(async () => {}), invalidate: vi.fn(async () => 0) } satisfies AnalyticsCacheBackend;
}

describe("live ledger and budget analytics retain required binding fences", () => {
  for (const { endpoint, params } of liveReads) {
    it(`${endpoint} performs each current compute without reading or populating a stale cache`, async () => {
      const backend = binding(), cache = new AnalyticsCache(backend);
      const compute = vi.fn().mockResolvedValueOnce({ amount: "710.00" }).mockResolvedValueOnce({ amount: "183.33" });
      expect(await cache.getOrCompute(endpoint, "household", params, compute)).toMatchObject({ amount: "710.00" });
      expect(await cache.getOrCompute(endpoint, "household", params, compute)).toMatchObject({ amount: "183.33" });
      expect(compute).toHaveBeenCalledTimes(2); expect(backend.getJson).not.toHaveBeenCalled(); expect(backend.setJson).not.toHaveBeenCalled();
    });
    it(`${endpoint} rejects a refused required generation before computing`, async () => {
      const refusal = new Error("required generation refused"), backend = binding(() => { throw refusal; });
      const compute = vi.fn(async () => ({ amount: "710.00" }));
      await expect(new AnalyticsCache(backend).getOrCompute(endpoint, "household", params, compute)).rejects.toBe(refusal);
      expect(compute).not.toHaveBeenCalled(); expect(backend.getJson).not.toHaveBeenCalled();
    });
    it(`${endpoint} rejects old-generation success when required binding changes during compute`, async () => {
      const refusal = new Error("required generation revoked"); let live = true, release!: (value: { amount: string }) => void;
      const backend = binding(() => { if (!live) throw refusal; });
      const compute = vi.fn(() => new Promise<{ amount: string }>(resolve => { release = resolve; }));
      const pending = new AnalyticsCache(backend).getOrCompute(endpoint, "household", params, compute);
      expect(compute).toHaveBeenCalledOnce(); live = false; release({ amount: "710.00" });
      await expect(pending).rejects.toBe(refusal); expect(backend.getJson).not.toHaveBeenCalled(); expect(backend.setJson).not.toHaveBeenCalled();
    });
  }
  it("keeps actual-only cashflow on its existing cache contract", async () => {
    const backend: AnalyticsCacheBackend = { assertCurrent() {}, getJson: async <T>() => ({ data: { amount: "15.00" }, generatedAt: "2026-11-02T00:00:00Z" } as T),
      setJson: async () => {}, invalidate: async () => 0 };
    const compute = vi.fn(async () => ({ amount: "55.00" }));
    expect(await new AnalyticsCache(backend).getOrCompute("cashflow", "household", { userId: "member", includeForecast: false }, compute)).toMatchObject({ amount: "15.00" });
    expect(compute).not.toHaveBeenCalled();
  });
});
