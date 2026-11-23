/**
 * R17 follow-up (#255 known limit, owner "deal with these"): egress after a
 * consent revocation or an erasure.
 *
 * - A revoke through the consent endpoint aborts the household's in-flight
 *   provider call: nothing is stored or returned, the request fails (refunded)
 *   and its ai_query audit is content-free.
 * - A revoke the process does not hear about (written by another instance,
 *   here straight to the database) is caught when the late answer arrives:
 *   the answer is discarded with the same outcome.
 * - An erasure aborts the erased actor's in-flight call.
 *
 * Real Postgres and the real HTTP routes; only the provider SDK calls are
 * replaced by recorded answers that wait.
 */
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { aiConversations, aiMessages, auditLogs } from "@shared/schema";
import { db } from "../../../db";
import { ProviderError, type ProviderCallOptions } from "../ai.provider.types";
import {
  chat,
  CLAUDE_ANSWER,
  deferred,
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

let harness: R17Harness;

/** The answer call waits; it settles on `release`, or rejects when its signal aborts. */
function holdAnswerCall(providers: ReturnType<typeof stubProviders>, options: { honourAbort: boolean }) {
  const entered = deferred();
  const release = deferred();
  const seen: { signal?: AbortSignal } = {};
  providers.claude.generateResponse.mockImplementation(
    (_message: string, _tools: unknown, _currency: string, call: ProviderCallOptions = {}) =>
      new Promise((resolve, reject) => {
        seen.signal = call.signal;
        entered.resolve();
        release.promise.then(() => resolve(CLAUDE_ANSWER));
        if (options.honourAbort) {
          call.signal?.addEventListener("abort", () =>
            reject(new ProviderError({ provider: "anthropic", category: "timeout", message: "aborted", dispatched: true })),
          );
        }
      }),
  );
  return { entered, release, seen };
}

async function threadsOf(userId: string) {
  return db.select({ id: aiConversations.id }).from(aiConversations).where(eq(aiConversations.userId, userId));
}

async function messagesOf(userId: string) {
  return db.select({ id: aiMessages.id }).from(aiMessages)
    .innerJoin(aiConversations, eq(aiMessages.conversationId, aiConversations.id))
    .where(eq(aiConversations.userId, userId));
}

async function queryAudits(householdId: string) {
  const rows = await db.select({ details: auditLogs.details }).from(auditLogs)
    .where(and(eq(auditLogs.householdId, householdId), eq(auditLogs.entityType, "ai_query")));
  return rows.map((row) => row.details as Record<string, unknown>);
}

async function expectDiscarded(response: request.Response, householdId: string, actorId: string, key: string) {
  expect(response.status).toBe(403);
  expect(JSON.stringify(response.body)).not.toContain(CLAUDE_ANSWER.response);
  expect(await threadsOf(actorId)).toHaveLength(0);
  expect(await messagesOf(actorId)).toHaveLength(0);
  expect(await requestByKey(householdId, key)).toMatchObject({ status: "failed", chatQuotaState: "refunded", responseBody: null });
  const audits = await queryAudits(householdId);
  expect(audits).toHaveLength(1);
  expect(audits[0]).not.toHaveProperty("query");
  expect(audits[0]).not.toHaveProperty("response_summary");
  expect(audits[0]).toMatchObject({ success: false, consent_revoked: true });
}

describe("R17 egress after consent revocation or erasure (real Postgres)", () => {
  beforeEach(async () => {
    harness = await startR17Harness();
  });

  afterEach(async () => {
    await stopR17Harness(harness);
  });

  it("a revoke through the consent endpoint aborts the pending provider call; nothing is stored or returned", async () => {
    const { app, fixture } = harness;
    const held = holdAnswerCall(stubProviders(), { honourAbort: true });
    const key = newKey();
    const pending = chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: key }).then((response) => response);
    await within(held.entered.promise, "the answer call");

    await request(app).post("/api/ai/consent").set("Cookie", fixture.owner.cookie).send({ consentGiven: false }).expect(200);

    const response = await within(pending, "the aborted chat");
    expect(held.seen.signal?.aborted).toBe(true);
    await expectDiscarded(response, fixture.householdId, fixture.owner.id, key);
  });

  it("a revoke this process never hears about discards the late answer when it arrives", async () => {
    const { app, fixture } = harness;
    const held = holdAnswerCall(stubProviders(), { honourAbort: false });
    const key = newKey();
    const pending = chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: key }).then((response) => response);
    await within(held.entered.promise, "the answer call");

    await setConsent(fixture.householdId, false, null);
    held.release.resolve();

    const response = await within(pending, "the late answer");
    expect(held.seen.signal?.aborted).toBe(false);
    await expectDiscarded(response, fixture.householdId, fixture.owner.id, key);
  });

  it("an erasure aborts the erased actor's pending provider call and stores nothing for them", async () => {
    const { app, fixture } = harness;
    const held = holdAnswerCall(stubProviders(), { honourAbort: true });
    const pending = chat(app, fixture.member, { message: SPENDING_QUESTION, clientRequestKey: newKey() }).then((response) => response);
    await within(held.entered.promise, "the answer call");

    await request(app).post("/api/settings/security/step-up").set("Cookie", fixture.member.cookie).send({ password }).expect(200);
    await request(app).post("/api/settings/account/delete").set("Cookie", fixture.member.cookie).send({ password }).expect(200);

    const response = await within(pending, "the aborted chat");
    expect(held.seen.signal?.aborted).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain(CLAUDE_ANSWER.response);
    expect(await messagesOf(fixture.member.id)).toHaveLength(0);
  });
});
