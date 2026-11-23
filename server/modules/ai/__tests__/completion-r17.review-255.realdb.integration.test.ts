/**
 * R17 #255 Astra review (real Postgres): cap accounting, dispatch
 * authorisation under the claim lock, conversation delete vs completion,
 * accounting rows outliving deletes, and a disconnect after commit.
 */
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { aiAttempts, aiConsentEvents, aiConversations, aiMessages, aiRequests, householdMembers, households } from "@shared/schema";
import { db } from "../../../db";
import { withTransaction } from "../../../utils/withTransaction";
import { businessAuditService } from "../../../services/BusinessAuditService";
import { AIChatAdmissionService } from "../ai.chat-admission.service";
import { AIService } from "../ai.service";
import { assertOutboundStillPermitted, readHouseholdConsent } from "../ai.consent-policy";
import { aiAdmissionRepository } from "../ai.admission.repository";
import { aiConversationRepository } from "../ai.conversation.repository";
import type { StageAttemptRecord } from "../ai.provider-orchestrator";
import type { ChatResponse } from "../ai.types";
import {
  attemptsFor,
  chat,
  CLAUDE_ANSWER,
  delay,
  deferred,
  holdCapLock,
  messagesIn,
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

const MODEL_PREFIX = "r255-";
let harness: R17Harness;

function uniqueModel(label: string): string {
  return `${MODEL_PREFIX}${label}-${newKey()}`;
}

async function seedRequest(fixture: R17Harness["fixture"]): Promise<string> {
  return seedRequestFor(fixture.householdId, fixture.owner.id);
}

async function seedRequestFor(householdId: string, actorId: string): Promise<string> {
  const admission = await aiAdmissionRepository.admit({
    householdId,
    actorId,
    clientRequestKey: newKey(),
    fingerprint: "0".repeat(64),
    consentVersion: "v2.0",
  });
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

async function waitForCapLockWaiter(model: string): Promise<void> {
  const key = `ai-call-cap:anthropic:${model}`;
  for (let tries = 0; tries < 100; tries += 1) {
    const result = await db.execute(sql`
      select count(*)::int as waiting from pg_locks
      where locktype = 'advisory' and not granted
        and objid = ((hashtext(${key})::bigint) & 4294967295)::oid`);
    if (Number(result.rows[0]?.waiting ?? 0) > 0) return;
    await delay(50);
  }
  throw new Error("no request ever waited on the cap lock");
}

describe("R17 #255 review (real Postgres)", () => {
  beforeEach(async () => {
    harness = await startR17Harness();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.delete(aiAttempts).where(and(isNull(aiAttempts.requestId), like(aiAttempts.model, `${MODEL_PREFIX}%`)));
    await stopR17Harness(harness);
  });

  it("P1 settlement keeps the configured model for cap accounting and stores the reported model separately", async () => {
    const model = uniqueModel("alias");
    const requestId = await seedRequest(harness.fixture);
    vi.stubEnv("AI_ANTHROPIC_DAILY_CALL_CAP", "1");
    const claim = (ordinal: number) =>
      aiAdmissionRepository.claimAttempt({ requestId, generation: 1 }, { stage: "analysis", ordinal, provider: "anthropic", model, timeoutMs: 1_000 });

    const ticket = await claim(1);
    await aiAdmissionRepository.settleAttempt(ticket.attemptId, succeeded("resolved-model-b"));

    const [attempt] = await attemptsFor(requestId);
    expect(attempt).toMatchObject({ model, reportedModel: "resolved-model-b", status: "succeeded" });
    expect(await aiAdmissionRepository.readProviderCalls("anthropic", model)).toBe(1);
    await expect(claim(2)).rejects.toMatchObject({ category: "billing", dispatched: false });
  });

  it.each([
    ["consent revoked", "owner"],
    ["membership removed", "member"],
  ] as const)("P1 %s while a claim waits on the cap lock: it waits for the claim, then stops the dispatch or the next stage", async (_label, actorRole) => {
    const { app, fixture } = harness;
    const actor = fixture[actorRole];
    const model = uniqueModel("lock");
    const providers = stubProviders();
    providers.claude.configuredModel.mockReturnValue(model);
    const lock = await holdCapLock(model);

    const pending = chat(app, actor, { message: SPENDING_QUESTION, clientRequestKey: newKey() }).then((response) => response);
    await waitForCapLockWaiter(model);
    let changeCommitted = false;
    const change = (
      actorRole === "owner"
        ? setConsent(fixture.householdId, false, null)
        : db
            .delete(householdMembers)
            .where(and(eq(householdMembers.householdId, fixture.householdId), eq(householdMembers.userId, actor.id)))
            .then(() => undefined)
    ).then(() => {
      changeCommitted = true;
    });
    await delay(200);
    // The waiting claim authorised the call and share-locked the rows it read.
    expect(changeCommitted).toBe(false);
    await lock.release();
    await within(change, "the consent or membership change");
    const response = await pending;

    expect(response.status).toBe(403);
    // Astra #255 r4: the claim's commit releases the change and the
    // pre-dispatch consent read together. Whichever commits first decides:
    // a dispatch that began before the change completes; one that begins
    // after it never reaches the provider and settles as not dispatched.
    const analysisCalls = providers.claude.analyzeQuery.mock.calls.length;
    expect(analysisCalls).toBeLessThanOrEqual(1);
    const statuses = (await db.select().from(aiAttempts).where(eq(aiAttempts.model, model))).map((attempt) => attempt.status);
    expect(statuses).toEqual([analysisCalls === 1 ? "succeeded" : "not_dispatched"]);
    expect(providers.claude.generateResponse).not.toHaveBeenCalled();
    expect(providers.gemini.analyzeQuery).not.toHaveBeenCalled();
    expect(providers.gemini.generateResponse).not.toHaveBeenCalled();
  });

  it("P2 a household whose row is locked does not stall another household's claim for the same model", async () => {
    const { fixture } = harness;
    const model = uniqueModel("tenant");
    vi.stubEnv("AI_ANTHROPIC_DAILY_CALL_CAP", "10");
    const requestA = await seedRequest(fixture);
    const requestB = await seedRequestFor(fixture.foreignHouseholdId, fixture.outsider.id);
    const held = deferred();
    const release = deferred();
    const holder = withTransaction(async (tx) => {
      await tx.select({ id: households.id }).from(households).where(eq(households.id, fixture.householdId)).for("update");
      held.resolve();
      await release.promise;
    });
    await within(held.promise, "the household row lock");
    const attempt = { stage: "analysis" as const, ordinal: 1, provider: "anthropic" as const, model, timeoutMs: 1_000 };

    const claimA = aiAdmissionRepository.claimAttempt({ requestId: requestA, generation: 1 }, attempt, (tx) =>
      assertOutboundStillPermitted(fixture.householdId, fixture.owner.id, "v2.0", tx),
    );
    await delay(200);
    await within(
      aiAdmissionRepository.claimAttempt({ requestId: requestB, generation: 1 }, attempt, (tx) =>
        assertOutboundStillPermitted(fixture.foreignHouseholdId, fixture.outsider.id, "v2.0", tx),
      ),
      "the other household's claim",
      2_000,
    );

    release.resolve();
    await holder;
    await claimA;
    expect(await aiAdmissionRepository.readProviderCalls("anthropic", model)).toBe(2);
  });

  it("P1 deleting the conversation during an in-flight request: the same-key retry does not return the answer", async () => {
    const { app, fixture } = harness;
    const providers = stubProviders();
    const first = await chat(app, fixture.owner, { message: "Start a thread", clientRequestKey: newKey() }).expect(200);
    const conversationId: string = first.body.conversationId;
    const inAnswer = deferred();
    const releaseAnswer = deferred();
    providers.claude.generateResponse.mockImplementationOnce(async () => {
      inAnswer.resolve();
      await releaseAnswer.promise;
      return CLAUDE_ANSWER;
    });
    const key = newKey();
    const body = { message: SPENDING_QUESTION, conversationId, clientRequestKey: key };

    const pending = chat(app, fixture.owner, body).then((response) => response);
    await within(inAnswer.promise, "the answer stage");
    await request(app).delete(`/api/ai/conversations/${conversationId}`).set("Cookie", fixture.owner.cookie).expect(204);
    releaseAnswer.resolve();
    expect((await pending).status).toBe(200);

    expect(await requestByKey(fixture.householdId, key)).toMatchObject({ status: "completed", responseBody: null });
    const retry = await chat(app, fixture.owner, body).expect(409);
    expect(JSON.stringify(retry.body)).not.toContain(CLAUDE_ANSWER.response);
  });

  it("P1 a completion that commits while a delete waits is still cleared by that delete", async () => {
    const { fixture } = harness;
    const scope = { householdId: fixture.householdId, userId: fixture.owner.id };
    const conversationId = await aiConversationRepository.appendExchange({
      ...scope,
      messages: [{ role: "user", content: "seed" }, { role: "assistant", content: "seed reply" }],
    });
    const requestId = await seedRequest(fixture);
    const completed = deferred();
    const releaseCommit = deferred();
    const response: ChatResponse = {
      reply: CLAUDE_ANSWER.response,
      conversationId,
      toolsUsed: [],
      tokenCount: 7,
      remainingQueries: 0,
      answerMode: "claude",
      providers: { analysis: "anthropic", answer: "anthropic" },
    };

    const appending = aiConversationRepository.appendExchange({
      ...scope,
      conversationId,
      messages: [{ role: "user", content: SPENDING_QUESTION }, { role: "assistant", content: CLAUDE_ANSWER.response }],
      onPersisted: async (tx, persistedId) => {
        await aiAdmissionRepository.completeWith(tx, { requestId, generation: 1 }, { ...response, conversationId: persistedId }, { storeReplay: true });
        completed.resolve();
        await releaseCommit.promise;
      },
    });
    await within(completed.promise, "the in-transaction completion");
    const deleting = aiConversationRepository.delete({ ...scope, conversationId });
    await delay(200);
    releaseCommit.resolve();

    await appending;
    expect(await deleting).toBe(true);
    const [row] = await db.select().from(aiRequests).where(eq(aiRequests.id, requestId));
    expect(row).toMatchObject({ status: "completed", responseBody: null, conversationId: null });
  });

  it("P1 deleting the request (user/household erasure) keeps its de-identified call row inside the cap window", async () => {
    const model = uniqueModel("erasure");
    const requestId = await seedRequest(harness.fixture);
    vi.stubEnv("AI_ANTHROPIC_DAILY_CALL_CAP", "5");
    await aiAdmissionRepository.claimAttempt({ requestId, generation: 1 }, { stage: "analysis", ordinal: 1, provider: "anthropic", model, timeoutMs: 1_000 });

    await db.delete(aiRequests).where(eq(aiRequests.id, requestId));

    expect(await aiAdmissionRepository.readProviderCalls("anthropic", model)).toBe(1);
    const rows = await db.select().from(aiAttempts).where(eq(aiAttempts.model, model));
    expect(rows).toHaveLength(1);
    expect(rows[0].requestId).toBeNull();
  });

  it("P2 a disconnect after the exchange is committed does not reopen the request", async () => {
    const { fixture } = harness;
    const providers = stubProviders();
    const controller = new AbortController();
    const originalLog = businessAuditService.log.bind(businessAuditService);
    vi.spyOn(businessAuditService, "log").mockImplementationOnce(async (entry) => {
      controller.abort();
      return originalLog(entry);
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

    const outcome = await admissionService.chat({ ...input, signal: controller.signal });

    expect(outcome.response.answerMode).toBe("claude");
    expect(await requestByKey(fixture.householdId, key)).toMatchObject({ status: "completed", chatQuotaState: "consumed" });
    const retried = await admissionService.chat(input);
    expect(retried.replayed).toBe(true);
    expect(retried.response.reply).toBe(outcome.response.reply);
    expect(providers.claude.analyzeQuery).toHaveBeenCalledTimes(1);
    expect(outcome.response.conversationId).toBeDefined();
    expect(await messagesIn(outcome.response.conversationId ?? "")).toHaveLength(2);
  });

  it("P2 an unavailable answer for a deleted thread settles cleanly: no FK failure, no leaked unit", async () => {
    const { app, fixture } = harness;
    stubProviders({ claude: false, gemini: false });
    const scope = { householdId: fixture.householdId, userId: fixture.owner.id };
    const conversationId = await aiConversationRepository.appendExchange({
      ...scope,
      messages: [{ role: "user", content: "seed" }, { role: "assistant", content: "seed reply" }],
    });
    await aiConversationRepository.delete({ ...scope, conversationId });
    const key = newKey();
    const body = { message: "Tell me a joke", conversationId, clientRequestKey: key };

    const response = await chat(app, fixture.owner, body).expect(200);

    expect(response.body.answerMode).toBe("unavailable");
    expect(await requestByKey(fixture.householdId, key)).toMatchObject({
      status: "completed",
      chatQuotaState: "refunded",
      conversationId: null,
    });
    await chat(app, fixture.owner, body).expect(200);
  });

  it("P2 the consent change and its DPA audit row commit together", async () => {
    const { app, fixture } = harness;
    const originalLog = businessAuditService.log.bind(businessAuditService);
    vi.spyOn(businessAuditService, "log").mockImplementation(async (entry) => {
      if (entry.entityType === "ai_consent") throw new Error("audit store unavailable");
      return originalLog(entry);
    });

    const response = await request(app).post("/api/ai/consent").set("Cookie", fixture.owner.cookie).send({ consentGiven: false });

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(await readHouseholdConsent(fixture.householdId)).toEqual({ standing: "current", version: "v2.0" });
    const events = await db.select().from(aiConsentEvents).where(eq(aiConsentEvents.householdId, fixture.householdId));
    expect(events).toHaveLength(0);
  });

  it("P2 erasing a member of a shared household clears their stored answers and provider request ids", async () => {
    const { app, fixture } = harness;
    stubProviders();
    const key = newKey();
    await chat(app, fixture.member, { message: SPENDING_QUESTION, clientRequestKey: key }).expect(200);
    const before = await requestByKey(fixture.householdId, key);
    expect(before?.responseBody).not.toBeNull();
    await db.update(aiAttempts).set({ providerRequestId: "req-synthetic-member" }).where(eq(aiAttempts.requestId, before!.id));

    await request(app).post("/api/settings/security/step-up").set("Cookie", fixture.member.cookie).send({ password }).expect(200);
    await request(app).post("/api/settings/account/delete").set("Cookie", fixture.member.cookie).send({ password }).expect(200);

    const [after] = await db.select().from(aiRequests).where(eq(aiRequests.id, before!.id));
    expect(after?.responseBody ?? null).toBeNull();
    const attempts = await attemptsFor(before!.id);
    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts.every((attempt) => attempt.providerRequestId === null)).toBe(true);
  });

  it("P2 erasing a member of a shared household deletes their conversations and messages, not other members'", async () => {
    const { app, fixture } = harness;
    stubProviders();
    await chat(app, fixture.member, { message: SPENDING_QUESTION, clientRequestKey: newKey() }).expect(200);
    await chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: newKey() }).expect(200);
    const threadsOf = (userId: string) =>
      db.select({ id: aiConversations.id }).from(aiConversations).where(eq(aiConversations.userId, userId));
    const memberThreads = await threadsOf(fixture.member.id);
    const ownerThreads = await threadsOf(fixture.owner.id);
    expect(memberThreads.length).toBeGreaterThan(0);
    expect(ownerThreads.length).toBeGreaterThan(0);

    await request(app).post("/api/settings/security/step-up").set("Cookie", fixture.member.cookie).send({ password }).expect(200);
    await request(app).post("/api/settings/account/delete").set("Cookie", fixture.member.cookie).send({ password }).expect(200);

    expect(await threadsOf(fixture.member.id)).toHaveLength(0);
    const orphanMessages = await db.select({ id: aiMessages.id }).from(aiMessages)
      .where(sql`${aiMessages.conversationId} in (${sql.join(memberThreads.map((t) => sql`${t.id}`), sql`, `)})`);
    expect(orphanMessages).toHaveLength(0);
    expect(await threadsOf(fixture.owner.id)).toHaveLength(ownerThreads.length);
    const ownerMessages = await db.select({ id: aiMessages.id }).from(aiMessages).where(eq(aiMessages.conversationId, ownerThreads[0].id));
    expect(ownerMessages.length).toBeGreaterThan(0);
  });

  it("P1 an answer whose exchange failed to persist keeps no replay: deleting the thread leaves no old answer", async () => {
    const { app, fixture } = harness;
    stubProviders();
    const first = await chat(app, fixture.owner, { message: "Start a thread", clientRequestKey: newKey() }).expect(200);
    const conversationId: string = first.body.conversationId;
    vi.spyOn(aiConversationRepository, "appendExchange").mockRejectedValueOnce(new Error("conversation store unavailable"));
    const key = newKey();
    const body = { message: SPENDING_QUESTION, conversationId, clientRequestKey: key };
    const answered = await chat(app, fixture.owner, body).expect(200);
    expect(JSON.stringify(answered.body)).toContain(CLAUDE_ANSWER.response);

    await request(app).delete(`/api/ai/conversations/${conversationId}`).set("Cookie", fixture.owner.cookie).expect(204);

    expect(await requestByKey(fixture.householdId, key)).toMatchObject({ status: "completed", responseBody: null });
    const retry = await chat(app, fixture.owner, body);
    expect(JSON.stringify(retry.body)).not.toContain(CLAUDE_ANSWER.response);
  });

  it("P2 a sole member's erasure scrubs provider request ids before the household cascade detaches the attempts", async () => {
    const { app, fixture } = harness;
    stubProviders();
    const key = newKey();
    await chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: key }).expect(200);
    const ownerRequest = await requestByKey(fixture.householdId, key);
    const attemptIds = (await attemptsFor(ownerRequest!.id)).map((attempt) => attempt.id);
    expect(attemptIds.length).toBeGreaterThan(0);
    await db.update(aiAttempts).set({ providerRequestId: "req-synthetic-owner" }).where(inArray(aiAttempts.id, attemptIds));
    const erase = async (user: typeof fixture.owner) => {
      await request(app).post("/api/settings/security/step-up").set("Cookie", user.cookie).send({ password }).expect(200);
      await request(app).post("/api/settings/account/delete").set("Cookie", user.cookie).send({ password }).expect(200);
    };

    await erase(fixture.member);
    await erase(fixture.owner);

    const retained = await db.select().from(aiAttempts).where(inArray(aiAttempts.id, attemptIds));
    await db.delete(aiAttempts).where(inArray(aiAttempts.id, attemptIds));
    expect(retained).toHaveLength(attemptIds.length);
    expect(retained.every((attempt) => attempt.requestId === null && attempt.providerRequestId === null)).toBe(true);
  });

  it("P2 a provider call settling after its actor was erased keeps the usage but not the provider request id", async () => {
    const { app, fixture } = harness;
    const model = uniqueModel("late");
    vi.stubEnv("AI_ANTHROPIC_DAILY_CALL_CAP", "5");
    const requestId = await seedRequestFor(fixture.householdId, fixture.member.id);
    const ticket = await aiAdmissionRepository.claimAttempt({ requestId, generation: 1 }, { stage: "analysis", ordinal: 1, provider: "anthropic", model, timeoutMs: 60_000 });

    await request(app).post("/api/settings/security/step-up").set("Cookie", fixture.member.cookie).send({ password }).expect(200);
    await request(app).post("/api/settings/account/delete").set("Cookie", fixture.member.cookie).send({ password }).expect(200);
    await aiAdmissionRepository.settleAttempt(ticket.attemptId, { ...succeeded(model), providerRequestId: "req-late-after-erasure" });

    const [attempt] = await attemptsFor(requestId);
    expect(attempt).toMatchObject({ status: "succeeded", inputTokens: 3, outputTokens: 4, providerRequestId: null });
  });
});
