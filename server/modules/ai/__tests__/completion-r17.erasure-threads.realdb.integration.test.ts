/**
 * R17 follow-up (owner ruling on N6), real Postgres and the real HTTP routes;
 * only the provider SDK calls are recorded answers.
 *
 * (a) A chat in flight at the moment of erasure never leaves a conversation or
 *     message row for the erased actor, whichever transaction reaches the
 *     household lock first.
 * (b) An exchange is recorded only under a conversation the actor owns that
 *     already exists, or one created properly. When the store write fails, no
 *     conversation id is invented: none is handed back, and the query's audit
 *     row names no thread that does not exist.
 */
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { aiConversations, aiMessages, auditLogs } from "@shared/schema";
import { db } from "../../../db";
import { businessAuditService } from "../../../services/BusinessAuditService";
import { aiConversationRepository } from "../ai.conversation.repository";
import {
  chat,
  CLAUDE_ANSWER,
  deferred,
  delay,
  newKey,
  requestByKey,
  SPENDING_QUESTION,
  startR17Harness,
  stopR17Harness,
  stubProviders,
  type R17Harness,
  within,
} from "./completion-r17.realdb.fixture";
import { password } from "./ai.cache-privacy.fixture";

let harness: R17Harness;
type Actor = R17Harness["fixture"]["owner"];
type AuditEntry = Parameters<typeof businessAuditService.log>[0];

function erase(app: R17Harness["app"], actor: Actor) {
  return request(app).post("/api/settings/security/step-up").set("Cookie", actor.cookie).send({ password }).expect(200)
    .then(() => request(app).post("/api/settings/account/delete").set("Cookie", actor.cookie).send({ password }));
}

function threadsOf(userId: string) {
  return db.select({ id: aiConversations.id }).from(aiConversations).where(eq(aiConversations.userId, userId));
}

function messagesOf(userId: string) {
  return db.select({ id: aiMessages.id }).from(aiMessages)
    .innerJoin(aiConversations, eq(aiMessages.conversationId, aiConversations.id))
    .where(eq(aiConversations.userId, userId));
}

async function queryAuditEntityIds(householdId: string, userId: string) {
  const rows = await db.select({ entityId: auditLogs.entityId }).from(auditLogs)
    .where(and(eq(auditLogs.householdId, householdId), eq(auditLogs.userId, userId), eq(auditLogs.entityType, "ai_query")));
  return rows.map((row) => row.entityId);
}

async function conversationExists(id: string): Promise<boolean> {
  const [row] = await db.select({ id: aiConversations.id }).from(aiConversations).where(eq(aiConversations.id, id));
  return row !== undefined;
}

/** Hold the first audit write matching `match` inside its transaction until released. */
function holdAuditWrite(match: (entry: AuditEntry) => boolean) {
  const entered = deferred();
  const release = deferred();
  const original = businessAuditService.log.bind(businessAuditService);
  let held = false;
  vi.spyOn(businessAuditService, "log").mockImplementation(async (entry: AuditEntry) => {
    if (!held && match(entry)) {
      held = true;
      entered.resolve();
      await release.promise;
    }
    return original(entry);
  });
  return { entered, release };
}

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

function failTheStoreWrite() {
  vi.spyOn(aiConversationRepository, "appendExchange").mockRejectedValue(new Error("store unavailable"));
}

