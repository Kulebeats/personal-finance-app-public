import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Money } from "../../../core/money";
import type { QueryContext, ToolResult } from "../ai.types";

const state = vi.hoisted(() => ({
  remote: new Map<string, unknown>(),
  redisGetJson: vi.fn<(key: string) => Promise<unknown>>(),
  redisSetJson: vi.fn<(key: string, value: unknown, ttl: number) => Promise<void>>(),
  redisDeleteByPrefix: vi.fn(async () => 0),
}));

vi.mock("../../../config/redis", () => ({
  productionRedis: null,
  redisGetJson: state.redisGetJson,
  redisSetJson: state.redisSetJson,
  redisDeleteByPrefix: state.redisDeleteByPrefix,
}));
vi.mock("../../../db", () => ({ db: {} }));

import { AICache, aiCache } from "../ai.cache";
import { AIAnalyticsService } from "../ai.analytics.service";
import { AIService } from "../ai.service";

interface ToolExecutor {
  executeToolWithArgs(
    name: string,
    args: Record<string, unknown>,
    context: QueryContext,
  ): Promise<ToolResult>;
}

const context: QueryContext = {
  householdId: "c308-household",
  userId: "c308-current-member",
  currency: "ZMW",
};
const toolName = "get_spending_by_category";
const args = { period: "30d" };
const legacyOwnerResult = {
  categories: [{ name: "Groceries", amount: "788.88", count: 2 }],
  total: "788.88",
  period: "last_period",
};

function rawSpending(amount: string) {
  return [{
    category: "Groceries",
    amount: Money.from(amount, "ZMW"),
    transactionCount: 2,
    percentOfTotal: 100,
  }];
}

function execute(service: AIService) {
  return (service as unknown as ToolExecutor).executeToolWithArgs(toolName, args, context);
}

describe("C3-08 service admission ignores legacy L1/L2 tool results", () => {
  beforeEach(() => {
    aiCache.clear();
    state.remote.clear();
    state.redisGetJson.mockReset();
    state.redisSetJson.mockReset();
    state.redisGetJson.mockImplementation(async key => state.remote.get(key) ?? null);
    state.redisSetJson.mockImplementation(async (key, value) => {
      state.remote.set(key, value);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    aiCache.clear();
    state.remote.clear();
  });

  it("does not read a legacy owner result already present in the current instance's L1", async () => {
    const key = aiCache.generateKey(context, toolName, args);
    aiCache.set(key, legacyOwnerResult);
    expect(aiCache.getStats().size).toBe(1);
    const cacheGet = vi.spyOn(aiCache, "getAsync");
    const cacheSet = vi.spyOn(aiCache, "setAsync");
    const reader = vi.spyOn(AIAnalyticsService.prototype, "getSpendingByCategory")
      .mockResolvedValue(rawSpending("233.33"));

    const result = await execute(new AIService());

    expect(result).toMatchObject({ success: true, sanitized: true, data: { total: "233.33" } });
    expect(reader).toHaveBeenCalledOnce();
    expect(reader).toHaveBeenCalledWith(context, "30d");
    expect(cacheGet).not.toHaveBeenCalled();
    expect(cacheSet).not.toHaveBeenCalled();
    expect(state.redisGetJson).not.toHaveBeenCalled();
    expect(state.redisSetJson).not.toHaveBeenCalled();
    expect(aiCache.getStats().size).toBe(1);
  });

  it("uses the current reader when another instance left an owner result in L2 and L1 is cold", async () => {
    const legacyWriter = new AICache();
    const key = legacyWriter.generateKey(context, toolName, args);
    try {
      await legacyWriter.setAsync(key, legacyOwnerResult);
      expect(state.remote.get(key)).toEqual(legacyOwnerResult);
      expect(aiCache.getStats().size).toBe(0);
      state.redisGetJson.mockClear();
      state.redisSetJson.mockClear();
      const cacheGet = vi.spyOn(aiCache, "getAsync");
      const cacheSet = vi.spyOn(aiCache, "setAsync");
      const reader = vi.spyOn(AIAnalyticsService.prototype, "getSpendingByCategory")
        .mockResolvedValue(rawSpending("233.33"));

      const result = await execute(new AIService());

      expect(result).toMatchObject({
        success: true,
        sanitized: true,
        data: { total: "233.33" },
      });
      expect(reader).toHaveBeenCalledOnce();
      expect(reader).toHaveBeenCalledWith(context, "30d");
      expect(cacheGet).not.toHaveBeenCalled();
      expect(cacheSet).not.toHaveBeenCalled();
      expect(state.redisGetJson).not.toHaveBeenCalled();
      expect(state.redisSetJson).not.toHaveBeenCalled();
      expect(state.remote.get(key)).toEqual(legacyOwnerResult);
      expect(aiCache.getStats().size).toBe(0);
    } finally {
      legacyWriter.stop();
    }
  });

  it("does not read or refill caches when a pending legacy write arrives between fresh tool calls", async () => {
    const legacyWriter = new AICache();
    const key = legacyWriter.generateKey(context, toolName, args);
    let releaseWrite: () => void = () => {
      throw new Error("Legacy write has not started");
    };
    state.redisSetJson.mockImplementationOnce((writeKey, value) => new Promise<void>(resolve => {
      releaseWrite = () => {
        state.remote.set(writeKey, value);
        resolve();
      };
    }));
    const pendingWrite = legacyWriter.setAsync(key, legacyOwnerResult);
    state.redisSetJson.mockClear();
    const cacheGet = vi.spyOn(aiCache, "getAsync");
    const cacheSet = vi.spyOn(aiCache, "setAsync");
    const reader = vi.spyOn(AIAnalyticsService.prototype, "getSpendingByCategory")
      .mockResolvedValueOnce(rawSpending("233.33"))
      .mockResolvedValueOnce(rawSpending("222.22"));
    const service = new AIService();

    try {
      const first = await execute(service);
      expect(first).toMatchObject({ success: true, sanitized: true, data: { total: "233.33" } });
      expect(state.remote.has(key)).toBe(false);
      releaseWrite();
      await pendingWrite;
      expect(state.remote.get(key)).toEqual(legacyOwnerResult);

      const second = await execute(service);

      expect(second).toMatchObject({ success: true, sanitized: true, data: { total: "222.22" } });
      expect(reader).toHaveBeenCalledTimes(2);
      expect(cacheGet).not.toHaveBeenCalled();
      expect(cacheSet).not.toHaveBeenCalled();
      expect(state.redisGetJson).not.toHaveBeenCalled();
      expect(state.redisSetJson).not.toHaveBeenCalled();
      expect(aiCache.getStats().size).toBe(0);
    } finally {
      releaseWrite();
      await pendingWrite;
      legacyWriter.stop();
    }
  });
});
