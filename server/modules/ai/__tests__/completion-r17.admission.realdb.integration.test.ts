/**
 * R17 slice 2 (17c, AI-07 / AI-11 / AI-12): the durable admission ledger.
 *
 * Real HTTP against real Postgres. One logical request (household + actor +
 * client key + fingerprint) gets one admission, one chat-quota unit, one
 * persisted exchange and one claimed attempt per provider stage. Providers are
 * spies; no key is used and nothing leaves the process.
 */
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, count, eq, inArray } from "drizzle-orm";
import { aiAttempts, aiRequests, auditLogs } from "@shared/schema";
import { db } from "../../../db";
import { ProviderError } from "../ai.provider.types";
import { AIChatAdmissionService } from "../ai.chat-admission.service";
import { AIService } from "../ai.service";
import { readHouseholdConsent } from "../ai.consent-policy";
import { aiAdmissionRepository } from "../ai.admission.repository";
import {
  attemptsFor,
  chat,
  CLAUDE_ANSWER,
  delay,
  messagesIn,
  newKey,
  requestByKey,
  requestsFor,
  seedConsumedRequests,
  SPENDING_ANALYSIS,
  SPENDING_QUESTION,
  startR17Harness,
  stopR17Harness,
  stubProviders,
  type R17Harness,
} from "./completion-r17.realdb.fixture";

const LIMIT = 50;
let harness: R17Harness;

/** `used` dispatched Claude calls for `model` inside the cap window; returns their request id. */
async function seedUsedCalls(fixture: R17Harness["fixture"], model: string, used: number): Promise<string> {
  const now = new Date();
  const [seed] = await db
    .insert(aiRequests)
    .values({
      householdId: fixture.householdId,
      actorId: fixture.owner.id,
      clientRequestKey: newKey(),
      fingerprint: "0".repeat(64),
      consentVersion: "v2.0",
      // An open admission: only its owner may claim for it (Astra #255 r4).
      status: "in_progress",
      chatQuotaState: "reserved",
      createdAt: now,
    })
    .returning({ id: aiRequests.id });
  if (used > 0) {
    await db.insert(aiAttempts).values(
      Array.from({ length: used }, (_, index) => ({
        requestId: seed.id,
        stage: "analysis" as const,
        ordinal: index + 1,
        provider: "anthropic" as const,
        model,
        status: "succeeded" as const,
        usageKnown: true,
        deadlineAt: now,
        dispatchedAt: now,
        completedAt: now,
      })),
    );
  }
  return seed.id;
}

async function callsFor(model: string): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(aiAttempts)
    .where(and(eq(aiAttempts.provider, "anthropic"), eq(aiAttempts.model, model)));
  return value;
}

