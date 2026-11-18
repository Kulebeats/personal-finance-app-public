/**
 * AI Conversation Repository (SCP-338)
 *
 * Encapsulates all persistence for AI conversation threads and their messages.
 * Every read and write is scoped to BOTH householdId and userId (Rule 11): a
 * user must not be able to read or mutate another household's — or another
 * member's — conversations.
 *
 * Conversation + its messages are written atomically (Rule 10) so a partial
 * append can never leave a conversation row updated without its message, or a
 * message without bumping the thread's updatedAt.
 *
 * @module ai/ai.conversation.repository
 */

import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db';
import { aiConversations, aiMessages } from '@shared/schema';
import type { AiConversation, AiMessage } from '@shared/schema';
import { withTransaction, type TransactionType } from '../../utils/withTransaction';

const MAX_TITLE_LENGTH = 200;

export interface PersistedMessage {
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
}

export interface ConversationListItem {
  conversation: AiConversation;
  messageCount: number;
  preview: string;
}

/**
 * Derive a short, human-readable title from the first user message. No new PII
 * is introduced (the user typed it); it is simply truncated.
 */
function deriveTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= MAX_TITLE_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_TITLE_LENGTH - 1)}…`;
}

export class AIConversationRepository {
  /**
   * Append a user message + assistant reply to a conversation, creating the
   * conversation first if `conversationId` is absent or does not belong to this
   * (household, user). Returns the conversation id that callers should reuse on
   * the next request so history persists across requests.
   *
   * The whole operation is atomic: create/lookup, both message inserts, and the
   * thread `updatedAt` bump happen in one transaction.
   */
  async appendExchange(params: {
    householdId: string;
    userId: string;
    conversationId?: string;
    messages: PersistedMessage[];
  }): Promise<string> {
    const { householdId, userId, conversationId, messages } = params;

    return withTransaction(async (tx) => {
      const targetId = await this.resolveConversationId(tx, {
        householdId,
        userId,
        conversationId,
        firstMessage: messages[0]?.content ?? '',
      });

      for (const message of messages) {
        await tx.insert(aiMessages).values({
          conversationId: targetId,
          role: message.role,
          content: message.content,
          toolsUsed: message.toolsUsed ?? [],
        });
      }

      // Bump the thread so recency ordering reflects the latest activity.
      await tx
        .update(aiConversations)
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(aiConversations.id, targetId),
            eq(aiConversations.householdId, householdId),
            eq(aiConversations.userId, userId),
          ),
        );

      return targetId;
    });
  }

  /**
   * Resolve the conversation id to write to. If the caller supplied an id that
   * belongs to this (household, user), reuse it; otherwise create a new thread.
   * A supplied id that belongs to someone else is treated as "not found" and a
   * fresh conversation is created (never cross-tenant write).
   */
  private async resolveConversationId(
    tx: TransactionType,
    params: {
      householdId: string;
      userId: string;
      conversationId?: string;
      firstMessage: string;
    },
  ): Promise<string> {
    const { householdId, userId, conversationId, firstMessage } = params;

    if (conversationId) {
      const [existing] = await tx
        .select({ id: aiConversations.id })
        .from(aiConversations)
        .where(
          and(
            eq(aiConversations.id, conversationId),
            eq(aiConversations.householdId, householdId),
            eq(aiConversations.userId, userId),
          ),
        )
        .limit(1);

      if (existing) {
        return existing.id;
      }
    }

    const [created] = await tx
      .insert(aiConversations)
      .values({
        householdId,
        userId,
        title: deriveTitle(firstMessage),
      })
      .returning({ id: aiConversations.id });

    return created.id;
  }

  /**
   * List conversations for a (household, user), most-recently-updated first,
   * with a message count and a short preview (the first user message). Scoped
   * to the caller so cross-tenant rows are never returned.
   */
  async list(params: {
    householdId: string;
    userId: string;
    limit: number;
    offset: number;
  }): Promise<{ items: ConversationListItem[]; total: number }> {
    const { householdId, userId, limit, offset } = params;

    const scope = and(
      eq(aiConversations.householdId, householdId),
      eq(aiConversations.userId, userId),
    );

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(aiConversations)
      .where(scope);

    const conversations = await db
      .select()
      .from(aiConversations)
      .where(scope)
      .orderBy(desc(aiConversations.updatedAt))
      .limit(limit)
      .offset(offset);

    const items: ConversationListItem[] = [];
    for (const conversation of conversations) {
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(aiMessages)
        .where(eq(aiMessages.conversationId, conversation.id));

      const [firstUserMessage] = await db
        .select({ content: aiMessages.content })
        .from(aiMessages)
        .where(
          and(
            eq(aiMessages.conversationId, conversation.id),
            eq(aiMessages.role, 'user'),
          ),
        )
        .orderBy(asc(aiMessages.createdAt))
        .limit(1);

      items.push({
        conversation,
        messageCount: countRow?.count ?? 0,
        preview: firstUserMessage?.content ?? conversation.title ?? '',
      });
    }

    return { items, total: total ?? 0 };
  }

  /**
   * Fetch a single conversation with all its messages (oldest first), scoped to
   * the caller. Returns `undefined` when the conversation does not exist OR
   * belongs to another household/user — callers map that to a 404 so existence
   * is not leaked across tenants (Rule 11).
   */
  async getWithMessages(params: {
    householdId: string;
    userId: string;
    conversationId: string;
  }): Promise<{ conversation: AiConversation; messages: AiMessage[] } | undefined> {
    const { householdId, userId, conversationId } = params;

    const [conversation] = await db
      .select()
      .from(aiConversations)
      .where(
        and(
          eq(aiConversations.id, conversationId),
          eq(aiConversations.householdId, householdId),
          eq(aiConversations.userId, userId),
        ),
      )
      .limit(1);

    if (!conversation) {
      return undefined;
    }

    const messages = await db
      .select()
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, conversation.id))
      .orderBy(asc(aiMessages.createdAt));

    return { conversation, messages };
  }

  /**
   * Delete a conversation (and, via cascade, its messages) scoped to the
   * caller. Returns true when a row was actually removed, false when nothing
   * matched (absent or cross-tenant) so the caller can surface a 404.
   */
  async delete(params: {
    householdId: string;
    userId: string;
    conversationId: string;
  }): Promise<boolean> {
    const { householdId, userId, conversationId } = params;

    const deleted = await db
      .delete(aiConversations)
      .where(
        and(
          eq(aiConversations.id, conversationId),
          eq(aiConversations.householdId, householdId),
          eq(aiConversations.userId, userId),
        ),
      )
      .returning({ id: aiConversations.id });

    return deleted.length > 0;
  }
}

export const aiConversationRepository = new AIConversationRepository();
