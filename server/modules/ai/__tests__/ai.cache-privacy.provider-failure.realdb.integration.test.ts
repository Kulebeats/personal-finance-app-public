import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { AIAnalyticsService } from "../ai.analytics.service";
import { aiCache } from "../ai.cache";
import { geminiClient } from "../ai.gemini";
import { AIErrorCode } from "../ai.types";
import {
  cleanCachePrivacyFixture,
  createCachePrivacyFixture,
  password,
  seedCachePrivacyFixture,
  type CachePrivacyFixture,
} from "./ai.cache-privacy.fixture";

let app: Awaited<ReturnType<typeof getTestApp>>;
let fixture: CachePrivacyFixture;
let passwordHash: string;
const toolName = "get_spending_by_category";

describe("C3-08 signed provider-failure fallback preserves the current member's private spending", () => {
  beforeAll(async () => {
    app = await getTestApp();
    passwordHash = await hashPassword(password);
  });

  beforeEach(async () => {
    fixture = createCachePrivacyFixture();
    await seedCachePrivacyFixture(fixture, app, passwordHash);
    vi.spyOn(geminiClient, "isAvailable").mockReturnValue(true);
    vi.spyOn(geminiClient, "analyzeQuery").mockResolvedValue({
      toolCalls: [{ name: toolName, args: {} }],
      tokenCount: 1,
    });
    vi.spyOn(geminiClient, "generateResponse").mockImplementation(async (_message, results) => ({
      response: JSON.stringify(results),
      tokenCount: 1,
    }));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (fixture) {
      aiCache.invalidateHousehold(fixture.householdId);
      aiCache.invalidateHousehold(fixture.foreignHouseholdId);
      await cleanCachePrivacyFixture(fixture);
    }
  });

  it.each(["analysis", "answer"] as const)("uses member data after an owner warm-up and provider %s failure", async stage => {
    const warm = await request(app)
      .post("/api/ai/chat")
      .set("Cookie", fixture.owner.cookie)
      .send({ message: "How much did I spend?" })
      .expect(200);
    expect(warm.body.reply).toContain("788.88");
    const reader = vi.spyOn(AIAnalyticsService.prototype, "getSpendingByCategory");
    vi.mocked(geminiClient.analyzeQuery).mockClear();
    vi.mocked(geminiClient.generateResponse).mockClear();
    const failure = Object.assign(new Error("Synthetic provider unavailable"), {
      code: AIErrorCode.EXTERNAL_API_ERROR,
      retryable: true,
    });
    if (stage === "analysis") {
      vi.mocked(geminiClient.analyzeQuery).mockRejectedValueOnce(failure);
    } else {
      vi.mocked(geminiClient.generateResponse).mockRejectedValueOnce(failure);
    }

    const response = await request(app)
      .post("/api/ai/chat")
      .set("Cookie", fixture.member.cookie)
      .send({ message: "How much did I spend?" })
      .expect(200);

    expect(response.body.toolsUsed).toEqual([toolName]);
    expect(response.body.reply).toContain("233.33");
    expect(response.body.reply).not.toContain("788.88");
    expect(reader.mock.calls.every(([context]) => context.userId === fixture.member.id)).toBe(true);
    // R17: an answer-stage failure reuses the already-sanitised results for the
    // local summary instead of re-running the tools, so the reader runs once.
    expect(reader).toHaveBeenCalledTimes(1);
    expect(response.body.answerMode).toBe("local");
    expect(geminiClient.analyzeQuery).toHaveBeenCalledOnce();
    if (stage === "analysis") {
      expect(geminiClient.generateResponse).not.toHaveBeenCalled();
    } else {
      expect(geminiClient.generateResponse).toHaveBeenCalledOnce();
      const transmitted = JSON.stringify(vi.mocked(geminiClient.generateResponse).mock.calls[0][1]);
      expect(transmitted).toContain("233.33");
      expect(transmitted).not.toContain("788.88");
    }
  });
});
