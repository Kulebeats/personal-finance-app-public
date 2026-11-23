/**
 * R17 #255 Astra round 3 (real Postgres): consent grants carry the disclosure
 * version shown and recheck the actor's role under lock; exchange persistence
 * is fenced against erasure; attempts settle by their own id; a retry keeps
 * the request's paid-call count; the claim honours the request deadline; an
 * "unavailable" replay is a fixed non-answer; the query audit row commits
 * with the outcome it describes.
 */
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, isNull, like } from "drizzle-orm";
import { aiAttempts, aiConsentEvents, aiConversations, aiMessages, auditLogs, householdMembers } from "@shared/schema";
import { db } from "../../../db";
import { businessAuditService } from "../../../services/BusinessAuditService";
import { withTransaction } from "../../../utils/withTransaction";
import { readHouseholdConsent } from "../ai.consent-policy";
import { aiAdmissionRepository } from "../ai.admission.repository";
import { isProviderError } from "../ai.provider.types";
import type { StageAttemptRecord } from "../ai.provider-orchestrator";
import type { ChatResponse } from "../ai.types";
import {
  attemptsFor,
  chat,
  CLAUDE_ANSWER,
  deferred,
  delay,
  holdCapLock,
  newKey,
  requestByKey,
  setConsent,
  SPENDING_QUESTION,
  startR17Harness,
  stopR17Harness,
  stubProviders,
  type R17Harness,
  within,
} from "./completion-r17.realdb.fixture";
import { password } from "./ai.cache-privacy.fixture";

const MODEL_PREFIX = "r255r3-";
let harness: R17Harness;

type Actor = R17Harness["fixture"]["owner"];

function uniqueModel(label: string): string {
  return `${MODEL_PREFIX}${label}-${newKey()}`;
}

async function erase(app: R17Harness["app"], actor: Actor): Promise<void> {
  await request(app).post("/api/settings/security/step-up").set("Cookie", actor.cookie).send({ password }).expect(200);
  await request(app).post("/api/settings/account/delete").set("Cookie", actor.cookie).send({ password }).expect(200);
}

function grant(app: R17Harness["app"], actor: Actor, body: Record<string, unknown>) {
  return request(app).post("/api/ai/consent").set("Cookie", actor.cookie).send(body);
}

async function setRole(householdId: string, userId: string, role: "admin" | "member"): Promise<void> {
  await db.update(householdMembers).set({ role })
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)));
}

function threadsOf(userId: string) {
  return db.select({ id: aiConversations.id }).from(aiConversations).where(eq(aiConversations.userId, userId));
}

async function admitWithKey(householdId: string, actorId: string, clientRequestKey: string) {
  return aiAdmissionRepository.admit({ householdId, actorId, clientRequestKey, fingerprint: "0".repeat(64), consentVersion: "v2.0" });
}

async function seedRequestFor(householdId: string, actorId: string): Promise<string> {
  const admission = await admitWithKey(householdId, actorId, newKey());
  if (admission.kind !== "admitted") throw new Error("expected a fresh admission");
  return admission.requestId;
}

function succeeded(model: string): StageAttemptRecord {
  return {
    ordinal: 1,
    stage: "analysis",
    provider: "anthropic",
    model,
    outcome: "succeeded",
    category: null,
    dispatched: true,
    usage: { known: true, inputTokens: 3, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0 },
    providerRequestId: "req-recorded",
    durationMs: 5,
  };
}

/** Hold Claude's answer stage open until released (after the last claim). */
function holdClaudeAnswer(providers: ReturnType<typeof stubProviders>) {
  const entered = deferred();
  const release = deferred();
  providers.claude.generateResponse.mockImplementation(async () => {
    entered.resolve();
    await release.promise;
    return CLAUDE_ANSWER;
  });
  return { entered, release };
}

