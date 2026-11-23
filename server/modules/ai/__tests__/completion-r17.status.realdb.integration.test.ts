/**
 * R17 slice 2 (17e, AI-14): GET /api/ai/status reports real health, not
 * configuration alone. Health comes from the durable attempt ledger for the
 * CONFIGURED model; each test uses its own model ids so parallel suites in the
 * same database cannot colour the result. Quota comes from the same ledger as
 * chat admission, so status and chat headers agree.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiAttempts, aiRequests } from "@shared/schema";
import { db } from "../../../db";
import type { ProviderFailureCategory } from "../ai.provider.types";
import {
  seedConsumedRequests,
  startR17Harness,
  stopR17Harness,
  stubProviders,
  type R17Harness,
} from "./completion-r17.realdb.fixture";

let harness: R17Harness;
let claudeModel: string;
let geminiModel: string;

function configure(options: { claude?: boolean; gemini?: boolean } = {}) {
  const providers = stubProviders(options);
  claudeModel = `status-claude-${randomUUID()}`;
  geminiModel = `status-gemini-${randomUUID()}`;
  if (options.claude ?? true) providers.claude.configuredModel.mockReturnValue(claudeModel);
  if (options.gemini ?? true) providers.gemini.configuredModel.mockReturnValue(geminiModel);
  return providers;
}

async function recordAttempt(
  provider: "anthropic" | "gemini",
  status: "succeeded" | "failed" | "usage_unknown",
  failureCategory: ProviderFailureCategory | null,
  minutesAgo = 1,
) {
  const at = new Date(Date.now() - minutesAgo * 60 * 1000);
  const [row] = await db
    .insert(aiRequests)
    .values({
      householdId: harness.fixture.householdId,
      actorId: harness.fixture.owner.id,
      clientRequestKey: `status-${randomUUID()}`,
      fingerprint: "0".repeat(64),
      consentVersion: "v2.0",
      status: "completed",
      chatQuotaState: "refunded",
      createdAt: at,
      completedAt: at,
    })
    .returning({ id: aiRequests.id });
  await db.insert(aiAttempts).values({
    requestId: row.id,
    stage: "analysis",
    ordinal: 1,
    provider,
    model: provider === "anthropic" ? claudeModel : geminiModel,
    status,
    failureCategory,
    usageKnown: status === "succeeded",
    deadlineAt: at,
    dispatchedAt: at,
    completedAt: at,
  });
}

async function status() {
  const res = await request(harness.app).get("/api/ai/status").set("Cookie", harness.fixture.owner.cookie).expect(200);
  return res.body;
}

function provider(body: { providers: Array<{ provider: string }> }, id: string) {
  return body.providers.find((entry) => entry.provider === id);
}

describe("R17 status reports real health (real Postgres)", () => {
  beforeEach(async () => {
    harness = await startR17Harness();
  });

  afterEach(async () => {
    await stopR17Harness(harness);
  });

  it("nothing configured: unconfigured, local mode only, never a primary-health claim", async () => {
    configure({ claude: false, gemini: false });

    const body = await status();

    expect(body).toMatchObject({ available: true, degraded: true, state: "unconfigured", quotaLimited: false });
    expect(provider(body, "anthropic")).toMatchObject({ role: "primary", configured: false, health: "unconfigured", model: null });
    expect(provider(body, "gemini")).toMatchObject({ role: "fallback", configured: false, health: "unconfigured" });
  });

  it("configured with no recorded attempt is unverified, not healthy", async () => {
    configure();

    const body = await status();

    expect(body).toMatchObject({ state: "operational", degraded: false });
    expect(provider(body, "anthropic")).toMatchObject({ configured: true, health: "unverified", model: claudeModel });
  });

  it("a recent successful attempt on the configured model is healthy", async () => {
    configure();
    await recordAttempt("anthropic", "succeeded", null);

    expect(provider(await status(), "anthropic")).toMatchObject({ health: "healthy" });
  });

  it("primary configured but failing: configured-but-unhealthy, fallback operating", async () => {
    configure();
    await recordAttempt("anthropic", "failed", "authentication");

    const body = await status();

    expect(body).toMatchObject({ state: "degraded", degraded: true });
    expect(provider(body, "anthropic")).toMatchObject({ configured: true, health: "unhealthy", lastFailureCategory: "authentication" });
    expect(provider(body, "gemini")).toMatchObject({ health: "unverified" });
  });

  it("a keyed provider without a call cap is reported unconfigured, with the reason", async () => {
    configure();
    vi.stubEnv("AI_ANTHROPIC_DAILY_CALL_CAP", "");
    try {
      const body = await status();
      expect(provider(body, "anthropic")).toMatchObject({ configured: false, health: "unconfigured", unavailableReason: "no_cap" });
      expect(provider(body, "gemini")).toMatchObject({ configured: true, unavailableReason: null });
      expect(body).toMatchObject({ state: "degraded" });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("a primary at its call cap is reported cap_reached, and the state is an outage: chat never falls back past a reached cap", async () => {
    configure();
    vi.stubEnv("AI_ANTHROPIC_DAILY_CALL_CAP", "1");
    try {
      await recordAttempt("anthropic", "succeeded", null);
      const body = await status();
      expect(provider(body, "anthropic")).toMatchObject({ configured: true, unavailableReason: "cap_reached" });
      expect(provider(body, "gemini")).toMatchObject({ configured: true, unavailableReason: null });
      // Astra #255 r4: the state follows the dispatch rule (a reached cap is final).
      expect(body).toMatchObject({ state: "outage" });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("primary unconfigured with a configured fallback is degraded", async () => {
    configure({ claude: false });

    expect(await status()).toMatchObject({ state: "degraded", degraded: true });
  });

  it("both configured providers failing is an outage", async () => {
    configure();
    await recordAttempt("anthropic", "usage_unknown", "timeout");
    await recordAttempt("gemini", "failed", "server_error");

    expect(await status()).toMatchObject({ state: "outage", degraded: true, available: true });
  });

  it("cancellations, refusals and invalid requests do not poison provider health", async () => {
    configure();
    await recordAttempt("anthropic", "succeeded", null, 5);
    await recordAttempt("anthropic", "failed", "safety_refusal", 2);
    await recordAttempt("anthropic", "failed", "cancelled", 1);

    expect(provider(await status(), "anthropic")).toMatchObject({ health: "healthy" });
  });

  it("failures older than the health window no longer count", async () => {
    configure();
    await recordAttempt("anthropic", "failed", "overloaded", 60);

    expect(provider(await status(), "anthropic")).toMatchObject({ health: "unverified" });
  });

  it("an attempt for a different model id does not describe the configured model", async () => {
    configure();
    await recordAttempt("anthropic", "failed", "authentication");
    configure();

    expect(provider(await status(), "anthropic")).toMatchObject({ health: "unverified" });
  });

  it("reports quota-limited from the same ledger chat admission uses", async () => {
    configure();
    await seedConsumedRequests(harness.fixture.householdId, harness.fixture.member.id, 50);

    const body = await status();

    expect(body).toMatchObject({ quotaLimited: true, rateLimit: { remaining: 0, isLimited: true } });
    expect(new Date(body.rateLimit.resetTime).getTime()).toBeGreaterThan(Date.now());
  });
});
