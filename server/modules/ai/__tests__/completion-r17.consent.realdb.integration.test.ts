/**
 * R17 slice 2 (17d, AI-05 / AI-06): versioned household consent that names
 * both processors, owner/admin-only management, a durable consent history,
 * and a consent + membership recheck before every outbound provider stage.
 *
 * Real HTTP against real Postgres; both providers are spies.
 */
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLogs, householdMembers, households } from "@shared/schema";
import { db } from "../../../db";
import { CURRENT_AI_CONSENT_VERSION } from "../ai.consent-policy";
import {
  attemptsFor,
  chat,
  consentEventsFor,
  newKey,
  requestByKey,
  setConsent,
  SPENDING_ANALYSIS,
  SPENDING_QUESTION,
  startR17Harness,
  stopR17Harness,
  stubProviders,
  type R17Harness,
} from "./completion-r17.realdb.fixture";

let harness: R17Harness;

async function setMemberRole(role: "admin" | "member" | "view_only" | "professional") {
  await db
    .update(householdMembers)
    .set({ role })
    .where(and(eq(householdMembers.householdId, harness.fixture.householdId), eq(householdMembers.userId, harness.fixture.member.id)));
}

async function householdConsent() {
  const [row] = await db
    .select({ given: households.aiConsentGiven, version: households.aiConsentVersion })
    .from(households)
    .where(eq(households.id, harness.fixture.householdId));
  return row;
}

describe("R17 consent version and per-stage recheck (real Postgres)", () => {
  beforeEach(async () => {
    harness = await startR17Harness();
  });

  afterEach(async () => {
    await stopR17Harness(harness);
  });

  it("the current disclosure version is v2.0 and names Anthropic and Google", async () => {
    const { app, fixture } = harness;
    await setConsent(fixture.householdId, true, "v1.0");

    const res = await request(app).get("/api/ai/consent").set("Cookie", fixture.member.cookie).expect(200);

    expect(CURRENT_AI_CONSENT_VERSION).toBe("v2.0");
    expect(res.body).toMatchObject({
      consentGiven: true,
      consentVersion: "v1.0",
      currentVersion: "v2.0",
      needsReconsent: true,
      processors: ["Anthropic", "Google"],
    });
  });

  it("an outdated consent version blocks every external call but still allows the labelled local mode", async () => {
    const { app, fixture } = harness;
    const providers = stubProviders();
    await setConsent(fixture.householdId, true, "v1.0");
    const key = newKey();

    const res = await chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: key }).expect(200);

    expect(res.body.answerMode).toBe("local");
    expect(res.body.reply).toContain("Limited local summary");
    expect(providers.claude.analyzeQuery).not.toHaveBeenCalled();
    expect(providers.gemini.analyzeQuery).not.toHaveBeenCalled();
    const row = await requestByKey(fixture.householdId, key);
    expect(row?.consentVersion).toBe("v1.0");
    expect(await attemptsFor(row!.id)).toHaveLength(0);
    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.householdId, fixture.householdId), eq(auditLogs.entityType, "ai_query")));
    expect(audit.details).toMatchObject({ provider_attempted: false, external_blocked_reason: "consent_outdated", consent_version: "v1.0" });
  });

  it("missing consent is 403 before admission", async () => {
    const { app, fixture } = harness;
    stubProviders();
    await setConsent(fixture.householdId, false, null);
    const key = newKey();

    await chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: key }).expect(403);

    expect(await requestByKey(fixture.householdId, key)).toBeUndefined();
  });

  it.each(["owner", "admin"] as const)("%s can grant the current version, which records a consent event", async (role) => {
    const { app, fixture } = harness;
    await setConsent(fixture.householdId, false, null);
    if (role === "admin") await setMemberRole("admin");
    const actor = role === "owner" ? fixture.owner : fixture.member;

    await request(app).post("/api/ai/consent").set("Cookie", actor.cookie).send({ consentGiven: true, consentVersion: CURRENT_AI_CONSENT_VERSION }).expect(200);

    expect(await householdConsent()).toEqual({ given: true, version: "v2.0" });
    const events = await consentEventsFor(fixture.householdId);
    expect(events.map(({ action, consentVersion, actorId }) => ({ action, consentVersion, actorId }))).toEqual([
      { action: "grant", consentVersion: "v2.0", actorId: actor.id },
    ]);
  });

  it("revoking records a revoke event and clears the version", async () => {
    const { app, fixture } = harness;

    await request(app).post("/api/ai/consent").set("Cookie", fixture.owner.cookie).send({ consentGiven: false }).expect(200);

    expect(await householdConsent()).toEqual({ given: false, version: null });
    const events = await consentEventsFor(fixture.householdId);
    expect(events.map(({ action, consentVersion }) => ({ action, consentVersion }))).toEqual([
      { action: "revoke", consentVersion: null },
    ]);
  });

  it.each(["member", "view_only", "professional"] as const)("a %s cannot change consent by a crafted request", async (role) => {
    const { app, fixture } = harness;
    await setConsent(fixture.householdId, true, "v1.0");
    await setMemberRole(role);

    for (const consentGiven of [true, false]) {
      await request(app).post("/api/ai/consent").set("Cookie", fixture.member.cookie).send({ consentGiven }).expect(403);
    }

    expect(await householdConsent()).toEqual({ given: true, version: "v1.0" });
    expect(await consentEventsFor(fixture.householdId)).toHaveLength(0);
  });

  it("consent revoked between stages stops the next outbound call and refunds the unit", async () => {
    const { app, fixture } = harness;
    const providers = stubProviders();
    providers.claude.analyzeQuery.mockImplementation(async () => {
      await setConsent(fixture.householdId, false, null);
      return SPENDING_ANALYSIS;
    });
    const key = newKey();

    await chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: key }).expect(403);

    expect(providers.claude.generateResponse).not.toHaveBeenCalled();
    expect(providers.gemini.analyzeQuery).not.toHaveBeenCalled();
    expect(providers.gemini.generateResponse).not.toHaveBeenCalled();
    const row = await requestByKey(fixture.householdId, key);
    expect(row).toMatchObject({ status: "failed", chatQuotaState: "refunded" });
    const attempts = await attemptsFor(row!.id);
    expect(attempts.map(({ ordinal, status }) => ({ ordinal, status }))).toEqual([{ ordinal: 1, status: "succeeded" }]);
  });

  it("a consent version change between stages also stops the next outbound call", async () => {
    const { app, fixture } = harness;
    const providers = stubProviders();
    providers.claude.analyzeQuery.mockImplementation(async () => {
      await setConsent(fixture.householdId, true, "v1.0");
      return SPENDING_ANALYSIS;
    });

    await chat(app, fixture.owner, { message: SPENDING_QUESTION, clientRequestKey: newKey() }).expect(403);

    expect(providers.claude.generateResponse).not.toHaveBeenCalled();
  });

  it("removal from the household between stages stops the next outbound call", async () => {
    const { app, fixture } = harness;
    const providers = stubProviders();
    providers.claude.analyzeQuery.mockImplementation(async () => {
      await db
        .delete(householdMembers)
        .where(and(eq(householdMembers.householdId, fixture.householdId), eq(householdMembers.userId, fixture.member.id)));
      return SPENDING_ANALYSIS;
    });

    await chat(app, fixture.member, { message: SPENDING_QUESTION, clientRequestKey: newKey() }).expect(403);

    expect(providers.claude.generateResponse).not.toHaveBeenCalled();
    expect(providers.gemini.analyzeQuery).not.toHaveBeenCalled();
  });
});