describe("R17 erasure vs new threads, and no invented conversation ids (real Postgres)", () => {
  beforeEach(async () => {
    harness = await startR17Harness();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await stopR17Harness(harness);
  });

  describe("(a) a chat in flight at the moment of erasure", () => {
    it("an exchange holding the household lock when the erasure starts leaves nothing once the erasure commits", async () => {
      const { app, fixture } = harness;
      stubProviders();
      const exchange = holdAuditWrite((entry) => entry.entityType === "ai_query" && entry.tx !== undefined);
      const key = newKey();
      const pending = chat(app, fixture.member, { message: SPENDING_QUESTION, clientRequestKey: key }).then((response) => response);
      await within(exchange.entered.promise, "the exchange's audit write");

      let erased = false;
      const erasure = erase(app, fixture.member).then((response) => {
        erased = true;
        return response;
      });
      await delay(500);
      expect(erased).toBe(false); // the erasure waits for the exchange's locks
      exchange.release.resolve();

      await within(pending, "the chat");
      expect((await within(erasure, "the erasure")).status).toBe(200);
      expect(await threadsOf(fixture.member.id)).toHaveLength(0);
      expect(await messagesOf(fixture.member.id)).toHaveLength(0);
      expect((await requestByKey(fixture.householdId, key))?.responseBody ?? null).toBeNull();
    });

    it("an answer that reaches the store while the erasure holds its locks opens no thread", async () => {
      const { app, fixture } = harness;
      const held = holdClaudeAnswer(stubProviders());
      const erasureWrite = holdAuditWrite((entry) => entry.entityType === "user_account");
      const key = newKey();
      const pending = chat(app, fixture.member, { message: SPENDING_QUESTION, clientRequestKey: key }).then((response) => response);
      await within(held.entered.promise, "the answer stage");

      const erasure = erase(app, fixture.member).then((response) => response);
      await within(erasureWrite.entered.promise, "the erasure's audit write");
      held.release.resolve();
      await delay(500); // the exchange now waits on the erasure's locks
      erasureWrite.release.resolve();

      expect((await within(erasure, "the erasure")).status).toBe(200);
      const response = await within(pending, "the chat");
      expect(response.status).toBe(403);
      expect(JSON.stringify(response.body)).not.toContain(CLAUDE_ANSWER.response);
      expect(await threadsOf(fixture.member.id)).toHaveLength(0);
      expect(await messagesOf(fixture.member.id)).toHaveLength(0);
      const stored = await requestByKey(fixture.householdId, key);
      expect(stored?.responseBody ?? null).toBeNull();
      expect(stored?.status).not.toBe("completed");
    });
  });

  describe("(b) a failed store write invents no conversation id", () => {
    it("a first message hands back no conversation id and audits under no thread", async () => {
      const { app, fixture } = harness;
      stubProviders();
      failTheStoreWrite();

      const response = await chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: newKey() });

      expect(response.status).toBe(200);
      expect(response.body.conversationId).toBeUndefined();
      expect(await threadsOf(fixture.owner.id)).toHaveLength(0);
      expect(await queryAuditEntityIds(fixture.householdId, fixture.owner.id)).toEqual([null]);
    });

    it("a supplied id the actor does not own is neither handed back nor audited", async () => {
      const { app, fixture } = harness;
      stubProviders();
      const theirs = await chat(app, fixture.member, { message: "Start a thread", clientRequestKey: newKey() }).expect(200);
      const memberThread: string = theirs.body.conversationId;
      failTheStoreWrite();

      const response = await chat(app, fixture.owner, {
        message: SPENDING_QUESTION, conversationId: memberThread, clientRequestKey: newKey(),
      });

      expect(response.status).toBe(200);
      expect(response.body.conversationId).toBeUndefined();
      expect(await queryAuditEntityIds(fixture.householdId, fixture.owner.id)).toEqual([null]);
    });

    it("a supplied id that does not exist is neither handed back nor audited", async () => {
      const { app, fixture } = harness;
      stubProviders();
      failTheStoreWrite();
      const missing = "00000000-0000-4000-8000-000000000000";

      const response = await chat(app, fixture.owner, { message: SPENDING_QUESTION, conversationId: missing, clientRequestKey: newKey() });

      expect(response.status).toBe(200);
      expect(response.body.conversationId).toBeUndefined();
      expect(await conversationExists(missing)).toBe(false);
      expect(await queryAuditEntityIds(fixture.householdId, fixture.owner.id)).toEqual([null]);
    });

    it("the actor's own existing thread is kept: handed back and audited under it", async () => {
      const { app, fixture } = harness;
      stubProviders();
      const first = await chat(app, fixture.owner, { message: "Start a thread", clientRequestKey: newKey() }).expect(200);
      const ownThread: string = first.body.conversationId;
      failTheStoreWrite();

      const response = await chat(app, fixture.owner, { message: SPENDING_QUESTION, conversationId: ownThread, clientRequestKey: newKey() });

      expect(response.status).toBe(200);
      expect(response.body.conversationId).toBe(ownThread);
      expect(await queryAuditEntityIds(fixture.householdId, fixture.owner.id)).toEqual([ownThread, ownThread]);
    });
  });
});
