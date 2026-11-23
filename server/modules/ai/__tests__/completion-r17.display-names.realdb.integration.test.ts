/**
 * Staging follow-up (21 Nov), real Postgres and the real HTTP routes; only the
 * provider SDK calls are recorded answers.
 *
 * The sanitiser sends account names to the provider as generic labels
 * (`savings_1`, `checking_2`). The person asking must see their own account
 * names, while the provider keeps seeing labels only, including in the prior
 * turns replayed on a follow-up question. The provider's Markdown (bold,
 * tables) is kept for the chat to render, with the names in place.
 *
 * #301 review (P1): replies are stored with the labels, so a follow-up never
 * replays a raw name, even after the account is renamed or the asker loses
 * sight of it. Stored history shows the viewer's own visible names, read now.
 */
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { accounts, auditLogs } from "@shared/schema";
import { db } from "../../../db";
import type { AnalysisResult, ProviderCallOptions } from "../ai.provider.types";
import {
  chat,
  messagesIn,
  newKey,
  startR17Harness,
  stopR17Harness,
  stubProviders,
  type R17Harness,
  type TestApp,
} from "./completion-r17.realdb.fixture";
import type { CachePrivacyActor } from "./ai.cache-privacy.fixture";

let harness: R17Harness;

const BALANCES_ANALYSIS: AnalysisResult = {
  toolCalls: [{ name: "get_account_balances", args: {} }],
  tokenCount: 5,
};
// Visible to the owner, ordered by name: "C308 OWNER PRIVATE" (savings), "C308 SHARED" (checking).
const OWNER_PRIVATE = "C308 OWNER PRIVATE";
const SHARED = "C308 SHARED";
const MEMBER_PRIVATE = "C308 MEMBER PRIVATE";
const LABELLED_ANSWER = "Your savings_1 holds ZMW 4,222.23 and checking_2 holds ZMW 988.89.";

function stubBalances(answer: string) {
  const providers = stubProviders();
  providers.claude.analyzeQuery.mockResolvedValue(BALANCES_ANALYSIS);
  providers.claude.generateResponse.mockResolvedValue({ response: answer, tokenCount: 9 });
  return providers;
}

/** The assistant messages of a stored conversation, as the viewer is shown them. */
async function historyReplies(app: TestApp, actor: CachePrivacyActor, conversationId: string): Promise<string[]> {
  const response = await request(app).get(`/api/ai/conversations/${conversationId}`).set("Cookie", actor.cookie).expect(200);
  const messages = response.body.messages as Array<{ role: string; content: string }>;
  return messages.filter((message) => message.role === "assistant").map((message) => message.content);
}

/** What the provider was sent as earlier turns on the latest question. */
function lastReplayed(providers: ReturnType<typeof stubBalances>): string {
  const options = providers.claude.analyzeQuery.mock.calls.at(-1)?.[1] as ProviderCallOptions;
  return JSON.stringify(options.priorTurns ?? []);
}

async function auditSummaries(householdId: string, userId: string): Promise<string[]> {
  const rows = await db.select({ details: auditLogs.details }).from(auditLogs)
    .where(and(eq(auditLogs.householdId, householdId), eq(auditLogs.userId, userId), eq(auditLogs.entityType, "ai_query")));
  return rows.map((row) => String((row.details as Record<string, unknown> | null)?.response_summary ?? ""));
}

