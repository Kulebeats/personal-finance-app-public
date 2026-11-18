/**
 * SCP-338: AI conversation history must actually PERSIST across requests and stay
 * scoped to (household, user). REAL DB.
 *
 * The endpoints were stubs (list -> [], get -> hardcoded 404, delete -> no-op,
 * conversationId regenerated per request) so chat history never survived a
 * request. This proves the new AIConversationRepository persists exchanges,
 * returns a stable conversationId to reuse, and never crosses tenants (Rule 11).
 *
 * The ai_conversations/ai_messages tables come from migration 0004; if that
 * migration isn't applied to the dev DB yet, this test provisions the tables
 * transiently and drops them afterward (mirrors the SCP-335 taxonomy test).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { sql, eq } from "drizzle-orm";
import { db } from "../../../db";
import { aiConversations, users, households } from "@shared/schema";
import { aiConversationRepository } from "../ai.conversation.repository";
import {
  createTestUser,
  createTestHousehold,
} from "../../../__tests__/fixtures";

describe("AI conversation persistence (SCP-338)", () => {
  let hhA: string;
  let userA: string;
  let hhB: string;
  let userB: string;
  let provisionedTables = false;

  beforeAll(async () => {
    // Provision the SCP-338 tables transiently if migration 0004 isn't applied.
    const existing = await db.execute(
      sql`SELECT to_regclass('public.ai_conversations') AS reg`,
    );
    const alreadyThere = (existing.rows?.[0] as { reg: string | null } | undefined)
      ?.reg;
    if (!alreadyThere) {
      provisionedTables = true;
      await db.execute(sql`
        CREATE TABLE "ai_conversations" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "household_id" uuid NOT NULL,
          "user_id" uuid NOT NULL,
          "title" varchar(200),
          "created_at" timestamp DEFAULT now() NOT NULL,
          "updated_at" timestamp DEFAULT now() NOT NULL
        )`);
      await db.execute(sql`
        CREATE TABLE "ai_messages" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "conversation_id" uuid NOT NULL REFERENCES "ai_conversations"("id") ON DELETE CASCADE,
          "role" varchar(16) NOT NULL,
          "content" text NOT NULL,
          "tools_used" text[],
          "created_at" timestamp DEFAULT now() NOT NULL
        )`);
    }

    const stamp = Date.now();
    const ua = createTestUser({ email: `scp338a-${stamp}@x.com`, username: `scp338a-${stamp}` });
    const ub = createTestUser({ email: `scp338b-${stamp}@x.com`, username: `scp338b-${stamp}` });
    const ha = createTestHousehold(ua.id, { name: `scp338a-${stamp}` });
    const hb = createTestHousehold(ub.id, { name: `scp338b-${stamp}` });
    hhA = ha.id; userA = ua.id; hhB = hb.id; userB = ub.id;

    for (const h of [ha, hb]) {
      await db.insert(households).values({
        id: h.id, name: h.name, currency: h.currency,
      });
    }
    for (const u of [ua, ub]) {
      await db.insert(users).values({
        id: u.id, email: u.email, username: u.username,
        passwordHash: u.passwordHash, fullName: u.fullName,
        emailVerified: u.emailVerified, mfaEnabled: u.mfaEnabled,
        failedLoginAttempts: u.failedLoginAttempts, lockedUntil: u.lockedUntil,
      });
    }
  });

  afterAll(async () => {
    try {
      // Conversations cascade-delete their messages; remove this test's rows.
      await db.delete(aiConversations).where(eq(aiConversations.householdId, hhA));
      await db.delete(aiConversations).where(eq(aiConversations.householdId, hhB));
      await db.delete(users).where(eq(users.id, userA));
      await db.delete(users).where(eq(users.id, userB));
      await db.delete(households).where(eq(households.id, hhA));
      await db.delete(households).where(eq(households.id, hhB));
      if (provisionedTables) {
        await db.execute(sql`DROP TABLE IF EXISTS "ai_messages"`);
        await db.execute(sql`DROP TABLE IF EXISTS "ai_conversations"`);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("SCP-338 cleanup error", error);
    }
  });

  it("persists an exchange and reuses the same conversation across requests", async () => {
    // First "request": no conversationId -> a thread is created and its id returned.
    const id1 = await aiConversationRepository.appendExchange({
      householdId: hhA,
      userId: userA,
      messages: [
        { role: "user", content: "What did I spend on food?" },
        { role: "assistant", content: "K1,200 last month.", toolsUsed: ["get_spending_by_category"] },
      ],
    });
    expect(id1).toBeTruthy();

    const after1 = await aiConversationRepository.getWithMessages({
      householdId: hhA, userId: userA, conversationId: id1,
    });
    expect(after1?.messages).toHaveLength(2);

    // Second "request" reusing the id -> history grows on the SAME thread.
    const id2 = await aiConversationRepository.appendExchange({
      householdId: hhA, userId: userA, conversationId: id1,
      messages: [
        { role: "user", content: "And on transport?" },
        { role: "assistant", content: "K300." },
      ],
    });
    expect(id2).toBe(id1); // stable conversationId

    const after2 = await aiConversationRepository.getWithMessages({
      householdId: hhA, userId: userA, conversationId: id1,
    });
    expect(after2?.messages).toHaveLength(4); // persisted across requests
    expect(after2?.messages.map((m) => m.role)).toEqual([
      "user", "assistant", "user", "assistant",
    ]);
  });

  it("isolates conversations across households/users (Rule 11)", async () => {
    const idA = await aiConversationRepository.appendExchange({
      householdId: hhA, userId: userA,
      messages: [{ role: "user", content: "private A" }, { role: "assistant", content: "ok" }],
    });

    // User B cannot read A's conversation (treated as not-found, no existence leak).
    expect(
      await aiConversationRepository.getWithMessages({
        householdId: hhB, userId: userB, conversationId: idA,
      }),
    ).toBeUndefined();

    // B appending with A's conversationId must NOT write into A's thread — a fresh
    // thread is created for B instead.
    const idB = await aiConversationRepository.appendExchange({
      householdId: hhB, userId: userB, conversationId: idA,
      messages: [{ role: "user", content: "B msg" }, { role: "assistant", content: "ok" }],
    });
    expect(idB).not.toBe(idA);

    // A's thread is unchanged (still 2 messages), B's list doesn't see A's thread.
    const aStill = await aiConversationRepository.getWithMessages({
      householdId: hhA, userId: userA, conversationId: idA,
    });
    expect(aStill?.messages).toHaveLength(2);

    const bList = await aiConversationRepository.list({
      householdId: hhB, userId: userB, limit: 50, offset: 0,
    });
    expect(bList.items.some((i) => i.conversation.id === idA)).toBe(false);
    expect(bList.items.some((i) => i.conversation.id === idB)).toBe(true);
  });

  it("deletes only the caller's own conversation", async () => {
    const idA = await aiConversationRepository.appendExchange({
      householdId: hhA, userId: userA,
      messages: [{ role: "user", content: "to delete" }, { role: "assistant", content: "ok" }],
    });

    // B can't delete A's conversation.
    expect(
      await aiConversationRepository.delete({
        householdId: hhB, userId: userB, conversationId: idA,
      }),
    ).toBe(false);

    // A can; afterward it's gone.
    expect(
      await aiConversationRepository.delete({
        householdId: hhA, userId: userA, conversationId: idA,
      }),
    ).toBe(true);
    expect(
      await aiConversationRepository.getWithMessages({
        householdId: hhA, userId: userA, conversationId: idA,
      }),
    ).toBeUndefined();
  });
});
