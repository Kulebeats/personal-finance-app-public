import { beforeEach, describe, expect, it, vi } from "vitest";

const redisMock = vi.hoisted(() => ({
  get: vi.fn(),
  setex: vi.fn(),
  scanStream: vi.fn(),
  pipeline: vi.fn(),
}));

vi.mock("../../config/redis", () => ({
  redis: redisMock,
  productionRedis: null,
}));

describe("AnalyticsCache", () => {
  beforeEach(() => {
    redisMock.get.mockReset();
    redisMock.setex.mockReset();
    redisMock.get.mockResolvedValue(null);
    redisMock.setex.mockResolvedValue("OK");
  });

  it("isolates cached report data by user, scope, and filters", async () => {
    const { AnalyticsCache } = await import("../AnalyticsCache");
    const cache = new AnalyticsCache();
    const compute = vi
      .fn()
      .mockResolvedValueOnce({ label: "user-1-household" })
      .mockResolvedValueOnce({ label: "user-1-mine" })
      .mockResolvedValueOnce({ label: "user-2-mine" })
      .mockResolvedValueOnce({ label: "user-1-mine-category" });

    await cache.getOrCompute(
      "spendingBreakdown",
      "household-1",
      {
        from: "2026-01-01",
        to: "2026-01-31",
        scope: "household",
        userId: "user-1",
      },
      compute,
    );

    await cache.getOrCompute(
      "spendingBreakdown",
      "household-1",
      {
        from: "2026-01-01",
        to: "2026-01-31",
        scope: "mine",
        userId: "user-1",
      },
      compute,
    );

    await cache.getOrCompute(
      "spendingBreakdown",
      "household-1",
      {
        from: "2026-01-01",
        to: "2026-01-31",
        scope: "mine",
        userId: "user-2",
      },
      compute,
    );

    await cache.getOrCompute(
      "spendingBreakdown",
      "household-1",
      {
        categoryId: "category-1",
        from: "2026-01-01",
        to: "2026-01-31",
        scope: "mine",
        userId: "user-1",
      },
      compute,
    );

    const keys = redisMock.setex.mock.calls.map(([key]) => String(key));

    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(4);
    expect(keys[0]).toContain("analytics:spendingBreakdown:household-1:user-1:v");
    expect(keys[1]).toContain("analytics:spendingBreakdown:household-1:user-1:v");
    expect(keys[2]).toContain("analytics:spendingBreakdown:household-1:user-2:v");
    expect(keys[3]).toContain("analytics:spendingBreakdown:household-1:user-1:v");
  });
});