describe("R17 display: real account names for the asker, labels for the provider (real Postgres)", () => {
  beforeEach(async () => {
    harness = await startR17Harness();
  });

  afterEach(async () => {
    await stopR17Harness(harness);
  });

  it("the reply names the asker's own accounts; the stored message and the provider keep labels only", async () => {
    const { app, fixture } = harness;
    const providers = stubBalances(LABELLED_ANSWER);

    const response = await chat(app, fixture.owner, { message: "What are my balances?", clientRequestKey: newKey() }).expect(200);

    expect(response.body.reply).toBe(`Your ${OWNER_PRIVATE} holds ZMW 4,222.23 and ${SHARED} holds ZMW 988.89.`);
    const stored = (await messagesIn(response.body.conversationId)).find((message) => message.role === "assistant");
    expect(stored?.content).toBe(LABELLED_ANSWER);
    // The history view shows the names again.
    expect(await historyReplies(app, fixture.owner, response.body.conversationId)).toEqual([response.body.reply]);
    const sentToProvider = JSON.stringify(providers.claude.generateResponse.mock.calls);
    expect(sentToProvider).toContain("savings_1");
    expect(sentToProvider).not.toContain(OWNER_PRIVATE);
    expect(sentToProvider).not.toContain(SHARED);
    // The audit keeps what the provider returned: no account names.
    expect(await auditSummaries(fixture.householdId, fixture.owner.id)).toEqual([LABELLED_ANSWER]);
  });

  it("a member's labels resolve to the member's own visible accounts, never another member's private one", async () => {
    const { app, fixture } = harness;
    stubBalances("Your savings_1 holds ZMW 633.33.");

    const response = await chat(app, fixture.member, { message: "What are my balances?", clientRequestKey: newKey() }).expect(200);

    expect(response.body.reply).toBe(`Your ${MEMBER_PRIVATE} holds ZMW 633.33.`);
    expect(JSON.stringify(response.body)).not.toContain(OWNER_PRIVATE);
  });

  it("a follow-up replays the earlier answer to the provider with labels, not the account names", async () => {
    const { app, fixture } = harness;
    const providers = stubBalances(LABELLED_ANSWER);
    const first = await chat(app, fixture.owner, { message: "What are my balances?", clientRequestKey: newKey() }).expect(200);

    await chat(app, fixture.owner, {
      message: "And the savings one?", conversationId: first.body.conversationId, clientRequestKey: newKey(),
    }).expect(200);

    const replayed = lastReplayed(providers);
    expect(replayed).toContain("savings_1");
    expect(replayed).toContain("checking_2");
    expect(replayed).not.toContain(OWNER_PRIVATE);
    expect(replayed).not.toContain(SHARED);
  });

  it("a follow-up after the account is renamed replays neither the old name nor the new one", async () => {
    const { app, fixture } = harness;
    const providers = stubBalances(LABELLED_ANSWER);
    const first = await chat(app, fixture.owner, { message: "What are my balances?", clientRequestKey: newKey() }).expect(200);
    await db.update(accounts).set({ name: "C308 RENAMED" }).where(eq(accounts.id, fixture.sharedAccountId));

    await chat(app, fixture.owner, {
      message: "And the checking one?", conversationId: first.body.conversationId, clientRequestKey: newKey(),
    }).expect(200);

    const replayed = lastReplayed(providers);
    expect(replayed).toContain("checking_2");
    expect(replayed).not.toContain(SHARED);
    expect(replayed).not.toContain("C308 RENAMED");
  });

  it("a member who loses sight of an account replays no name for it, and their history no longer shows it", async () => {
    const { app, fixture } = harness;
    // The member sees, by name: "C308 MEMBER PRIVATE" (savings), "C308 SHARED" (checking).
    const providers = stubBalances(LABELLED_ANSWER);
    const first = await chat(app, fixture.member, { message: "What are my balances?", clientRequestKey: newKey() }).expect(200);
    expect(first.body.reply).toContain(SHARED);
    await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, fixture.sharedAccountId));

    await chat(app, fixture.member, {
      message: "And the checking one?", conversationId: first.body.conversationId, clientRequestKey: newKey(),
    }).expect(200);

    const replayed = lastReplayed(providers);
    expect(replayed).not.toContain(SHARED);
    expect(replayed).not.toContain(MEMBER_PRIVATE);
    const history = await historyReplies(app, fixture.member, first.body.conversationId);
    expect(history.join("\n")).not.toContain(SHARED);
  });

  it("the provider's Markdown table is kept for the chat to render, naming the accounts", async () => {
    const { app, fixture } = harness;
    const table = (first: string, second: string) => [
      "**Total:** ZMW 5,211.12",
      "",
      "| Account | Balance |",
      "|---|---:|",
      `| ${first} | ZMW 4,222.23 |`,
      `| ${second} | ZMW 988.89 |`,
    ].join("\n");
    stubBalances(table("savings_1", "checking_2"));

    const response = await chat(app, fixture.owner, { message: "What are my balances?", clientRequestKey: newKey() }).expect(200);

    expect(response.body.reply).toBe(table(OWNER_PRIVATE, SHARED));
  });
});
