/**
 * Shared harness for the R17 slice-2 real-Postgres suites (admission ledger,
 * consent version, provider health). Seeds the C3-08 household (owner + member
 * + a foreign household) and replaces BOTH provider adapters with spies, so no
 * request ever leaves the process. No key is read or used.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { vi } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import { aiAttempts, aiConsentEvents, aiMessages, aiRequests, households } from "@shared/schema";
import { db } from "../../../db";
import { withTransaction } from "../../../utils/withTransaction";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { aiCache } from "../ai.cache";
import { claudeClient } from "../ai.claude";
import { geminiClient } from "../ai.gemini";
import type { AnalysisResult, AnswerResult } from "../ai.provider.types";
import {
  cleanCachePrivacyFixture,
  createCachePrivacyFixture,
  password,
  seedCachePrivacyFixture,
  type CachePrivacyActor,
  type CachePrivacyFixture,
} from "./ai.cache-privacy.fixture";

export type TestApp = Awaited<ReturnType<typeof getTestApp>>;

export const SPENDING_QUESTION = "How much did I spend?";
export const SPENDING_ANALYSIS: AnalysisResult = {
  toolCalls: [{ name: "get_spending_by_category", args: {} }],
  tokenCount: 5,
};
export const CLAUDE_ANSWER: AnswerResult = { response: "Recorded Claude answer.", tokenCount: 7 };
export const GEMINI_ANSWER: AnswerResult = { response: "Recorded Gemini answer.", tokenCount: 7 };

export interface R17Harness {
  app: TestApp;
  fixture: CachePrivacyFixture;
}

let cachedApp: TestApp | null = null;
let cachedHash: string | null = null;

export async function startR17Harness(): Promise<R17Harness> {
  cachedApp ??= await getTestApp();
  cachedHash ??= await hashPassword(password);
  const fixture = createCachePrivacyFixture();
  await seedCachePrivacyFixture(fixture, cachedApp, cachedHash);
  return { app: cachedApp, fixture };
}

export async function stopR17Harness(harness: R17Harness | undefined): Promise<void> {
  vi.restoreAllMocks();
  if (!harness) return;
  aiCache.invalidateHousehold(harness.fixture.householdId);
  aiCache.invalidateHousehold(harness.fixture.foreignHouseholdId);
  await cleanCachePrivacyFixture(harness.fixture);
}

/** Both adapters configured, Claude healthy; individual tests override. */
export function stubProviders(options: { claude?: boolean; gemini?: boolean } = {}) {
  const claudeOn = options.claude ?? true;
  const geminiOn = options.gemini ?? true;
  const claude = {
    isAvailable: vi.spyOn(claudeClient, "isAvailable").mockReturnValue(claudeOn),
    configurationIssue: vi.spyOn(claudeClient, "configurationIssue").mockReturnValue(claudeOn ? null : "unconfigured"),
    configuredModel: vi.spyOn(claudeClient, "configuredModel").mockReturnValue(claudeOn ? "recorded-claude-model" : null),
    analyzeQuery: vi.spyOn(claudeClient, "analyzeQuery").mockResolvedValue(SPENDING_ANALYSIS),
    generateResponse: vi.spyOn(claudeClient, "generateResponse").mockResolvedValue(CLAUDE_ANSWER),
  };
  const gemini = {
    isAvailable: vi.spyOn(geminiClient, "isAvailable").mockReturnValue(geminiOn),
    configurationIssue: vi.spyOn(geminiClient, "configurationIssue").mockReturnValue(geminiOn ? null : "unconfigured"),
    configuredModel: vi.spyOn(geminiClient, "configuredModel").mockReturnValue(geminiOn ? "recorded-gemini-model" : null),
    analyzeQuery: vi.spyOn(geminiClient, "analyzeQuery").mockResolvedValue(SPENDING_ANALYSIS),
    generateResponse: vi.spyOn(geminiClient, "generateResponse").mockResolvedValue(GEMINI_ANSWER),
  };
  return { claude, gemini };
}

export function chat(app: TestApp, actor: CachePrivacyActor, body: Record<string, unknown>) {
  return request(app).post("/api/ai/chat").set("Cookie", actor.cookie).send(body);
}

export function newKey(): string {
  return `r17-${randomUUID()}`;
}

export async function requestsFor(householdId: string) {
  return db.select().from(aiRequests).where(eq(aiRequests.householdId, householdId)).orderBy(asc(aiRequests.createdAt));
}

export async function requestByKey(householdId: string, key: string) {
  const [row] = await db
    .select()
    .from(aiRequests)
    .where(and(eq(aiRequests.householdId, householdId), eq(aiRequests.clientRequestKey, key)));
  return row;
}

export async function attemptsFor(requestId: string) {
  return db.select().from(aiAttempts).where(eq(aiAttempts.requestId, requestId)).orderBy(asc(aiAttempts.ordinal));
}

export async function messagesIn(conversationId: string) {
  return db.select().from(aiMessages).where(eq(aiMessages.conversationId, conversationId));
}

export async function consentEventsFor(householdId: string) {
  return db
    .select()
    .from(aiConsentEvents)
    .where(eq(aiConsentEvents.householdId, householdId))
    .orderBy(asc(aiConsentEvents.createdAt));
}

export async function setConsent(householdId: string, given: boolean, version: string | null) {
  await db
    .update(households)
    .set({ aiConsentGiven: given, aiConsentVersion: version, aiConsentDate: given ? new Date() : null })
    .where(eq(households.id, householdId));
}

/** Seed `count` already-consumed chat units so a test can reach the last unit. */
export async function seedConsumedRequests(householdId: string, actorId: string, count: number, createdAt = new Date()) {
  if (count === 0) return;
  await db.insert(aiRequests).values(
    Array.from({ length: count }, (_, index) => ({
      householdId,
      actorId,
      clientRequestKey: `seed-${index}-${randomUUID()}`,
      fingerprint: "0".repeat(64),
      consentVersion: "v2.0",
      status: "completed",
      chatQuotaState: "consumed",
      answerMode: "claude",
      createdAt,
      completedAt: createdAt,
    })),
  );
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function within<T>(promise: Promise<T>, label: string, ms = 5_000): Promise<T> {
  return Promise.race([
    promise,
    delay(ms).then(() => {
      throw new Error(`timed out waiting for ${label}`);
    }),
  ]);
}

/** Hold the cap lock for (anthropic, model) in another transaction until released. */
export async function holdCapLock(model: string): Promise<{ release: () => Promise<void> }> {
  const acquired = deferred();
  const released = deferred();
  const holder = withTransaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ai-call-cap:anthropic:${model}`}))`);
    acquired.resolve();
    await released.promise;
  });
  await within(acquired.promise, "the cap lock");
  return {
    release: async () => {
      released.resolve();
      await holder;
    },
  };
}