describe("R17 #255 Astra round 3 (real Postgres)", () => {
  beforeEach(async () => {
    harness = await startR17Harness();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.delete(aiAttempts).where(and(isNull(aiAttempts.requestId), like(aiAttempts.model, `${MODEL_PREFIX}%`)));
    await stopR17Harness(harness);
  });

  describe("P1 a consent grant names the disclosure version the owner was shown", () => {
    beforeEach(async () => {
      await setConsent(harness.fixture.householdId, false, null);
    });

    it("refuses a grant that names no version", async () => {
      const response = await grant(harness.app, harness.fixture.owner, { consentGiven: true });

      expect(response.status).toBe(400);
      expect(await readHouseholdConsent(harness.fixture.householdId)).toEqual({ standing: "none", version: null });
    });

    it("refuses a grant of a stale disclosure (v1.0 page, v2.0 server)", async () => {
      const response = await grant(harness.app, harness.fixture.owner, { consentGiven: true, consentVersion: "v1.0" });

      expect(response.status).toBe(409);
      expect(await readHouseholdConsent(harness.fixture.householdId)).toEqual({ standing: "none", version: null });
      const events = await db.select().from(aiConsentEvents).where(eq(aiConsentEvents.householdId, harness.fixture.householdId));
      expect(events).toHaveLength(0);
    });

    it("records a grant of the current disclosure, and a revoke needs no version", async () => {
      await grant(harness.app, harness.fixture.owner, { consentGiven: true, consentVersion: "v2.0" }).expect(200);
      expect(await readHouseholdConsent(harness.fixture.householdId)).toEqual({ standing: "current", version: "v2.0" });

      await grant(harness.app, harness.fixture.owner, { consentGiven: false }).expect(200);
      expect(await readHouseholdConsent(harness.fixture.householdId)).toEqual({ standing: "none", version: null });
    });
  });

  it("P1 an admin demoted after the role check cannot commit a consent grant", async () => {
    const { app, fixture } = harness;
    await setConsent(fixture.householdId, false, null);
    await setRole(fixture.householdId, fixture.member.id, "admin");
    // The demotion is written but not committed: the request's role check
    // (a plain read) still sees admin, and only a locked recheck waits for it.
    const written = deferred();
    const commit = deferred();
    const demotion = withTransaction(async (tx) => {
      await tx.update(householdMembers).set({ role: "member" })
        .where(and(eq(householdMembers.householdId, fixture.householdId), eq(householdMembers.userId, fixture.member.id)));
      written.resolve();
      await commit.promise;
    });
    await within(written.promise, "the demotion");
    const pending = grant(app, fixture.member, { consentGiven: true, consentVersion: "v2.0" }).then((response) => response);
    await delay(500);
    commit.resolve();
    await demotion;

    const response = await pending;

    expect(response.status).toBe(403);
    expect(await readHouseholdConsent(fixture.householdId)).toEqual({ standing: "none", version: null });
    const events = await db.select().from(aiConsentEvents).where(eq(aiConsentEvents.householdId, fixture.householdId));
    expect(events).toHaveLength(0);
  });

  it("P1 a first-message chat finishing after its actor's erasure persists no thread, message or replay", async () => {
    const { app, fixture } = harness;
    const held = holdClaudeAnswer(stubProviders());
    const key = newKey();
    const pending = chat(app, fixture.member, { message: SPENDING_QUESTION, clientRequestKey: key }).then((response) => response);
    await within(held.entered.promise, "the answer stage");

    await erase(app, fixture.member);
    held.release.resolve();
    const response = await pending;

    expect(response.status).toBe(403);
    expect(await threadsOf(fixture.member.id)).toHaveLength(0);
    const request = await requestByKey(fixture.householdId, key);
    expect(request?.responseBody ?? null).toBeNull();
    expect(request?.status).not.toBe("completed");
  });

  it("P1 a continuation finishing after its actor's erasure does not recreate the thread elsewhere", async () => {
    const { app, fixture } = harness;
    const providers = stubProviders();
    const first = await chat(app, fixture.member, { message: "Start a thread", clientRequestKey: newKey() }).expect(200);
    const conversationId: string = first.body.conversationId;
    const held = holdClaudeAnswer(providers);
    const pending = chat(app, fixture.member, { message: SPENDING_QUESTION, conversationId, clientRequestKey: newKey() })
      .then((response) => response);
    await within(held.entered.promise, "the answer stage");

    await erase(app, fixture.member);
    held.release.resolve();
    const response = await pending;

    expect(response.status).toBe(403);
    expect(await threadsOf(fixture.member.id)).toHaveLength(0);
    const leftovers = await db.select({ id: aiMessages.id }).from(aiMessages)
      .innerJoin(aiConversations, eq(aiMessages.conversationId, aiConversations.id))
      .where(eq(aiConversations.userId, fixture.member.id));
    expect(leftovers).toHaveLength(0);
  });

  it("P2(a) a late settlement after sole-member erasure records usage on the detached attempt", async () => {
    const { app, fixture } = harness;
    const model = uniqueModel("detached");
    vi.stubEnv("AI_ANTHROPIC_DAILY_CALL_CAP", "5");
    await erase(app, fixture.member);
    const requestId = await seedRequestFor(fixture.householdId, fixture.owner.id);
    const ticket = await aiAdmissionRepository.claimAttempt({ requestId, generation: 1 }, {
      stage: "analysis", ordinal: 1, provider: "anthropic", model, timeoutMs: 60_000,
    });

    await erase(app, fixture.owner);
    await aiAdmissionRepository.settleAttempt(ticket.attemptId, succeeded(model));

    const [attempt] = await db.select().from(aiAttempts).where(eq(aiAttempts.model, model));
    expect(attempt).toMatchObject({ requestId: null, status: "succeeded", inputTokens: 3, outputTokens: 4, providerRequestId: null });
  });

  it("P2(b) re-admitting a failed request reports the paid calls it already made", async () => {
    const { fixture } = harness;
    const model = uniqueModel("retry");
    vi.stubEnv("AI_ANTHROPIC_DAILY_CALL_CAP", "5");
    const key = newKey();
    const first = await admitWithKey(fixture.householdId, fixture.owner.id, key);
    if (first.kind !== "admitted") throw new Error("expected a fresh admission");
    expect(first.priorPaidCalls).toBe(0);
    for (const ordinal of [1, 2]) {
      await aiAdmissionRepository.claimAttempt(first, { stage: "analysis", ordinal, provider: "anthropic", model, timeoutMs: 1_000 });
    }
    await aiAdmissionRepository.fail(first);

    const retry = await admitWithKey(fixture.householdId, fixture.owner.id, key);

    expect(retry).toMatchObject({ kind: "admitted", requestId: first.requestId, attemptOffset: 2, priorPaidCalls: 2 });
  });

  it("P2(c) a claim whose lock wait outlives the request deadline refuses as an undispatched timeout", async () => {
    const { fixture } = harness;
    const model = uniqueModel("deadline");
    vi.stubEnv("AI_ANTHROPIC_DAILY_CALL_CAP", "5");
    const requestId = await seedRequestFor(fixture.householdId, fixture.owner.id);
    const lock = await holdCapLock(model);
    try {
      const claim = aiAdmissionRepository.claimAttempt({ requestId, generation: 1 }, {
        stage: "analysis", ordinal: 1, provider: "anthropic", model, timeoutMs: 12_000, requestDeadlineAt: Date.now() + 1_500,
      });
      const error = await within(claim.then(() => null, (failure: unknown) => failure), "the bounded claim", 4_000);
      expect(isProviderError(error) && error.category === "timeout" && !error.dispatched).toBe(true);
    } finally {
      await lock.release();
    }
    expect(await attemptsFor(requestId)).toHaveLength(0);
  });

  it("P2(c) an attempt is stamped dispatched when its claim commits, not before the lock wait", async () => {
    const { fixture } = harness;
    const model = uniqueModel("stamp");
    vi.stubEnv("AI_ANTHROPIC_DAILY_CALL_CAP", "5");
    const requestId = await seedRequestFor(fixture.householdId, fixture.owner.id);
    const lock = await holdCapLock(model);
    const claim = aiAdmissionRepository.claimAttempt({ requestId, generation: 1 }, {
      stage: "analysis", ordinal: 1, provider: "anthropic", model, timeoutMs: 12_000, requestDeadlineAt: Date.now() + 60_000,
    });
    await delay(400);
    const releasedAt = Date.now();
    await lock.release();
    await claim;

    const [attempt] = await attemptsFor(requestId);
    expect(attempt.dispatchedAt.getTime()).toBeGreaterThanOrEqual(releasedAt - 50);
  });

  it("P2(d) an unavailable outcome replays as a fixed non-answer with no request metadata", async () => {
    const { fixture } = harness;
    const key = newKey();
    const admission = await admitWithKey(fixture.householdId, fixture.owner.id, key);
    if (admission.kind !== "admitted") throw new Error("expected a fresh admission");
    const response: ChatResponse = {
      reply: "I couldn't retrieve the information needed to answer your question, so I won't guess. Please try again.",
      conversationId: "",
      toolsUsed: ["get_account_balances"],
      tokenCount: 51,
      remainingQueries: 0,
      provenance: { dataWindow: { start: "2026-10-01", end: "2026-11-01" }, freshnessTs: "2026-11-18T00:00:00Z", tools: ["get_account_balances"] },
      answerMode: "unavailable",
      providers: { analysis: "anthropic", answer: null },
    };

    await aiAdmissionRepository.settleOutcome(
      admission,
      { householdId: fixture.householdId, actorId: fixture.owner.id },
      { cancelled: false, response },
    );

    const row = await requestByKey(fixture.householdId, key);
    // Astra #255 r4: the stored non-answer carries no conversation id at all.
    expect(row?.responseBody).toEqual({
      reply: response.reply,
      toolsUsed: [],
      tokenCount: 0,
      remainingQueries: 0,
      answerMode: "unavailable",
      providers: { analysis: null, answer: null },
    });
  });

  describe("P2(e) the query audit row commits with the outcome it describes", () => {
    function failQueryAudit() {
      const originalLog = businessAuditService.log.bind(businessAuditService);
      return vi.spyOn(businessAuditService, "log").mockImplementation(async (entry) => {
        if (entry.entityType === "ai_query") throw new Error("audit store unavailable");
        return originalLog(entry);
      });
    }

    async function queryAudits(householdId: string) {
      return db.select().from(auditLogs).where(and(eq(auditLogs.householdId, householdId), eq(auditLogs.entityType, "ai_query")));
    }

    it("an answered exchange whose audit fails is not committed, and the retry runs and audits", async () => {
      const { app, fixture } = harness;
      const providers = stubProviders();
      const spy = failQueryAudit();
      const key = newKey();
      const body = { message: SPENDING_QUESTION, clientRequestKey: key };

      const failed = await chat(app, fixture.owner, body);

      expect(failed.status).toBeGreaterThanOrEqual(500);
      expect(await requestByKey(fixture.householdId, key)).toMatchObject({ status: "failed", responseBody: null });
      expect(await threadsOf(fixture.owner.id)).toHaveLength(0);
      spy.mockRestore();

      const retried = await chat(app, fixture.owner, body).expect(200);

      expect(providers.claude.analyzeQuery).toHaveBeenCalledTimes(2);
      const audits = await queryAudits(fixture.householdId);
      expect(audits.map((audit) => audit.entityId)).toContain(retried.body.conversationId);
    });

    it("an unavailable outcome whose audit fails keeps no replay", async () => {
      const { app, fixture } = harness;
      stubProviders({ claude: false, gemini: false });
      const spy = failQueryAudit();
      const key = newKey();
      const body = { message: "Tell me a joke", clientRequestKey: key };

      const failed = await chat(app, fixture.owner, body);

      expect(failed.status).toBeGreaterThanOrEqual(500);
      expect(await requestByKey(fixture.householdId, key)).toMatchObject({ status: "failed", responseBody: null });
      spy.mockRestore();
      await chat(app, fixture.owner, body).expect(200);
      expect(await queryAudits(fixture.householdId)).toHaveLength(1);
    });
  });
});