describe("R17 admission ledger (real Postgres)", () => {
  beforeEach(async () => {
    harness = await startR17Harness();
  });

  afterEach(async () => {
    await stopR17Harness(harness);
  });

  it("an identical replay returns the stored answer: one admission, one exchange, one unit, one dispatch", async () => {
    const { app, fixture } = harness;
    const providers = stubProviders();
    const key = newKey();

    const first = await chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: key }).expect(200);
    const replay = await chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: key }).expect(200);

    expect(first.body.answerMode).toBe("claude");
    expect(first.headers["ratelimit-limit"]).toBe(String(LIMIT));
    expect(first.headers["ratelimit-remaining"]).toBe(String(LIMIT - 1));
    expect(first.body.remainingQueries).toBe(LIMIT - 1);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.body.reply).toBe(first.body.reply);
    expect(replay.body.conversationId).toBe(first.body.conversationId);
    expect(replay.headers["ratelimit-remaining"]).toBe(String(LIMIT - 1));
    expect(providers.claude.analyzeQuery).toHaveBeenCalledTimes(1);
    expect(providers.claude.generateResponse).toHaveBeenCalledTimes(1);

    const rows = await requestsFor(fixture.householdId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "completed", chatQuotaState: "consumed", answerMode: "claude", actorId: fixture.owner.id });
    expect(await messagesIn(first.body.conversationId)).toHaveLength(2);
  });

  it("the same key with a different message is 409 and changes nothing", async () => {
    const { app, fixture } = harness;
    const providers = stubProviders();
    const key = newKey();
    await chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: key }).expect(200);

    const conflict = await chat(app, fixture.owner, { message: "What are my goals?", clientRequestKey: key }).expect(409);

    expect(conflict.body.error?.code).toBe("CONFLICT");
    expect(providers.claude.analyzeQuery).toHaveBeenCalledTimes(1);
    expect(await requestsFor(fixture.householdId)).toHaveLength(1);
  });

  it("the key is scoped to the actor: another member's identical key is a separate request", async () => {
    const { app, fixture } = harness;
    stubProviders();
    const key = newKey();
    await chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: key }).expect(200);
    const other = await chat(app, fixture.member, { message: SPENDING_QUESTION, clientRequestKey: key }).expect(200);

    expect(other.headers["idempotent-replayed"]).toBeUndefined();
    const rows = await requestsFor(fixture.householdId);
    expect(rows.map((row) => row.actorId).sort()).toEqual([fixture.owner.id, fixture.member.id].sort());
  });

  it("concurrent duplicates of one logical request dispatch once and persist one exchange", async () => {
    const { app, fixture } = harness;
    const providers = stubProviders();
    providers.claude.analyzeQuery.mockImplementation(async () => {
      await delay(300);
      return SPENDING_ANALYSIS;
    });
    const key = newKey();
    const body = { message: SPENDING_QUESTION, clientRequestKey: key };

    const responses = await Promise.all([chat(app, fixture.owner, body), chat(app, fixture.owner, body)]);

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(providers.claude.analyzeQuery).toHaveBeenCalledTimes(1);
    const rows = await requestsFor(fixture.householdId);
    expect(rows).toHaveLength(1);
    const answered = responses.find((response) => response.status === 200)!;
    expect(await messagesIn(answered.body.conversationId)).toHaveLength(2);
  });

  it("an unavailable outcome refunds the unit exactly once, including on replay", async () => {
    const { app, fixture } = harness;
    stubProviders({ claude: false, gemini: false });
    const key = newKey();

    const response = await chat(app, fixture.owner, { message: "Tell me a joke", clientRequestKey: key }).expect(200);
    await chat(app, fixture.owner, { message: "Tell me a joke", clientRequestKey: key }).expect(200);

    expect(response.body.answerMode).toBe("unavailable");
    expect(response.headers["ratelimit-remaining"]).toBe(String(LIMIT));
    expect(response.body.remainingQueries).toBe(LIMIT);
    const row = await requestByKey(fixture.householdId, key);
    expect(row).toMatchObject({ status: "completed", chatQuotaState: "refunded", answerMode: "unavailable" });
  });

  it("a useful local answer consumes one unit", async () => {
    const { app, fixture } = harness;
    stubProviders({ claude: false, gemini: false });

    const response = await chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: newKey() }).expect(200);

    expect(response.body.answerMode).toBe("local");
    expect(response.headers["ratelimit-remaining"]).toBe(String(LIMIT - 1));
    const [row] = await requestsFor(fixture.householdId);
    expect(row).toMatchObject({ chatQuotaState: "consumed", answerMode: "local" });
  });

  it("two distinct requests racing for the last unit: exactly one is admitted, the other is a self-describing 429", async () => {
    const { app, fixture } = harness;
    const providers = stubProviders();
    providers.claude.analyzeQuery.mockImplementation(async () => {
      await delay(200);
      return SPENDING_ANALYSIS;
    });
    await seedConsumedRequests(fixture.householdId, fixture.member.id, LIMIT - 1);

    const responses = await Promise.all([
      chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: newKey() }),
      chat(app, fixture.member, { message: SPENDING_QUESTION, clientRequestKey: newKey() }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 429]);
    const limited = responses.find((response) => response.status === 429)!;
    expect(limited.headers["ratelimit-limit"]).toBe(String(LIMIT));
    expect(limited.headers["ratelimit-remaining"]).toBe("0");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect(Number.isInteger(Number(limited.headers["retry-after"]))).toBe(true);
    expect(limited.headers["ratelimit-reset"]).toBe(limited.headers["retry-after"]);
    expect(limited.headers["x-ratelimit-remaining"]).toBeUndefined();
    expect(limited.body.error?.code).toBe("RATE_LIMIT_EXCEEDED");
    const counted = await db
      .select()
      .from(aiRequests)
      .where(and(eq(aiRequests.householdId, fixture.householdId), inArray(aiRequests.chatQuotaState, ["reserved", "consumed"])));
    expect(counted).toHaveLength(LIMIT);
  });

  it("units older than the 24-hour window do not count", async () => {
    const { app, fixture } = harness;
    stubProviders();
    await seedConsumedRequests(fixture.householdId, fixture.owner.id, LIMIT, new Date(Date.now() - 25 * 60 * 60 * 1000));

    const response = await chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: newKey() }).expect(200);

    expect(response.headers["ratelimit-remaining"]).toBe(String(LIMIT - 1));
  });

  it("claims each provider attempt before dispatch and settles it: a Claude timeout stays usage-unknown", async () => {
    const { app, fixture } = harness;
    const providers = stubProviders();
    providers.claude.analyzeQuery.mockRejectedValue(
      new ProviderError({ provider: "anthropic", category: "timeout", message: "synthetic timeout", dispatched: true }),
    );
    const key = newKey();

    const response = await chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: key }).expect(200);

    expect(response.body.answerMode).toBe("gemini");
    const row = await requestByKey(fixture.householdId, key);
    const attempts = await attemptsFor(row!.id);
    expect(attempts.map(({ ordinal, stage, provider, status, failureCategory }) => ({ ordinal, stage, provider, status, failureCategory }))).toEqual([
      { ordinal: 1, stage: "analysis", provider: "anthropic", status: "usage_unknown", failureCategory: "timeout" },
      { ordinal: 2, stage: "analysis", provider: "gemini", status: "succeeded", failureCategory: null },
      { ordinal: 3, stage: "answer", provider: "gemini", status: "succeeded", failureCategory: null },
    ]);
    expect(attempts[0].model).toBe("recorded-claude-model");
    expect(attempts.every((attempt) => attempt.deadlineAt instanceof Date)).toBe(true);

    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.householdId, fixture.householdId), eq(auditLogs.entityType, "ai_query")));
    expect(audit.details).toMatchObject({ logical_request_id: row!.id, consent_version: "v2.0", answer_mode: "gemini" });
  });

  it("an application error fails the request, refunds the unit once, and lets the same key be retried", async () => {
    const { app, fixture } = harness;
    const providers = stubProviders();
    providers.claude.analyzeQuery.mockRejectedValueOnce(new Error("synthetic application fault"));
    const key = newKey();

    await chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: key }).expect(500);
    const failed = await requestByKey(fixture.householdId, key);
    expect(failed).toMatchObject({ status: "failed", chatQuotaState: "refunded" });

    const retried = await chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: key }).expect(200);

    expect(retried.body.answerMode).toBe("claude");
    expect(retried.headers["ratelimit-remaining"]).toBe(String(LIMIT - 1));
    const rows = await requestsFor(fixture.householdId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "completed", chatQuotaState: "consumed" });
  });

  it("a client disconnect fails the request (no replay of the cancellation), refunds once, and the same key runs again", async () => {
    const { fixture } = harness;
    const providers = stubProviders();
    const controller = new AbortController();
    providers.claude.analyzeQuery.mockImplementationOnce(async () => {
      controller.abort();
      return SPENDING_ANALYSIS;
    });
    const admissionService = new AIChatAdmissionService(new AIService());
    const consent = await readHouseholdConsent(fixture.householdId);
    const key = newKey();
    const input = {
      actor: { householdId: fixture.householdId, userId: fixture.owner.id, role: "owner" as const },
      message: SPENDING_QUESTION,
      clientRequestKey: key,
      consent: consent!,
    };

    const cancelled = await admissionService.chat({ ...input, signal: controller.signal });

    expect(cancelled.response.answerMode).toBe("unavailable");
    expect(providers.claude.generateResponse).not.toHaveBeenCalled();
    expect(await requestByKey(fixture.householdId, key)).toMatchObject({ status: "failed", chatQuotaState: "refunded" });
    expect(cancelled.quota.remaining).toBe(LIMIT);

    const retried = await admissionService.chat(input);

    expect(retried.replayed).toBe(false);
    expect(retried.response.answerMode).toBe("claude");
    expect(await requestByKey(fixture.householdId, key)).toMatchObject({ status: "completed", chatQuotaState: "consumed" });
  });

  it("a provider at its daily call cap is not dispatched and not bypassed through the fallback; the answer is labelled local", async () => {
    const { app, fixture } = harness;
    const providers = stubProviders();
    const model = `cap-claude-${newKey()}`;
    providers.claude.configuredModel.mockReturnValue(model);
    // A Claude answer is two calls (analysis + answer): the cap allows exactly one answer.
    vi.stubEnv("AI_ANTHROPIC_DAILY_CALL_CAP", "2");
    try {
      const first = await chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: newKey() }).expect(200);
      expect(first.body.answerMode).toBe("claude");

      const capped = await chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: newKey() }).expect(200);

      expect(providers.claude.analyzeQuery).toHaveBeenCalledTimes(1);
      expect(providers.gemini.analyzeQuery).not.toHaveBeenCalled();
      expect(capped.body.answerMode).toBe("local");
      expect(capped.body.reply).toMatch(/^Limited local summary \(no AI provider was used\)/);
      const cappedRow = (await requestsFor(fixture.householdId)).find((row) => row.answerMode === "local");
      expect(await attemptsFor(cappedRow!.id)).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("two requests racing for the last call under the cap: exactly one call is dispatched, the cap is never exceeded", async () => {
    const { app, fixture } = harness;
    const providers = stubProviders();
    const model = `race-claude-${newKey()}`;
    providers.claude.configuredModel.mockReturnValue(model);
    const CAP = 5;
    await seedUsedCalls(fixture, model, CAP - 1);
    vi.stubEnv("AI_ANTHROPIC_DAILY_CALL_CAP", String(CAP));
    try {
      const [a, b] = await Promise.all([
        chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: newKey() }),
        chat(app, fixture.member, { message: SPENDING_QUESTION, clientRequestKey: newKey() }),
      ]);

      expect([a.status, b.status]).toEqual([200, 200]);
      expect(providers.claude.analyzeQuery).toHaveBeenCalledTimes(1);
      expect(providers.claude.generateResponse).not.toHaveBeenCalled();
      expect(providers.gemini.analyzeQuery).not.toHaveBeenCalled();
      expect([a.body.answerMode, b.body.answerMode]).toEqual(["local", "local"]);
      expect(await callsFor(model)).toBe(CAP);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("twenty concurrent claims at cap-1: exactly one is granted, the rest are refused as billing, never over the cap", async () => {
    const { fixture } = harness;
    const model = `claim-race-${newKey()}`;
    const CAP = 3;
    const requestId = await seedUsedCalls(fixture, model, CAP - 1);
    vi.stubEnv("AI_ANTHROPIC_DAILY_CALL_CAP", String(CAP));
    try {
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, (_, index) =>
          aiAdmissionRepository.claimAttempt({ requestId, generation: 1 }, {
            stage: "analysis",
            ordinal: 100 + index,
            provider: "anthropic",
            model,
            timeoutMs: 1_000,
          }),
        ),
      );

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const refusals = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      expect(refusals).toHaveLength(19);
      for (const refusal of refusals) expect(refusal.reason).toMatchObject({ category: "billing", dispatched: false });
      expect(await callsFor(model)).toBe(CAP);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("deleting a conversation clears its stored replay; the key then conflicts instead of resurrecting the answer", async () => {
    const { app, fixture } = harness;
    stubProviders();
    const key = newKey();
    const first = await chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: key }).expect(200);

    await request(app).delete(`/api/ai/conversations/${first.body.conversationId}`).set("Cookie", fixture.owner.cookie).expect(204);

    const row = await requestByKey(fixture.householdId, key);
    expect(row).toMatchObject({ responseBody: null, conversationId: null, chatQuotaState: "consumed" });
    const replay = await chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: key }).expect(409);
    expect(JSON.stringify(replay.body)).not.toContain(CLAUDE_ANSWER.response);
  });

  it("a member cannot clear another member's stored replay by deleting with a foreign conversation id", async () => {
    const { app, fixture } = harness;
    stubProviders();
    const key = newKey();
    const first = await chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: key }).expect(200);

    await request(app).delete(`/api/ai/conversations/${first.body.conversationId}`).set("Cookie", fixture.member.cookie).expect(404);

    const replay = await chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: key }).expect(200);
    expect(replay.body.reply).toBe(first.body.reply);
  });

  it("a request without a client key is admitted under a server key and never replays", async () => {
    const { app, fixture } = harness;
    const providers = stubProviders();

    await chat(app, fixture.owner, { message: SPENDING_QUESTION }).expect(200);
    await chat(app, fixture.owner, { message: SPENDING_QUESTION }).expect(200);

    expect(providers.claude.analyzeQuery).toHaveBeenCalledTimes(2);
    expect(await requestsFor(fixture.householdId)).toHaveLength(2);
  });

  it("rejects a malformed client key before admission", async () => {
    const { app, fixture } = harness;
    stubProviders();

    await chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: "x" }).expect(400);

    expect(await requestsFor(fixture.householdId)).toHaveLength(0);
  });
});
