import { afterEach, describe, expect, it, vi } from "vitest";
import { Money } from "../../../core/money";

const state = vi.hoisted(() => ({
  assertCurrent: vi.fn(),
  redisGetJson: vi.fn(async () => { throw new Error("REDIS_OPERATION_REFUSED"); }),
  redisSetJson: vi.fn(async () => { throw new Error("REDIS_OPERATION_REFUSED"); }),
  redisDeleteByPrefix: vi.fn(async () => { throw new Error("REDIS_OPERATION_REFUSED"); }),
}));

vi.mock("../../../config/redis", () => ({
  productionRedis: { assertCurrent: state.assertCurrent },
  redisGetJson: state.redisGetJson,
  redisSetJson: state.redisSetJson,
  redisDeleteByPrefix: state.redisDeleteByPrefix,
}));
vi.mock("../ai.tracking", () => ({
  aiTracking: {
    trackPromptInjectionBlocked: vi.fn(),
    trackQueryFailed: vi.fn(),
    trackQuerySent: vi.fn(),
    trackQuerySuccess: vi.fn(),
  },
}));
vi.mock("../../../db", () => ({ db: {} }));

afterEach(() => {
  vi.clearAllMocks();
});

describe("R20 admitted-profile AI tool execution without caching", () => {
  it("keeps direct cache reads, writes, and invalidations local-only under the profile", async () => {
    const { AICache } = await import("../ai.cache");
    const cache = new AICache();
    const key = cache.generateKey({ householdId: "household-1", userId: "user-1" }, "get_budget_status", { period: "30d" });

    cache.set(key, { stale: true });
    expect(cache.get(key)).toBeNull();
    await cache.setAsync(key, { stale: true });
    await expect(cache.getAsync(key)).resolves.toBeNull();
    expect(cache.invalidateHousehold("household-1")).toBe(0);
    expect(cache.invalidateTool("household-1", "get_budget_status")).toBe(0);
    expect(state.redisGetJson).not.toHaveBeenCalled();
    expect(state.redisSetJson).not.toHaveBeenCalled();
    expect(state.redisDeleteByPrefix).not.toHaveBeenCalled();
    cache.stop();
  });

  it("runs and sanitizes a cacheable tool without using the rejected ai namespace", async () => {
    const { AIService } = await import("../ai.service");
    const service = new AIService() as any;
    const fetchSpending = vi.fn(async () => [{
      category: "Groceries",
      amount: Money.from("25.00", "ZMW"),
      transactionCount: 3,
      percentOfTotal: 100,
    }]);
    service.analyticsService = { getSpendingByCategory: fetchSpending };

    const result = await service.executeToolWithArgs(
      "get_spending_by_category",
      { period: "30d" },
      { householdId: "household-1", userId: "viewer-1", currency: "ZMW" },
    );

    expect(result).toMatchObject({ success: true, sanitized: true });
    expect(fetchSpending).toHaveBeenCalledOnce();
    expect(state.assertCurrent).toHaveBeenCalled();
    expect(state.redisGetJson).not.toHaveBeenCalled();
    expect(state.redisSetJson).not.toHaveBeenCalled();
  });
});
